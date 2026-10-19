"""Real registered fold-2 inference, cache parity, author IDs and cancellation.

Run with .venv-docking/bin/python scripts/check-geometric.py after setup-geometric.sh.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import gemmi

root=Path(__file__).resolve().parents[1]
def module(name):
    spec=importlib.util.spec_from_file_location(name,root/f'scripts/inference/{name}.py')
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value

inference, geometric=module('run'),module('geometric')
config=geometric.configuration()
structure=gemmi.read_pdb_string((root/'demo/fabp4-reference/structure.pdb').read_text())
structure[0][0].name='LONG'
for residue in structure[0][0]:
    residue.seqid=gemmi.SeqId(residue.seqid.num-20,'A')
request=dict(action='analyze',inferenceModel=geometric.MODEL_ID,structureData=structure.make_mmcif_document().as_string(),format='mmcif',cpu=4)
started=time.monotonic()
with tempfile.TemporaryDirectory() as temporary:
    directory=Path(temporary);cache=directory/'cache';cache.mkdir()
    result=inference.analyze(request,directory,cache,directory/'cancel')
    assert len(result['pockets'])>=1 and result['model']['version'].startswith('fold2-')
    names=['FattyAcyls','Glycerolipids','Glycerophospholipids','Sphingolipids','SterolLipids','PrenolLipids','Saccharolipids','Polyketides']
    valid={(c.name,r.seqid.num,r.seqid.icode.strip()) for c in structure[0] for r in c}
    for pocket in result['pockets']:
        assert len(pocket['features'])==146
        assert all((r['chain'],r['seq'],r['insertionCode']) in valid for r in pocket['residues'])
        prediction=pocket['prediction']
        assert prediction['probability']==prediction['probabilities']['lipid']
        assert abs(sum(prediction['probabilities'].values())-1)<1e-7
        classes=prediction['lipidClasses']
        assert list(classes['scores'])==names
        assert classes['taxonomyVersion']=='biodolphin_unique_values_to_canonical_v1'
        assert all(0<=value<=1 for value in classes['scores'].values())
        assert abs(sum(classes['scores'].values())-1)>.01,'Multilabel outputs must not be normalized as a distribution'
    # Reuse identical detected geometry: a cached encoder must not change predictions.
    cached=directory/'cached.json'
    subprocess.run([config['python'],str(root/'scripts/inference/geometric.py'),str(directory/'geometric-input.json'),str(cached)],check=True)
    replay=json.loads(cached.read_text())
    assert 'cache hit: True' in replay['provenance']
    assert [p['prediction'] for p in replay['pockets']]==[p['prediction'] for p in result['pockets']]
    # Exercise the geometric child-process cancellation boundary, not only fpocket.
    canceled=directory/'canceled';canceled.mkdir();(canceled/'cancel').touch()
    try: geometric.predict([],{},directory/'protein.pdb',canceled,cache,canceled/'cancel',4)
    except InterruptedError: pass
    else: raise AssertionError('Canceled geometric work returned a result')
    try: inference.analyze(dict(request,inferenceModel='unknown'),directory,cache,directory/'cancel')
    except ValueError: pass
    else: raise AssertionError('Unknown predictor was silently replaced')
print(f'Geometric checks passed: {len(result["pockets"])} pockets, 146 features, eight canonical class scores, author IDs, exact cache parity, cancellation and model validation ({time.monotonic()-started:.1f}s).')
