"""Rebuild the curated fixture from an unmodified Discngine/fpocket checkout.
Usage: python3 scripts/prepare-reference.py /path/to/fpocket
This is an offline authoring utility; the application reads only the normalized bundle.
"""
import json, pathlib, re, shutil, sys
source = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parents[1] / 'demo/canonical-project'
raw = source / 'tests/reference_output/1ATP_out'
pockets = []
blocks = re.split(r'Pocket\s+(\d+)\s*:', (raw / '1ATP_info.txt').read_text())
for i in range(1, len(blocks), 2):
    rank = int(blocks[i])
    metrics = {m.group(1).strip(): float(m.group(2)) for m in re.finditer(r'^\s*([^:\n]+):\s*([-+\d.eE]+)', blocks[i+1], re.M)}
    residues = {}
    for line in (raw / f'pockets/pocket{rank}_atm.pdb').read_text().splitlines():
        if line.startswith(('ATOM  ', 'HETATM')):
            r = dict(chain=line[21].strip(), seq=int(line[22:26]), name=line[17:20].strip(), insertionCode=line[26].strip())
            residues[(r['chain'], r['seq'], r['insertionCode'], r['name'])] = r
    spheres = []
    for line in (raw / f'pockets/pocket{rank}_vert.pqr').read_text().splitlines():
        if line.startswith(('ATOM', 'HETATM')):
            fields = line.split()
            spheres.append(dict(center=list(map(float, fields[-5:-2])), radius=float(fields[-1])))
    assert spheres
    center = [sum(s['center'][a] for s in spheres)/len(spheres) for a in range(3)]
    features = [dict(name=k, value=v, unit='Å³' if k=='Volume' else 'Å' if k=='Mean alpha sphere radius' else None) for k,v in metrics.items()]
    pockets.append(dict(id=f'pocket-{rank:02}',rank=rank,center=center,residues=list(residues.values()),fpocket=metrics,prediction=None,features=features,geometry=dict(alphaSpheres=spheres)))
project = dict(schemaVersion=1,id='1atp-reference',name='Protein kinase A',description='ATP-bound catalytic subunit · 1ATP',structure=dict(id='1ATP',path='structure.pdb',format='pdb',source='RCSB PDB · 1ATP'),model=dict(name='SLiPP++',version=None,classes=['ADN','B12','BGC','CLR','COA','MYR','OLA','PLM','PP','STE'],calibration='Not supplied'),provenance='Geometry and descriptors: Discngine/fpocket reference output, commit 4bb0d8447f62fee77e2c3c29f54b5fcaf5e2c066. This structural reference has no matched SLiPP++ predictions.',pockets=pockets)
shutil.copyfile(source/'data/sample/1ATP.pdb',out/'structure.pdb')
(out/'studio.json').write_text(json.dumps(project,indent=2)+'\n')
print(f'{len(pockets)} pockets; {sum(len(p["geometry"]["alphaSpheres"]) for p in pockets)} alpha spheres')
