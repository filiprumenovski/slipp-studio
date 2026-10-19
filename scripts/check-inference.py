"""Run real fpocket + SLiPP against ligand-free coordinates and check feature identity."""
import ast
import importlib.util
import json
from pathlib import Path
import tempfile
import numpy as np
import gemmi
from rdkit import Chem
from rdkit.Chem import Lipinski

root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('inference',root/'scripts/inference/run.py')
i=importlib.util.module_from_spec(spec);spec.loader.exec_module(i)
for source in ['1atp','https://www.rcsb.org/structure/1ATP','https://files.rcsb.org/download/1ATP.pdb','https://www.ebi.ac.uk/pdbe/entry/pdb/1atp']:
    assert i.pdb_id(source)=='1ATP'
for source in ['http://localhost/1ATP','https://evil.example/1ATP','file:///1ATP','../1ATP','bad']:
    try:i.pdb_id(source)
    except ValueError:pass
    else:raise AssertionError(source)
for lipid in json.loads((root/'src/data/lipids.json').read_text()):
    mol=Chem.MolFromSmiles(lipid['smiles']);assert mol
    assert not any(s=='?' for _,s in Chem.FindMolChiralCenters(mol,includeUnassigned=True))
    assert Lipinski.NumRotatableBonds(mol)<=25
source=(root/'demo/canonical-project/structure.pdb').read_text()
source='\n'.join(l for l in source.splitlines() if not l.startswith(('HETATM','CONECT')))+'\n'
with tempfile.TemporaryDirectory() as temporary:
    temp=Path(temporary);cache=root/'.venv-docking/slipp-model-cache';cache.mkdir(exist_ok=True)
    result=i.analyze(dict(structureData=source,format='pdb'),temp,cache,temp/'cancel')
    assert len(result['pockets'])>5
    forest,version=i.model(cache)
    assert list(forest.classes_)==[0,1] and forest.n_features_in_==17 and forest.random_state==2026
    for pocket in result['pockets']:
        assert len(pocket['features'])==17
        assert [f['name'] for f in pocket['features']]==i.FEATURES
        vector=[f['value'] for f in pocket['features']]
        assert vector==[pocket['fpocket'][k] for k in i.DESCRIPTORS]
        assert pocket['prediction']['probability']==forest.predict_proba([vector])[0,1]
        assert sum(pocket['prediction']['probabilities'].values())==1
        assert pocket['geometry']['alphaSpheres'] and all(r['chain'] in ['E','I'] for r in pocket['residues'])
    # Verify original author IDs survive the legacy PDB bridge, including mmCIF multi-character chains.
    structure=gemmi.read_pdb_string(source);structure[0][0].name='LONG';structure[0][0][0].seqid=gemmi.SeqId(-7,'B')
    cif=structure.make_mmcif_document().as_string();second=temp/'mmcif';second.mkdir()
    remapped=i.analyze(dict(structureData=cif,format='mmcif'),second,cache,second/'cancel')
    assert any(r['chain']=='LONG' for p in remapped['pockets'] for r in p['residues'])
    assert all(r['chain'] in ['LONG','I'] for p in remapped['pockets'] for r in p['residues'])
    # Check actual identifier mapping against the entire input, not just chain names.
    valid={(c.name,r.seqid.num,r.seqid.icode.strip(),r.name) for c in structure[0] for r in c}
    assert all((r['chain'],r['seq'],r['insertionCode'],r['name']) in valid for p in remapped['pockets'] for r in p['residues'])
    third=temp/'canceled';third.mkdir();(third/'cancel').touch()
    try:i.analyze(dict(structureData=source,format='pdb'),third,cache,third/'cancel')
    except InterruptedError:pass
    else:raise AssertionError('Canceled inference must not return predictions')
    loaded=dict(project=json.loads((root/'demo/canonical-project/studio.json').read_text()),structureData=source,warnings=[])
    loaded['project'].update({k:result[k] for k in ['pockets','model','provenance']})
    (Path('/tmp')/'slipp-verified-inference.json').write_text(json.dumps(loaded))
print(f'Inference checks passed: {len(result["pockets"])} real pockets, exact 17-feature ordering, class probabilities, author IDs, cancellation, SMILES and URL validation.')
