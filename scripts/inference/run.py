"""Original Dassama Lab SLiPP feature pipeline; protein-only fpocket discovery."""
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

COMMIT = '944b3700ace6921629e1c3a2d9fd2cb44f98f5ed'
TRAINING_SHA = '4d27636b4381dc3c1b9e27451db5b788e6b16f13919c4ed36f8c2ba108097711'
FEATURES = ['pock_vol','nb_AS','mean_as_ray','mean_as_solv_acc','apol_as_prop','mean_loc_hyd_dens','hydrophobicity_score','volume_score','polarity_score','charge_score','flex','prop_polar_atm','as_density','as_max_dst','surf_pol_vdw14','surf_apol_vdw14','surf_vdw14']
DESCRIPTORS = ['Volume','Number of Alpha Spheres','Mean alpha sphere radius','Mean alp. sph. solvent access','Apolar alpha sphere proportion','Mean local hydrophobic density','Hydrophobicity score','Volume score','Polarity score','Charge score','Flexibility','Proportion of polar atoms','Alpha sphere density','Cent. of mass - Alpha Sphere max dist','Polar SASA','Apolar SASA','Total SASA']


def model(cache):
    import joblib
    import sklearn
    from sklearn.ensemble import RandomForestClassifier
    source = Path(__file__).parent/'model/training_pockets.csv'
    if hashlib.sha256(source.read_bytes()).hexdigest() != TRAINING_SHA:
        raise ValueError('SLiPP training data checksum mismatch.')
    version = f'{COMMIT[:12]}-sklearn{sklearn.__version__}-seed2026'
    target = cache/f'slipp-{version}.joblib'
    if target.exists(): return joblib.load(target), version
    rows = list(csv.DictReader(source.open()))
    x = [[float(row[k]) for k in FEATURES] for row in rows]
    y = [int(row['lipid_binding']) for row in rows]
    # Upstream trains default RandomForestClassifier at startup without a seed.
    # sqrt is the current spelling of the original classifier's auto default.
    forest = RandomForestClassifier(n_estimators=100, max_features='sqrt', random_state=2026, n_jobs=1)
    forest.fit(x,y)
    temporary = target.with_suffix('.tmp')
    joblib.dump(forest, temporary)
    temporary.replace(target)
    return forest, version


def pdb_id(value):
    value=value.strip()
    if '://' in value:
        url=urllib.parse.urlparse(value)
        if url.scheme!='https' or url.hostname not in {'rcsb.org','www.rcsb.org','files.rcsb.org','pdb.org','www.pdb.org','ebi.ac.uk','www.ebi.ac.uk'}:
            raise ValueError('Use a PDB ID or an HTTPS RCSB/PDBe entry link.')
        value=url.path.rstrip('/').split('/')[-1]
        value=re.sub(r'\.(pdb|cif|mmcif)(\.gz)?$','',value,flags=re.I)
    if not re.fullmatch(r'[1-9][A-Za-z0-9]{3}',value):
        raise ValueError('Enter a four-character PDB ID, for example 1ATP, or its RCSB/PDBe entry link.')
    return value.upper()


def fetch_structure(source):
    code=pdb_id(source)
    url=f'https://files.rcsb.org/download/{code}.cif'
    with urllib.request.urlopen(url,timeout=30) as response:
        data=response.read(20_000_001)
    if len(data)>20_000_000: raise ValueError('Structure exceeds the 20 MB import limit.')
    text=data.decode('utf8')
    if '_atom_site.' not in text: raise ValueError('RCSB returned no atomic coordinates.')
    return dict(structureData=text, warnings=[], project=dict(schemaVersion=1,id='pdb:'+code,name=code,
        description='RCSB coordinates · first model',structure=dict(id=code,path=code+'.cif',format='mmcif',source=url),
        model=dict(name='SLiPP',version=None,classes=['non-lipid','lipid'],calibration='Not run'),
        provenance='Downloaded from '+url,pockets=[]))


def analyze(request,directory,cache,cancel):
    import gemmi
    predictor=request.get('inferenceModel','slipp')
    if predictor not in {'slipp','saprot-egnn-fold2'}: raise ValueError('Unsupported lipid-binding model.')
    structure=(gemmi.read_pdb_string(request['structureData']) if request['format']=='pdb' else gemmi.make_structure_from_block(gemmi.cif.read_string(request['structureData']).sole_block()))
    if not len(structure): raise ValueError('No coordinate model.')
    while len(structure)>1: del structure[-1]
    structure.remove_alternative_conformations()
    excluded=(request.get('preparation') or {}).get('excludedChains',[])
    if any(c not in [chain.name for chain in structure[0]] for c in excluded): raise ValueError('Excluded chain not found.')
    # Map to legacy PDB identifiers for fpocket; restore author IDs in output.
    mapping={}; alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    for ci in range(len(structure[0])-1,-1,-1):
        chain=structure[0][ci]
        for ri in range(len(chain)-1,-1,-1):
            if chain.name in excluded or not gemmi.find_tabulated_residue(chain[ri].name).is_amino_acid(): del chain[ri]
        if not len(chain): del structure[0][ci]
    if not len(structure[0]): raise ValueError('No protein residues remain after chain selection.')
    if len(structure[0])>len(alphabet): raise ValueError('Pocket detection supports up to 62 protein chains; select a smaller assembly.')
    original_ids=set()
    for ci,chain in enumerate(structure[0]):
        original_chain=chain.name; chain.name=alphabet[ci]
        if len(chain)>9999: raise ValueError('A chain exceeds the fpocket PDB residue limit.')
        for ri,residue in enumerate(chain):
            original=dict(chain=original_chain,seq=residue.seqid.num,insertionCode=residue.seqid.icode.strip(),name=residue.name)
            key=(original_chain,residue.seqid.num,residue.seqid.icode.strip())
            if key in original_ids: raise ValueError('Duplicate author residue identifiers; choose an unambiguous structure.')
            original_ids.add(key)
            mapping[(chain.name,ri+1)]=original
            residue.seqid=gemmi.SeqId(ri+1,' ');residue.het_flag='A'
    structure.remove_hydrogens()
    if sum(len(r) for c in structure[0] for r in c)>99999: raise ValueError('Pocket detection supports at most 99,999 protein heavy atoms.')
    pdb=directory/'protein.pdb';pdb.write_text(structure.make_pdb_string())
    binary=Path(sys.executable).parent/'fpocket'
    started=time.monotonic()
    with (directory/'fpocket.log').open('w') as log:
        process=subprocess.Popen([str(binary),'-f',str(pdb)],stdout=log,stderr=subprocess.STDOUT,cwd=directory)
        try:
            while process.poll() is None:
                if cancel.exists(): raise InterruptedError('Pocket analysis canceled.')
                if time.monotonic()-started>300: raise TimeoutError('Pocket detection exceeded five minutes.')
                time.sleep(.1)
        finally:
            if process.poll() is None: process.kill()
            process.wait()
    if process.returncode: raise RuntimeError('fpocket failed: '+(directory/'fpocket.log').read_text()[-2000:])
    forest,version=model(cache) if predictor=='slipp' else (None,None)
    if cancel.exists(): raise InterruptedError('Pocket analysis canceled.')
    info=directory/'protein_out/protein_info.txt'
    if not info.exists():
        log=(directory/'fpocket.log').read_text()
        if 'no pockets' not in log.lower() and 'no pocket' not in log.lower(): raise RuntimeError('fpocket produced no descriptor output: '+log[-1000:])
        blocks=[]
    else: blocks=re.split(r'Pocket\s+(\d+)\s*:',info.read_text())
    pockets=[]
    for i in range(1,len(blocks),2):
        rank=int(blocks[i]);base=directory/f'protein_out/pockets/pocket{rank}'
        metrics={m.group(1).strip():float(m.group(2)) for m in re.finditer(r'^\s*([^:\n]+):\s*([-+\d.eE]+)',blocks[i+1],re.M)}
        vector=[metrics[k] for k in DESCRIPTORS]
        if not all(math.isfinite(v) for v in vector): raise ValueError('Non-finite fpocket descriptors.')
        residues={}
        for line in base.with_name(base.name+'_atm.pdb').read_text().splitlines():
            if line.startswith(('ATOM  ','HETATM')):
                key=(line[21].strip(),int(line[22:26]));residues[key]=mapping[key]
        spheres=[]
        for line in base.with_name(base.name+'_vert.pqr').read_text().splitlines():
            if line.startswith(('ATOM','HETATM')):
                fields=line.split();spheres.append(dict(center=list(map(float,fields[-5:-2])),radius=float(fields[-1])))
        if not spheres: raise ValueError('Detected pocket has no alpha spheres.')
        probability=float(forest.predict_proba([vector])[0,list(forest.classes_).index(1)]) if forest else 0
        # Always expose P(lipid), including below 0.5; do not rank by confidence in non-lipid.
        pockets.append(dict(id=f'pocket-{rank:02}',rank=rank,center=[sum(s['center'][a] for s in spheres)/len(spheres) for a in range(3)],
            residues=list(residues.values()),fpocket=metrics,prediction=dict(label='lipid',probability=probability,probabilities={'non-lipid':1-probability,'lipid':probability}),
            features=[dict(name=k,value=v,unit=None) for k,v in zip(FEATURES,vector)],geometry=dict(alphaSpheres=spheres)))
    if predictor=='saprot-egnn-fold2':
        import importlib.util
        spec=importlib.util.spec_from_file_location('geometric_bridge',Path(__file__).with_name('geometric.py'))
        bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
        result=bridge.predict(pockets,mapping,pdb,directory,cache,cancel,request.get('cpu',4))
        result['provenance']+=f' fpocket 4.0 executable SHA256 {hashlib.sha256(binary.read_bytes()).hexdigest()}; first-model protein heavy atoms; alternate conformations reduced; nonprotein residues excluded; excluded chains: {excluded}. fpocket descriptors may vary between runs.'
        result['elapsedSeconds']=round(time.monotonic()-started,3)
        return result
    return dict(pockets=pockets,model=dict(name='SLiPP',version=version,classes=['non-lipid','lipid'],
        calibration='Original 17-feature random forest recipe, refitted from published training data; seed 2026, sklearn 1.8.0. Uncalibrated P(lipid), not lipid identity.'),
        provenance=f'Dassama Lab SLiPP_2024 {COMMIT}; training SHA256 {TRAINING_SHA}; fpocket 4.0 (4bb0d8447f62), executable SHA256 {hashlib.sha256(binary.read_bytes()).hexdigest()}. First-model protein heavy atoms; alternate conformations reduced; nonprotein residues excluded. Excluded chains: {excluded}. fpocket Monte Carlo descriptors may vary between runs.',
        elapsedSeconds=round(time.monotonic()-started,3))
