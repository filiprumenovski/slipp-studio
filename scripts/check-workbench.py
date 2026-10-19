"""Real receptor preparation and second-scoring-function checks; no mocks."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
root=Path(__file__).resolve().parent.parent
structure=(root/'demo/canonical-project/structure.pdb').read_text()
project=json.loads((root/'demo/canonical-project/studio.json').read_text())
with tempfile.TemporaryDirectory() as directory:
    base=Path(directory)
    def run(**options):
        job=base/str(len(list(base.iterdir())));job.mkdir()
        request=dict(format='pdb',structureData=structure,**options)
        p=subprocess.run([sys.executable,str(root/'scripts/docking/run.py'),str(job),str(base/'cache')],input=json.dumps(request),capture_output=True,text=True,timeout=90)
        return json.loads(p.stdout)
    inventory=run(action='inspect')
    assert any(r['name']=='ATP' and not r['supported'] for r in inventory['residues'])
    default=run(action='prepare')
    assert 'error' not in default,default
    assert default['structureData'] and default['atomCount']>1000
    assert all(r['protein'] for r in default['retained'])
    assert not default['cacheHit']
    assert run(action='prepare')['cacheHit']
    histidine=next(r for r in inventory['residues'] if r['name']=='HIS')
    water=next(r for r in inventory['residues'] if r['name']=='HOH')
    settings=dict(excludedChains=[],keepResidues=[water['id']],templates={histidine['id']:'HIP'})
    edited=run(action='prepare',preparation=settings)
    assert 'error' not in edited,edited
    assert not edited['cacheHit'] and edited['assignments'][histidine['id']]=='HIP'
    assert any(r['id']==water['id'] for r in edited['retained'])
    assert edited['structureData']!=default['structureData']
    assert run(action='prepare',preparation=settings)['cacheHit']
    atp=next(r for r in inventory['residues'] if r['name']=='ATP')
    assert 'error' in run(action='prepare',preparation=dict(keepResidues=[atp['id']]))
    chains=list({r['chain'] for r in inventory['residues'] if r['protein']})
    assert 'error' in run(action='prepare',preparation=dict(excludedChains=chains))
    assert 'error' in run(action='prepare',preparation=dict(templates={histidine['id']:'INVALID'}))
    output=run(action='dock',scoring='vinardo',preparation=settings,smiles='Cn1c(=O)c2c(ncn2C)n(C)c1=O',seed=2026,exhaustiveness=8,cpu=4,pocket=project['pockets'][0])
    assert 'error' not in output,output
    assert output['scoring']=='vinardo' and output['poses'] and output['preparation']['settings']==settings
    assert all(p['deltaScore']>=0 for p in output['poses'])
    print('Workbench checks passed: inventory, exclusions, retained water, histidine protonation, cache isolation, invalid settings, real Vinardo docking.')
