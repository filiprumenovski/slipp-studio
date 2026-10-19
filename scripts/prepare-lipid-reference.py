"""Author the BstB reference (7T1M; explicit MSE→MET preparation).
Run with .venv-docking/bin/python scripts/prepare-lipid-reference.py.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import urllib.request
import gemmi

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('inference', root/'scripts/inference/run.py')
inference = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inference)
out = root/'demo/lipid-reference'
out.mkdir(exist_ok=True)
url = 'https://files.rcsb.org/download/7T1M.pdb'
with urllib.request.urlopen(url, timeout=30) as response:
    data = response.read(20_000_001)
assert len(data) < 20_000_000
original = gemmi.read_pdb_string(data.decode())
assert len(original) == 1 and len(original[0]) == 1
assert {r.name for c in original[0] for r in c if not gemmi.find_tabulated_residue(r.name).is_amino_acid()} <= {'HOH', 'CL'}, 'Expected no bound lipid'
structure = original.clone()
converted = []
for chain in structure[0]:
    for residue in chain:
        if residue.name != 'MSE': continue
        converted.append(f'{chain.name}:{residue.seqid}')
        residue.name = 'MET'
        residue.het_flag = 'A'
        for atom in residue:
            if atom.element.name == 'Se':
                atom.element = gemmi.Element('S')
                atom.name = 'SD'
assert len(converted) == 9
assert [(a.pos.x,a.pos.y,a.pos.z) for c in original[0] for r in c for a in r] == [(a.pos.x,a.pos.y,a.pos.z) for c in structure[0] for r in c for a in r]
text = 'REMARK 900 SLIPP STUDIO REFERENCE: 7T1M, NINE MSE CONVERTED TO MET.\nREMARK 900 SE RENAMED SD/S; COORDINATES UNCHANGED; NO GAP REBUILD OR RELAXATION.\n' + structure.make_pdb_string()
cache = root/'.venv-docking/slipp-model-cache'
cache.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    result = inference.analyze(dict(structureData=text, format='pdb'), work, cache, work/'cancel')
    docking_spec = importlib.util.spec_from_file_location('docking', root/'scripts/docking/run.py')
    docking = importlib.util.module_from_spec(docking_spec)
    docking_spec.loader.exec_module(docking)
    _, prepared = docking.prepare_receptor(dict(structureData=text, format='pdb'), cache)
    assert prepared['atomCount'] > 0
assert result['pockets'] and all(p['prediction'] is not None for p in result['pockets'])
project = dict(schemaVersion=1, id='7t1m-bstb-reference', name='BstB · bacterial sterol-binding protein',
    description='Dassama Lab · Methylococcus capsulatus · 7T1M · apo · 1.60 Å · MSE→MET prepared copy',
    structure=dict(id='7T1M',path='structure.pdb',format='pdb',source=url),
    pockets=result['pockets'], model=result['model'],
    provenance=f'Bundled BstB reference. Zhai et al., Novel sterol binding domains in bacteria, https://doi.org/10.7554/eLife.90696. Deposited coordinates: {url}; SHA256 {hashlib.sha256(data).hexdigest()}; retained in deposited-7T1M.pdb. Prepared copy SHA256 {hashlib.sha256(text.encode()).hexdigest()}. Nine selenomethionines converted to methionine (MSE→MET, Se→S, atom SE→SD): {converted}. Atom coordinates unchanged; no minimization or missing-loop reconstruction. Waters and chloride retained in the input, excluded from default inference and docking. The paper reports C-4 methylsterol binding, with no detectable BstB binding to cholesterol or lanosterol under its assay conditions. This example is not a held-out validation or a reproduction of the published docking. '+result['provenance'])
(out/'deposited-7T1M.pdb').write_bytes(data)
(out/'structure.pdb').write_text(text)
(out/'studio.json').write_text(json.dumps(project,indent=2)+'\n')
print(f'BstB: {len(project["pockets"])} fpocket candidates; raw SLiPP '+str([p['prediction']['probability'] for p in project['pockets']]))
