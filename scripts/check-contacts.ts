import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePDB } from 'molstar/lib/mol-io/reader/pdb/parser';
import { trajectoryFromPDB } from 'molstar/lib/mol-model-formats/structure/pdb';
import { Structure, StructureProperties as P, StructureElement, Unit } from 'molstar/lib/mol-model/structure';
import { Task } from 'molstar/lib/mol-task';
import { AssetManager } from 'molstar/lib/mol-util/assets';
import { analyzeContacts, ligandTargets, receptorInventory } from '../src/molstar/contacts';

async function check() {
  const pdb=await parsePDB(readFileSync('demo/canonical-project/structure.pdb','utf8'),'1ATP').run();
  assert(!pdb.isError);
  if(pdb.isError)return;
  const trajectory=await trajectoryFromPDB(pdb.result).run();
  const structure=Structure.ofModel(trajectory.representative);
  const ligands=ligandTargets(structure);
  assert.equal(ligands.length,1);
  assert.equal(ligands[0].name,'ATP');
  const inventory=receptorInventory(structure);
  assert(inventory.some(r=>r.name==='ATP'&&!r.supported));
  const contacts=await Task.create('Contact check',runtime=>analyzeContacts({runtime,assetManager:new AssetManager()},structure,ligands[0].id)).run();
  assert(contacts.some(c=>c.kind==='Hydrogen Bond'&&c.residue.name==='LYS'));
  assert.equal(contacts.filter(c=>c.kind==='Metal Coordination').length,4);
  const signatures=contacts.map(c=>`${c.kind}:${c.residue.chain}:${c.residue.seq}:${c.receptorAtom}:${c.ligandAtom}`);
  assert.equal(new Set(signatures).size,signatures.length,'Do not count donor/acceptor reversals twice');
  assert(contacts.every(c=>Number.isFinite(c.distance)&&c.distance>0));
  assert(contacts.every(c=>c.residue.name!=='ATP'),'No intraligand contacts');
  assert(contacts.filter(c=>c.kind==='Steric overlap').every(c=>(c.overlap??0)>0.6&&c.residue.name!=='MN'));
  // Reparse into an independent model, then combine its ATP with the original receptor.
  // This reproduces the cross-model boundary used by docked SDF poses.
  const second=Structure.ofModel((await trajectoryFromPDB(pdb.result).run()).representative);
  const builder=Structure.Builder();
  for(const source of [structure,second]) for(const unit of source.units) {
    if(!Unit.isAtomic(unit))continue;
    const location=StructureElement.Location.create(source,unit,unit.elements[0]);
    const atp=P.atom.label_comp_id(location)==='ATP';
    if((source===structure&&atp)||(source===second&&!atp))continue;
    builder.addUnit(unit.kind,unit.model,unit.conformation.operator,unit.elements,unit.traits);
  }
  const combined=builder.getStructure();
  const docked=await Task.create('Cross-model contacts',runtime=>analyzeContacts({runtime,assetManager:new AssetManager()},combined,'docked',second.models[0].id)).run();
  assert(docked.some(c=>c.kind==='Hydrogen Bond'),'Docked ligand must interact across model boundaries');
  assert.equal(docked.filter(c=>c.kind==='Metal Coordination').length,4);
  const empty=await Task.create('Missing target',runtime=>analyzeContacts({runtime,assetManager:new AssetManager()},structure,'missing')).run();
  assert.equal(empty.length,0);
  console.log(`Contact checks passed: ${contacts.length} ATP contacts, real metal/H-bond geometry, no duplicate or self contacts, missing target.`);
}
check().catch(e=>{console.error(e);process.exitCode=1;});
