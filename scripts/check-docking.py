"""Run with .venv-docking/bin/python scripts/check-docking.py [--benchmark]."""
import json
import math
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time
from rdkit import Chem

root = Path(__file__).resolve().parent.parent
project = json.loads((root/'demo/canonical-project/studio.json').read_text())
request = dict(smiles='Cn1c(=O)c2c(ncn2C)n(C)c1=O',seed=2026,exhaustiveness=8,cpu=4,
               format='pdb',structureData=(root/'demo/canonical-project/structure.pdb').read_text(),pocket=project['pockets'][0])
with tempfile.TemporaryDirectory(prefix='slipp-docking-check-') as directory:
    base=Path(directory)
    def run(data, cancel=False):
        job=base/str(time.time_ns());job.mkdir()
        if cancel: (job/'cancel').touch()
        start=time.perf_counter()
        output=subprocess.run([sys.executable,str(root/'scripts/docking/run.py'),str(job),str(base/'cache')],input=json.dumps(data),capture_output=True,text=True,timeout=180)
        result=json.loads(output.stdout)
        return result, time.perf_counter()-start
    first,_=run(request)
    assert 'error' not in first,first
    assert first['engine'].startswith('AutoDock Vina v1.2.7')
    assert first['poses'] and not first['receptorCacheHit']
    scores=[p['score'] for p in first['poses']]
    assert all(math.isfinite(v) for v in scores) and scores==sorted(scores)
    for pose in first['poses']:
        assert abs(pose['deltaScore']-(pose['score']-scores[0]))<0.001
        assert all(math.isfinite(v) for v in pose['components'].values())
        mol=Chem.MolFromMolBlock(pose['sdf'],removeHs=True)
        assert mol and Chem.MolToSmiles(mol)==first['smiles']
        coordinates=mol.GetConformer().GetPositions()
        for point in coordinates:
            assert all(abs(point[i]-first['center'][i]) <= first['size'][i]/2+0.1 for i in range(3))
    second,_=run(request)
    assert second['receptorCacheHit']
    assert [p['score'] for p in second['poses']]==scores, 'Fixed seed should reproduce scores'
    for smiles in ['invalid_smiles','CCO.O','CC(O)C(=O)O']:
        result,_=run({**request,'smiles':smiles})
        assert 'error' in result,result
    result,_=run(request,cancel=True)
    assert result.get('error')=='Docking canceled.',result
    print('Docking checks passed: real search, chemistry round-trip, box bounds, fixed seed, cache, invalid inputs, cancellation.')
    if '--benchmark' in sys.argv:
        rows=[]
        for ligand,smiles in [('caffeine',request['smiles']),('palmitic_acid','CCCCCCCCCCCCCCCC(=O)O')]:
            for effort in [8,32,96]:
                runs=[]
                for seed in [2026,2027,2028]:
                    result,wall=run({**request,'smiles':smiles,'exhaustiveness':effort,'seed':seed})
                    assert 'error' not in result,result
                    runs.append(dict(seed=seed,wallSeconds=round(wall,3),searchSeconds=result['searchSeconds'],bestScore=result['poses'][0]['score'],poseCount=len(result['poses'])))
                row=dict(ligand=ligand,exhaustiveness=effort,cpu=4,medianWallSeconds=round(statistics.median(r['wallSeconds'] for r in runs),3),runs=runs)
                rows.append(row)
                print(json.dumps(row),flush=True)
        (root/'docs/docking-benchmark.json').write_text(json.dumps({'receptor':'1ATP protein only, pocket-01','engine':'Vina 1.2.7','date':'2026-09-18','runs':rows},indent=2)+'\n')
