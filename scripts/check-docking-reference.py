"""Redock the upstream 1IEP control: python SCRIPT /path/to/AutoDock-Vina checkout.
Uses its prepared receptor and ligand, so this checks engine integration, not
Studio's protein preparation. Nothing is downloaded by this check.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from rdkit import Chem
from rdkit.Chem import rdMolAlign
from meeko import PDBQTMolecule, RDKitMolCreate
root=Path(__file__).resolve().parent.parent
source=Path(sys.argv[1])
data=source/'example/basic_docking/solution'
engine=root/'.venv-docking/bin/vina'
reference=Chem.SDMolSupplier(str(data/'1iep_ligand.sdf'),removeHs=True)[0]
assert reference is not None
rows=[]
with tempfile.TemporaryDirectory(prefix='slipp-redock-') as directory:
 for seed in [2026,2027,2028]:
  out=Path(directory)/f'{seed}.pdbqt'
  start=time.perf_counter()
  process=subprocess.run([str(engine),'--receptor',str(data/'1iep_receptor.pdbqt'),'--ligand',str(data/'1iep_ligand.pdbqt'),'--config',str(data/'1iep_receptor.box.txt'),'--cpu','4','--seed',str(seed),'--exhaustiveness','32','--num_modes','10','--out',str(out)],capture_output=True,text=True,timeout=300)
  assert process.returncode==0,process.stderr
  seconds=time.perf_counter()-start
  mol=RDKitMolCreate.from_pdbqt_mol(PDBQTMolecule(out.read_text(),skip_typing=True))[0]
  mol=Chem.RemoveHs(mol)
  assert Chem.MolToSmiles(mol)==Chem.MolToSmiles(reference)
  # No alignment: compare poses in the receptor frame, accounting for symmetry.
  rmsds=[rdMolAlign.CalcRMS(mol,reference,prbId=i,maxMatches=100000) for i in range(mol.GetNumConformers())]
  scores=[float(l.split()[3]) for l in out.read_text().splitlines() if l.startswith('REMARK VINA RESULT:')]
  row=dict(seed=seed,seconds=round(seconds,3),topScore=scores[0],topPoseRmsd=round(rmsds[0],3),bestSampledRmsd=round(min(rmsds),3),poses=[dict(rank=i+1,score=s,rmsd=round(r,3)) for i,(s,r) in enumerate(zip(scores,rmsds))]);rows.append(row)
  print(json.dumps(row),flush=True)
report=dict(control='1IEP imatinib, upstream prepared inputs',sourceCommit=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip(),engine='AutoDock Vina 1.2.7',exhaustiveness=32,cpu=4,metric='Symmetry-corrected heavy-atom RMSD without alignment, relative to crystallographic ligand',runs=rows)
(root/'docs/docking-reference-check.json').write_text(json.dumps(report,indent=2)+'\n')
assert sum(r['topPoseRmsd']<2 for r in rows)>=2, 'Majority of top-ranked poses did not recover the reference within 2 Å.'
print('Reference redocking check passed.')
