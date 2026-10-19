"""Local rigid-receptor docking. JSON request on stdin, JSON result on stdout."""
import contextlib
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time


def prepare_receptor(request, cache):
    import gemmi
    from meeko import Polymer, ResidueChemTemplates, MoleculePreparation, PDBQTWriterLegacy
    settings = request.get('preparation') or {}
    excluded = settings.get('excludedChains', [])
    keep = settings.get('keepResidues', [])
    templates = settings.get('templates', {})
    if not isinstance(excluded, list) or not isinstance(keep, list) or not isinstance(templates, dict):
        raise ValueError('Invalid receptor preparation settings.')
    if any(not isinstance(v, str) for v in excluded + keep):
        raise ValueError('Invalid chain or residue identifiers.')
    structure = (gemmi.read_pdb_string(request['structureData']) if request['format']=='pdb'
                 else gemmi.make_structure_from_block(gemmi.cif.read_string(request['structureData']).sole_block()))
    if not len(structure): raise ValueError('Receptor has no coordinate model.')
    model_count = len(structure)
    while len(structure)>1: del structure[-1]
    inventory = []
    allowed_hetero = {'HOH','WAT','MG','CA','MN','ZN','NA','K','CL'}
    for chain in structure[0]:
        for residue in chain:
            rid = f'{chain.name}:{residue.seqid}'
            protein = gemmi.find_tabulated_residue(residue.name).is_amino_acid()
            inventory.append(dict(id=rid, chain=chain.name, seq=residue.seqid.num,
                                  insertionCode=residue.seqid.icode.strip(), name=residue.name,
                                  protein=protein, supported=protein or residue.name in allowed_hetero,
                                  atoms=len(residue), alternate=any(a.altloc != '\x00' for a in residue)))
    if request.get('action') == 'inspect':
        return dict(residues=inventory, models=model_count)
    ids = {r['id']:r for r in inventory}
    if len(ids) != len(inventory):
        raise ValueError('Duplicate chain/residue identifiers; use an unambiguous receptor structure.')
    if any(c not in {r['chain'] for r in inventory} for c in excluded):
        raise ValueError('An excluded chain does not exist in the receptor.')
    if any(r not in ids or not ids[r]['supported'] or ids[r]['protein'] for r in keep):
        raise ValueError('Only supported water/ion residues can be retained explicitly.')
    allowed_templates = {'HIS': {'HID','HIE','HIP'}, 'ASP': {'ASP','ASH'}, 'GLU': {'GLU','GLH'}, 'LYS': {'LYS','LYN'}}
    for rid, template in templates.items():
        if rid not in ids or template not in allowed_templates.get(ids[rid]['name'], set()) or ids[rid]['chain'] in excluded:
            raise ValueError('Invalid protonation template assignment: '+str(rid))
    key = hashlib.sha256(('receptor-v2:'+importlib.metadata.version('meeko')+request['format']+
                          request['structureData']+json.dumps(settings,sort_keys=True)).encode()).hexdigest()
    receptor = cache/(key+'.pdbqt')
    metadata = cache/(key+'.json')
    cache_hit = receptor.exists() and metadata.exists()
    if cache_hit:
        report = json.loads(metadata.read_text())
    else:
        structure.remove_alternative_conformations()
        removed, retained = [], []
        for chain in structure[0]:
            for i in range(len(chain)-1,-1,-1):
                residue = chain[i]
                rid = f'{chain.name}:{residue.seqid}'
                if chain.name in excluded or (not ids[rid]['protein'] and rid not in keep):
                    removed.append(ids[rid]); del chain[i]
                else:
                    retained.append(ids[rid])
        if not any(r['protein'] for r in retained):
            raise ValueError('Select at least one protein chain.')
        polymer = Polymer.from_pdb_string(structure.make_pdb_string(),
                    ResidueChemTemplates.create_from_defaults(), MoleculePreparation(), set_template=templates)
        rigid, _ = PDBQTWriterLegacy.write_from_polymer(polymer)
        if not rigid.strip(): raise ValueError('No atoms survived receptor preparation.')
        report = dict(structureData=polymer.to_pdb(), removed=removed, retained=retained,
                      assignments={rid:m.residue_template_key for rid,m in polymer.monomers.items()},
                      atomCount=sum(l.startswith(('ATOM','HETATM')) for l in rigid.splitlines()),
                      settings=settings, models=model_count,
                      alternateResidues=sum(r['alternate'] for r in inventory))
        receptor.write_text(rigid)
        metadata.write_text(json.dumps(report))
    report['cacheHit'] = cache_hit
    return receptor, report


def dock(request, directory, cache, cancel):
    import gemmi
    from rdkit import Chem
    from rdkit.Chem import AllChem, Lipinski
    from meeko import (MoleculePreparation, PDBQTWriterLegacy, Polymer,
                       ResidueChemTemplates, PDBQTMolecule, RDKitMolCreate)

    started = time.perf_counter()
    scoring = request.get('scoring', 'vina')
    if scoring not in {'vina','vinardo'}: raise ValueError('Unsupported scoring function.')
    smiles = request['smiles'].strip()
    if not smiles or len(smiles) > 2048:
        raise ValueError('Enter a SMILES string of at most 2048 characters.')
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError('RDKit could not parse this SMILES string.')
    if len(Chem.GetMolFrags(mol)) != 1:
        raise ValueError('Enter one connected ligand; remove counterions or separate fragments.')
    if not 3 <= mol.GetNumHeavyAtoms() <= 100 or Lipinski.NumRotatableBonds(mol) > 25:
        raise ValueError('This local workflow supports 3–100 heavy atoms and at most 25 rotatable bonds.')
    if any(atom.GetAtomicNum() not in {1,6,7,8,9,15,16,17,35,53} for atom in mol.GetAtoms()):
        raise ValueError('This workflow supports organic ligands (H, C, N, O, F, P, S, Cl, Br, I).')
    seed = int(request['seed'])
    exhaustiveness = int(request['exhaustiveness'])
    cpu = int(request['cpu'])
    if not (1 <= seed <= 2147483647 and 1 <= exhaustiveness <= 128 and 1 <= cpu <= 64):
        raise ValueError('Invalid docking search settings.')
    spheres = request['pocket']['geometry']['alphaSpheres']
    if not spheres:
        raise ValueError('The pocket has no alpha-sphere geometry for defining the search box.')
    lower = [min(s['center'][i] - s['radius'] for s in spheres) - 4 for i in range(3)]
    upper = [max(s['center'][i] + s['radius'] for s in spheres) + 4 for i in range(3)]
    center = [(a+b)/2 for a,b in zip(lower,upper)]
    size = [max(16, b-a) for a,b in zip(lower,upper)]
    if not all(math.isfinite(v) for v in center+size) or max(size) > 48:
        raise ValueError('Pocket search box exceeds the supported 48 Å edge. Choose a smaller pocket.')
    warnings = ['Rigid receptor; only explicitly retained supported waters/ions are included alongside selected protein chains.',
                'Input formal charges and stereochemistry are used as supplied; no pH, tautomer or stereoisomer enumeration.',
                'Vina scores rank sampled poses; they are not binding probabilities or experimental affinities.']
    if any(s == '?' for _, s in Chem.FindMolChiralCenters(mol, includeUnassigned=True)):
        raise ValueError('Specify all stereocenters in the SMILES before docking.')
    canonical = Chem.MolToSmiles(mol, isomericSmiles=True)
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    if AllChem.EmbedMolecule(mol, params) < 0:
        raise ValueError('Could not generate a 3D ligand conformer.')
    if AllChem.MMFFHasAllMoleculeParams(mol):
        status = AllChem.MMFFOptimizeMolecule(mol, maxIters=500)
        if status: warnings.append('Initial ligand minimization did not fully converge.')
    else:
        raise ValueError('MMFF parameters are unavailable for this ligand.')
    setups = MoleculePreparation().prepare(mol)
    if len(setups) != 1:
        raise ValueError('Ligand preparation produced multiple setups; unsupported in this workflow.')
    pdbqt, ok, error = PDBQTWriterLegacy.write_string(setups[0])
    if not ok: raise ValueError(error)
    ligand = directory / 'ligand.pdbqt'
    ligand.write_text(pdbqt)
    preparation_seconds = time.perf_counter() - started

    receptor, preparation = prepare_receptor(request, cache)
    cache_hit = preparation['cacheHit']
    removed = sorted({r['name'] for r in preparation['removed']})
    if removed: warnings.append('Excluded residue types: '+', '.join(removed)+'.')
    if (request.get('preparation') or {}).get('keepResidues'):
        warnings.append('Retained waters/ions are rigid. Generic Vina/Vinardo scoring does not establish metal coordination chemistry or water displacement energetics.')
    if cancel.exists(): raise InterruptedError('Docking canceled.')
    receptor_seconds = time.perf_counter()-started-preparation_seconds
    vina = Path(sys.executable).parent / 'vina'
    engine = subprocess.check_output([str(vina),'--version'],text=True,timeout=10).strip()
    if not engine.startswith('AutoDock Vina v1.2.7'):
        raise ValueError('This workflow requires AutoDock Vina 1.2.7.')
    output = directory/'poses.pdbqt'
    command = [str(vina), '--scoring', scoring, '--receptor', str(receptor), '--ligand', str(ligand),
               '--out', str(output), '--cpu', str(cpu), '--seed', str(seed),
               '--exhaustiveness', str(exhaustiveness), '--num_modes', '10', '--energy_range', '5']
    for axis, value, span in zip('xyz', center, size):
        command += ['--center_'+axis, str(value), '--size_'+axis, str(span)]
    search_started = time.perf_counter()
    with (directory/'vina.log').open('w') as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        try:
            while process.poll() is None:
                if cancel.exists(): raise InterruptedError('Docking canceled.')
                if time.perf_counter()-search_started > 900:
                    raise TimeoutError('Docking exceeded the 15 minute local limit. Reduce search effort or ligand flexibility.')
                time.sleep(0.1)
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
    if process.returncode:
        raise RuntimeError('Vina failed: '+(directory/'vina.log').read_text()[-3000:])
    search_seconds = time.perf_counter()-search_started
    text = output.read_text()
    scores = [[float(v) for v in l.split()[3:6]] for l in text.splitlines() if l.startswith('REMARK VINA RESULT:')]
    molecules = RDKitMolCreate.from_pdbqt_mol(PDBQTMolecule(text, skip_typing=True))
    if len(molecules)!=1 or molecules[0] is None:
        raise RuntimeError('Could not recover ligand chemistry from docking output.')
    poses_mol = molecules[0]
    if poses_mol.GetNumConformers() != len(scores) or not scores:
        raise RuntimeError('Docking coordinates and score counts disagree.')
    components = [{key: float(next(l.split(':',1)[1] for l in block.splitlines() if l.startswith('REMARK '+label+':'))) for key,label in [('inter','INTER'),('intra','INTRA'),('unbound','UNBOUND')]} for block in text.split('ENDMDL') if 'REMARK VINA RESULT:' in block]
    poses = [{'components':components[i], 'deltaScore':round(score[0]-scores[0][0],3),'rank':i+1,'score':score[0], 'rmsdLower':score[1], 'rmsdUpper':score[2],
              'sdf':Chem.MolToMolBlock(poses_mol, confId=i)+'\n$$$$\n'} for i,score in enumerate(scores)]
    return {'scoring':scoring, 'preparation':preparation, 'smiles':canonical, 'pocketId':request['pocket']['id'], 'engine':engine,
            'structureSha256':hashlib.sha256(request['structureData'].encode()).hexdigest(),
            'preparationVersions':{name:importlib.metadata.version(name) for name in ['rdkit','meeko','gemmi']},
            'seed':seed,'exhaustiveness':exhaustiveness,'cpu':cpu, 'center':center, 'size':size,
            'receptorCacheHit':cache_hit, 'preparationSeconds':round(preparation_seconds+receptor_seconds,3),
            'searchSeconds':round(search_seconds,3), 'totalSeconds':round(time.perf_counter()-started,3),
            'warnings':warnings,'poses':poses}


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        directory, cache = map(Path, sys.argv[1:3])
        cache.mkdir(parents=True, exist_ok=True)
        with contextlib.redirect_stdout(sys.stderr):
            action = request.get('action', 'dock')
            if action != 'fetch' and (request.get('format') not in {'pdb','mmcif'} or len(request.get('structureData','')) > 20_000_000):
                raise ValueError('Invalid structure input.')
            if action in {'analyze','fetch'}:
                import importlib.util
                spec=importlib.util.spec_from_file_location('slipp_inference',Path(__file__).parent.parent/'inference/run.py')
                inference=importlib.util.module_from_spec(spec);spec.loader.exec_module(inference)
                result=inference.fetch_structure(request.get('source','')) if action=='fetch' else inference.analyze(request,directory,cache,directory/'cancel')
            elif action == 'inspect': result = prepare_receptor(request, cache)
            elif action == 'prepare': result = prepare_receptor(request, cache)[1]
            elif action == 'dock': result = dock(request,directory,cache,directory/'cancel')
            else: raise ValueError('Unsupported operation.')
        if (directory/'cancel').exists(): raise InterruptedError('Operation canceled.')
        print(json.dumps(result, allow_nan=False))
    except Exception as error:
        print(json.dumps({'error':str(error)}))
        sys.exit(1)
