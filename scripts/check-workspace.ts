import assert from 'node:assert/strict';
import { fitPanes } from '../src/PaneDivider';
for(const width of [801,1080,1440,2400]) {
  for(const desired of [{left:218,right:350},{left:9999,right:9999},{left:-1,right:-1}]) {
    const panes=fitPanes(width,desired);
    assert(panes.left>=170&&panes.left<=380);assert(panes.right>=280&&panes.right<=640);
    assert(width-panes.left-panes.right-10>=300,'Molecular view keeps its minimum width');
    assert.deepEqual(fitPanes(width,panes),panes,'Clamped layouts are stable');
  }
}
assert.deepEqual(fitPanes(1440,{left:260,right:420}),{left:260,right:420});
import { readFileSync } from 'node:fs';
import { parseWorkspace, useWorkspace, workspaceSnapshot, type ScreeningRun } from '../src/workspace';
import type { LoadedProject } from '../src/types';
import { LIPID_CLASSES, LIPID_TAXONOMY } from '../src/types';
const loaded:LoadedProject={project:JSON.parse(readFileSync('demo/canonical-project/studio.json','utf8')),structureData:readFileSync('demo/canonical-project/structure.pdb','utf8'),warnings:[]};
useWorkspace.getState().open(loaded);
const first=loaded.project.id;
useWorkspace.getState().setPreparation({excludedChains:['I'],keepResidues:[],templates:{'E:87':'HIP'}});
const run:ScreeningRun={id:'run1',lipid:useWorkspace.getState().lipids[0],pocket:loaded.project.pockets[0],preparation:useWorkspace.getState().documents[first].preparation,scoring:'vina',seed:2026,effort:8,status:'running',created:new Date().toISOString()};
useWorkspace.getState().updateDocument(first,{runs:[run],selectedRun:'run1'});
useWorkspace.getState().open({...loaded,project:{...loaded.project,id:'second',name:'Second'}});
assert.deepEqual(useWorkspace.getState().documents.second.preparation.excludedChains,[]);
useWorkspace.getState().open(loaded);
assert.deepEqual(useWorkspace.getState().documents[first].preparation.excludedChains,['I']);
assert.equal(useWorkspace.getState().documents[first].runs[0].id,'run1');
const restored=parseWorkspace(JSON.parse(JSON.stringify(workspaceSnapshot())));
const geometric=structuredClone(restored);
geometric.documents[first].loaded.project.model={name:'SaProt–EGNN',version:'test-fold2',classes:['non-lipid','lipid'],calibration:'Test fixture'};
const geometricPrediction=geometric.documents[first].loaded.project.pockets[0].prediction={label:'lipid',probability:.6,probabilities:{lipid:.6,'non-lipid':.4},lipidClasses:{taxonomyVersion:LIPID_TAXONOMY,scores:{} as Record<string,number>}};
geometricPrediction.lipidClasses={taxonomyVersion:LIPID_TAXONOMY,scores:Object.fromEntries(LIPID_CLASSES.map(k=>[k,.7]))};
assert.deepEqual(parseWorkspace(geometric).documents[first].loaded.project.pockets[0].prediction!.lipidClasses,geometricPrediction.lipidClasses,'Independent class scores survive without sum-to-one normalization');
for(const mutate of [(c:any)=>c.taxonomyVersion='legacy',(c:any)=>delete c.scores.SterolLipids,(c:any)=>c.scores.SterolLipids=1.1]){
  const bad=structuredClone(geometric);mutate(bad.documents[first].loaded.project.pockets[0].prediction!.lipidClasses);assert.throws(()=>parseWorkspace(bad));
}
assert.equal(restored.documents[first].runs[0].status,'paused','Interrupted jobs must require explicit resume');
assert.equal(restored.documents[first].preparation.templates['E:87'],'HIP');
for(const mutate of [(w:any)=>w.version=99,(w:any)=>w.documents[first].loaded.structureData=null,(w:any)=>w.documents[first].loaded.project.pockets[0].geometry.alphaSpheres[0].radius=-1,(w:any)=>w.documents[first].runs[0].status='complete',(w:any)=>w.activeId='missing']){
  const bad=JSON.parse(JSON.stringify(restored));mutate(bad);assert.throws(()=>parseWorkspace(bad));
}
console.log('Workspace checks passed: independent preparation, retained runs, round trip, paused recovery, malformed input rejection.');

async function checkQueue() {
  const {runQueue,stopQueue}=await import('../src/workspace');
  const requests:any[]=[];
  let active=0,maxActive=0;
  // Mock only the IPC boundary; exercise the actual queue and persisted run transitions.
  (globalThis as any).window={__TAURI_INTERNALS__:{invoke:async(command:string,args:any)=>{
    assert.equal(command,'run_docking');requests.push(args.request);active++;maxActive=Math.max(maxActive,active);
    await Promise.resolve();active--;
    if(requests.length===1)throw Error('Invalid ligand fixture');
    return {pocketId:args.request.pocket.id,poses:[{score:-5}]};
  }}};
  useWorkspace.getState().updateDocument(first,{runs:[{...run,id:'bad',status:'queued'},{...run,id:'good',status:'queued'}]});
  await Promise.all([runQueue(),runQueue()]);
  assert.equal(maxActive,1);assert.equal(requests.length,2);
  assert.deepEqual(useWorkspace.getState().documents[first].runs.map(r=>r.status),['failed','complete']);
  assert.deepEqual(requests[1].preparation,run.preparation,'Use the queued preparation snapshot');
  let started!:()=>void,rejectJob!:(e:Error)=>void;
  const start=new Promise<void>(resolve=>{started=resolve;});
  (globalThis as any).window.__TAURI_INTERNALS__.invoke=(command:string)=>{
    if(command==='cancel_docking'){rejectJob(Error('Canceled'));return Promise.resolve();}
    started();return new Promise((_,reject)=>{rejectJob=reject;});
  };
  useWorkspace.getState().updateDocument(first,{runs:[{...run,id:'cancel',status:'queued'},{...run,id:'pause',status:'queued'}]});
  const pending=runQueue();await start;await stopQueue();await pending;
  assert.deepEqual(useWorkspace.getState().documents[first].runs.map(r=>r.status),['canceled','paused']);
  assert.equal(useWorkspace.getState().operation,'');
  delete (globalThis as any).window;
  console.log('Queue checks passed: serial execution, immutable requests, continue after failure, cancellation and pending-job pause.');
}
checkQueue().catch(e=>{console.error(e);process.exitCode=1;});
