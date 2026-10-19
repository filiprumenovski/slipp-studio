import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { DockingResult, LoadedProject, Pocket, PreparationSettings } from './types';
import { LIPID_CLASSES, LIPID_TAXONOMY } from './types';
import initialLipids from './data/lipids.json';

export interface Lipid {id:string;name:string;smiles:string;source:string}
export interface LibraryEntry {path:string;name:string;format:'pdb'|'mmcif';size:number;file?:File}
export interface ScreeningRun {
  id:string;lipid:Lipid;pocket:Pocket;preparation:PreparationSettings;scoring:'vina'|'vinardo';seed:number;effort:number;
  status:'queued'|'running'|'complete'|'failed'|'canceled'|'paused';created:string;result?:DockingResult;error?:string;
}
export interface ProteinDocument {loaded:LoadedProject;preparation:PreparationSettings;runs:ScreeningRun[];selectedRun:string|null;pose:number}
export interface WorkspaceData {version:1;activeId:string|null;documents:Record<string,ProteinDocument>;lipids:Lipid[];library:LibraryEntry[];folder:string}
const emptyPreparation=():PreparationSettings=>({excludedChains:[],keepResidues:[],templates:{}});
const initial:WorkspaceData={version:1,activeId:null,documents:{},lipids:initialLipids,library:[],folder:''};
interface WorkspaceState extends WorkspaceData {
  hydrated:boolean;saveError:string;operation:string;
  open:(loaded:LoadedProject)=>void;
  setPreparation:(preparation:PreparationSettings)=>void;
  updateDocument:(id:string,change:Partial<ProteinDocument>)=>void;
  setLibrary:(library:LibraryEntry[],folder:string)=>void;
  addLipid:(lipid:Lipid)=>void;
}
export const useWorkspace=create<WorkspaceState>((set)=>({...initial,hydrated:false,saveError:'',operation:'',
  open:loaded=>set(s=>({activeId:loaded.project.id,documents:{...s.documents,[loaded.project.id]:s.documents[loaded.project.id]??{loaded,preparation:emptyPreparation(),runs:[],selectedRun:null,pose:0}}})),
  setPreparation:preparation=>set(s=>s.activeId?{documents:{...s.documents,[s.activeId]:{...s.documents[s.activeId],preparation}}}:{}),
  updateDocument:(id,change)=>set(s=>({documents:{...s.documents,[id]:{...s.documents[id],...change}}})),
  setLibrary:(library,folder)=>set({library,folder}),
  addLipid:lipid=>set(s=>({lipids:[...s.lipids,lipid]})),
}));
export function activeDocument(){const s=useWorkspace.getState();return s.activeId?s.documents[s.activeId]:undefined;}
export function workspaceSnapshot():WorkspaceData {
  const {activeId,documents,lipids,library,folder}=useWorkspace.getState();
  return {version:1,activeId,documents,lipids,library,folder};
}
export function parseWorkspace(value:unknown):WorkspaceData {
  const fail=()=>{throw Error('Invalid or unsupported SLiPP workspace.');};
  if(!value||typeof value!=='object')return fail();
  const w=value as WorkspaceData;
  if(w.version!==1||!w.documents||Array.isArray(w.documents)||typeof w.documents!=='object'||!Array.isArray(w.library)||!Array.isArray(w.lipids)||typeof w.folder!=='string'||Object.keys(w.documents).length>1000||w.library.length>10000||w.lipids.length>1000)return fail();
  const finite=(n:unknown)=>typeof n==='number'&&Number.isFinite(n);
  const text=(s:unknown)=>typeof s==='string';
  const lipid=(l:Lipid)=>l&&text(l.id)&&text(l.name)&&text(l.source)&&text(l.smiles)&&l.smiles.length<=2048;
  const preparation=(p:PreparationSettings)=>p&&Array.isArray(p.excludedChains)&&p.excludedChains.every(text)&&Array.isArray(p.keepResidues)&&p.keepResidues.every(text)&&p.templates&&Object.values(p.templates).every(text);
  const classScores=(c:NonNullable<Pocket['prediction']>['lipidClasses'])=>c===undefined||(c&&c.taxonomyVersion===LIPID_TAXONOMY&&c.scores&&Object.keys(c.scores).length===LIPID_CLASSES.length&&LIPID_CLASSES.every(k=>finite(c.scores[k])&&c.scores[k]>=0&&c.scores[k]<=1));
  const pocket=(p:Pocket)=>p&&text(p.id)&&finite(p.rank)&&Array.isArray(p.center)&&p.center.length===3&&p.center.every(finite)&&Array.isArray(p.residues)&&p.residues.every(r=>text(r.chain)&&Number.isInteger(r.seq)&&text(r.name)&&text(r.insertionCode))&&p.fpocket&&Object.values(p.fpocket).every(finite)&&Array.isArray(p.features)&&p.features.every(f=>text(f.name)&&finite(f.value))&&p.geometry&&Array.isArray(p.geometry.alphaSpheres)&&p.geometry.alphaSpheres.length<=50000&&p.geometry.alphaSpheres.every(s=>finite(s.radius)&&s.radius>0&&Array.isArray(s.center)&&s.center.length===3&&s.center.every(finite))&&(!p.prediction||(classScores(p.prediction.lipidClasses)&&text(p.prediction.label)&&finite(p.prediction.probability)&&p.prediction.probability>=0&&p.prediction.probability<=1&&p.prediction.probabilities&&Object.values(p.prediction.probabilities).every(v=>finite(v)&&v>=0&&v<=1)));
  if(!w.lipids.every(lipid)||w.library.some(e=>!e||!text(e.path)||!text(e.name)||!['pdb','mmcif'].includes(e.format)||!finite(e.size)))return fail();
  for(const [id,d] of Object.entries(w.documents)) {
    if(["__proto__","constructor","prototype"].includes(id))return fail();
    const l=d?.loaded,p=l?.project;
    if(!p||p.id!==id||p.schemaVersion!==1||!text(p.name)||!text(p.description)||!text(p.provenance)||!p.structure||!text(p.structure.id)||!['pdb','mmcif'].includes(p.structure.format)||!text(l.structureData)||l.structureData.length>20_000_000||!Array.isArray(l.warnings)||!Array.isArray(p.pockets)||p.pockets.length>10000||!p.pockets.every(pocket)||!p.model||!text(p.model.name)||!Array.isArray(p.model.classes)||!p.model.classes.every(text)||!text(p.model.calibration)||!preparation(d.preparation)||!Array.isArray(d.runs)||d.runs.length>10000||!Number.isInteger(d.pose)||d.pose<0)return fail();
    if(new Set(p.pockets.map(x=>x.id)).size!==p.pockets.length||new Set(p.pockets.map(x=>x.rank)).size!==p.pockets.length)return fail();
    for(const pocket of p.pockets){
      const prediction=pocket.prediction;if(!prediction)continue;
      const probabilities=prediction.probabilities;
      if(!text(p.model.version)||!p.model.version||!p.model.classes.includes(prediction.label)||Object.keys(probabilities).length!==p.model.classes.length||Object.keys(probabilities).some(k=>!p.model.classes.includes(k))||Math.abs(Object.values(probabilities).reduce((a,b)=>a+b,0)-1)>.001||Math.abs(probabilities[prediction.label]-prediction.probability)>.001)return fail();
    }
    for(const r of d.runs) {
      if(!text(r.id)||!lipid(r.lipid)||!pocket(r.pocket)||!preparation(r.preparation)||!['vina','vinardo'].includes(r.scoring)||!Number.isInteger(r.seed)||r.seed<1||r.seed>2147483647||!Number.isInteger(r.effort)||r.effort<1||r.effort>128||!['queued','running','complete','failed','canceled','paused'].includes(r.status))return fail();
      if(!w.lipids.some(l=>l.id===r.lipid.id&&l.smiles===r.lipid.smiles&&l.name===r.lipid.name))return fail();
      if(r.status==='complete'&&!r.result)return fail();
      if(r.result) {
        const result=r.result;
        if(result.pocketId!==r.pocket.id||!['vina','vinardo'].includes(result.scoring)||!text(result.engine)||!Array.isArray(result.poses)||!result.poses.length||result.poses.length>100||!result.poses.every(p=>text(p.sdf)&&p.sdf.length<1_000_000&&[p.score,p.deltaScore,p.rank,p.rmsdLower,p.rmsdUpper,p.components?.inter,p.components?.intra,p.components?.unbound].every(finite))||!text(result.preparation?.structureData)||!preparation(result.preparation?.settings)||!Array.isArray(result.warnings)||!result.warnings.every(text)||![result.wallSeconds,result.cpu,result.seed,result.exhaustiveness,result.preparationSeconds,result.searchSeconds].every(finite)||!Array.isArray(result.center)||!result.center.every(finite)||!Array.isArray(result.size)||!result.size.every(finite))return fail();
      }
      if(r.status==='queued'||r.status==='running')r.status='paused';
    }
    if(d.selectedRun&&!d.runs.some(r=>r.id===d.selectedRun))d.selectedRun=null;
    const selected=d.runs.find(r=>r.id===d.selectedRun);if(d.pose>=(selected?.result?.poses.length??1))d.pose=0;
  }
  if(w.activeId!==null&&(!text(w.activeId)||!Object.hasOwn(w.documents,w.activeId)))return fail();
  return w;
}
let database:IDBDatabase;
let restoreBlocked=false;
let timer:ReturnType<typeof setTimeout>|undefined;
export async function initializeWorkspace() {
  try {
    database=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('slipp-studio',1);request.onupgradeneeded=()=>request.result.createObjectStore('workspace');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const value=await new Promise<unknown>((resolve,reject)=>{const r=database.transaction('workspace').objectStore('workspace').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    if(value)useWorkspace.setState(parseWorkspace(value));
  } catch(e){restoreBlocked=true;useWorkspace.setState({saveError:`Workspace restore failed: ${String(e)}. Autosave is paused to preserve existing data; export a workspace copy before closing.`});}
  useWorkspace.setState({hydrated:true});
  useWorkspace.subscribe((s,previous)=>{
    if(s.documents===previous.documents&&s.library===previous.library&&s.lipids===previous.lipids&&s.activeId===previous.activeId&&s.folder===previous.folder)return;
    clearTimeout(timer);timer=setTimeout(()=>void persistWorkspace(),250);
  });
}
// ponytail: whole-workspace snapshots; split into per-document stores if large screens make saves slow.
export async function persistWorkspace() {
  clearTimeout(timer);
  if(!database||restoreBlocked)return;
  try {
    await new Promise<void>((resolve,reject)=>{const tx=database.transaction('workspace','readwrite');tx.objectStore('workspace').put(workspaceSnapshot(),'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    if(useWorkspace.getState().saveError)useWorkspace.setState({saveError:''});
  } catch(e){useWorkspace.setState({saveError:`Workspace could not be saved: ${String(e)}. Export a workspace copy.`});}
}

let queueRunning=false,stopRequested=false;
export async function runQueue() {
  if(queueRunning)return;
  queueRunning=true;stopRequested=false;
  useWorkspace.setState({operation:'Docking screen'});
  try {
    while(!stopRequested) {
      const s=useWorkspace.getState();
      const entry=Object.entries(s.documents).flatMap(([id,d])=>d.runs.filter(r=>r.status==='queued').map(run=>({id,run,loaded:d.loaded})))[0];
      if(!entry)break;
      const {id,run,loaded}=entry;
      const update=(change:Partial<ScreeningRun>)=>{const current=useWorkspace.getState();current.updateDocument(id,{runs:current.documents[id].runs.map(r=>r.id===run.id?{...r,...change}:r)});};
      update({status:'running',error:undefined});await persistWorkspace();
      try {
        const result=await invoke<DockingResult>('run_docking',{request:{smiles:run.lipid.smiles,scoring:run.scoring,preparation:run.preparation,pocket:run.pocket,seed:run.seed,exhaustiveness:run.effort,structureData:loaded.structureData,format:loaded.project.structure.format}});
        update({status:'complete',result});
      } catch(e){update({status:stopRequested?'canceled':'failed',error:String(e)});}
      await persistWorkspace();
    }
  } finally {queueRunning=false;useWorkspace.setState({operation:''});await persistWorkspace();}
}
export async function stopQueue() {
  stopRequested=true;
  const s=useWorkspace.getState();
  for(const [id,d] of Object.entries(s.documents))s.updateDocument(id,{runs:d.runs.map(r=>r.status==='queued'?{...r,status:'paused'}:r)});
  await invoke('cancel_docking');
}
