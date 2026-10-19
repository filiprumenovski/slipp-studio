import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePDB } from 'molstar/lib/mol-io/reader/pdb/parser';
import { trajectoryFromPDB } from 'molstar/lib/mol-model-formats/structure/pdb';
import { Structure } from 'molstar/lib/mol-model/structure';
import { Task } from 'molstar/lib/mol-task';
import { AssetManager } from 'molstar/lib/mol-util/assets';
import { analyzeAnatomy, rayEscapes } from '../src/molstar/anatomy';
import { residueKey } from '../src/molstar/contacts';
import type { StudioProject } from '../src/types';

async function check() {
  assert(rayEscapes([0,0,0],[1,0,0],[]));
  assert(!rayEscapes([0,0,0],[1,0,0],[{center:[4,0,0],radius:1}]));
  assert(rayEscapes([0,0,0],[-1,0,0],[{center:[4,0,0],radius:1}]));
  assert(!rayEscapes([0,0,0],[-1,0,0],[{center:[1,0,0],radius:1}]),'Origin must fit the probe');
  assert(rayEscapes([0,0,0],[1,0,0],[{center:[4,3,0],radius:1}]));
  const source=readFileSync('demo/canonical-project/structure.pdb','utf8');
  const project:StudioProject=JSON.parse(readFileSync('demo/canonical-project/studio.json','utf8'));
  const pocket=project.pockets[0],lining=new Set(pocket.residues.map(residueKey));
  async function analyze(text:string, target=pocket) {
    const pdb=await parsePDB(text,'1ATP').run();assert(!pdb.isError);if(pdb.isError)throw Error('Parse failed');
    const structure=Structure.ofModel((await trajectoryFromPDB(pdb.result).run()).representative);
    return Task.create('Anatomy check',runtime=>analyzeAnatomy({runtime,assetManager:new AssetManager()},structure,target)).run();
  }
  const start=performance.now();
  const result=await analyze(source);
  const elapsed=performance.now()-start;
  assert(result.atoms.length>100);
  assert(result.atoms.every(a=>lining.has(residueKey(a.residue))));
  assert(result.atoms.some(a=>a.residue.name==='LYS'&&a.name==='NZ'&&a.roles.includes('Donor')));
  assert(result.atoms.some(a=>a.name==='O'&&a.roles.includes('Acceptor')));
  assert(result.atoms.some(a=>a.roles.includes('Hydrophobic')));
  assert(result.neighbors.length>=result.atoms.length);
  assert(result.chains.some(c=>c.id==='E'));
  assert(result.neighbors.every(a=>pocket.geometry.alphaSpheres.some(s=>a.position.reduce((n,v,i)=>n+(v-s.center[i])**2,0)<=(s.radius+5)**2)));
  const exposed=await analyze(source,{...pocket,geometry:{alphaSpheres:[{center:[1000,0,0],radius:4}]}});
  assert(exposed.openings.length>0,'An unobstructed sphere must expose access markers');
  assert(exposed.openings.every(p=>Math.abs(Math.hypot(p[0]-1000,p[1],p[2])-4)<1e-6),'Markers must lie on the sphere envelope');
  assert(result.openings.every(p=>p.every(Number.isFinite)));
  const surface=await analyze(source,project.pockets[19]);
  assert(surface.openings.length>0&&surface.openings.every(p=>p.every(Number.isFinite)),'Reference surface pocket must expose finite access markers');
  assert(result.escapeRays<=result.testedRays);
  assert(result.testedRays<=128*96);
  assert(result.dimensions.every(d=>d>0&&Number.isFinite(d)));
  // Ligand occupancy must not alter this ligand-free inspection.
  const apo=await analyze(source.split('\n').filter(l=>!l.startsWith('HETATM')&&!l.startsWith('CONECT')).join('\n'));
  assert.deepEqual(result.openings,apo.openings);
  assert.deepEqual(result.atoms,apo.atoms);
  console.log(`Anatomy checks passed: ${result.atoms.length} lining atoms, ${result.chains.length} nearby chains, ${result.openings.length} access samples; ${Math.round(elapsed)} ms including parsing.`);
}
check().catch(e=>{console.error(e);process.exitCode=1;});
