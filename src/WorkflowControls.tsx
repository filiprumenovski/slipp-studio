import { useEffect, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Download, FlaskConical, LoaderCircle, Save, FolderOpen } from 'lucide-react';
import { useWorkspace, workspaceSnapshot, parseWorkspace, persistWorkspace, type ProteinDocument } from './workspace';
import { useStudio } from './store';
import { StructurePicker } from './StructurePicker';
import type { LoadedProject, StudioProject } from './types';

export function WorkflowControls({onError,home=false}:{onError:(s:string)=>void;home?:boolean}) {
  const w=useWorkspace(), loaded=w.activeId?w.documents[w.activeId]?.loaded:null;
  const inferenceModel=useStudio(s=>s.inferenceModel);
  const modelName=inferenceModel==='slipp'?'SLiPP':'SaProt–EGNN';
  const [source,setSource]=useState(''),[available,setAvailable]=useState(false),[auto,setAuto]=useState(true);
  const file=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(isTauri())void invoke<boolean>('science_status').then(setAvailable).catch(e=>onError(String(e)));},[onError]);
  async function analyze(input:LoadedProject) {
    useWorkspace.setState({operation:`Detecting pockets · ${modelName} inference`});
    const doc=useWorkspace.getState().documents[input.project.id];
    const result=await invoke<Pick<StudioProject,'pockets'|'model'|'provenance'>>('run_docking',{request:{action:'analyze',inferenceModel,structureData:input.structureData,format:input.project.structure.format,preparation:doc?.preparation??{}}});
    const s=useWorkspace.getState();
    const next={...input,project:{...input.project,...result}};
    // Retain completed analyses before replacing pocket geometry referenced by old runs.
    if(doc&&(doc.runs.length||input.project.pockets.some(p=>p.prediction))){const id=input.project.id+'@'+Date.now();s.updateDocument(id,{...doc,loaded:{...input,project:{...input.project,id,name:input.project.name+' · previous analysis'}}});}
    s.updateDocument(input.project.id,{loaded:next,preparation:doc?.preparation??{excludedChains:[],keepResidues:[],templates:{}},runs:[],selectedRun:null,pose:0});
    if(s.activeId!==input.project.id)return;
    useWorkspace.setState({activeId:input.project.id});
    const best=[...result.pockets].sort((a,b)=>(b.prediction?.probability??0)-(a.prediction?.probability??0))[0];
    useStudio.getState().select(best?.id??null);useStudio.getState().setTab('overview');
  }
  async function run(action:'fetch'|'analyze') {
    if(w.operation||!w.hydrated)return;
    try {
      if(action==='fetch'){
        useWorkspace.setState({operation:'Downloading PDB coordinates'});
        const next=await invoke<LoadedProject>('run_docking',{request:{action:'fetch',source}});
        useWorkspace.getState().open(next);useStudio.getState().select(null);
        if(auto)await analyze(useWorkspace.getState().documents[next.project.id].loaded);
      } else if(loaded)await analyze(loaded);
      await persistWorkspace();
    } catch(e){onError(String(e));}finally{useWorkspace.setState({operation:''});}
  }
  async function exportWorkspace() {
    try {
      const snapshot=workspaceSnapshot();
      const text=JSON.stringify({...snapshot,library:snapshot.library.map(({file,...entry})=>entry)});
      if(isTauri()){
        const path=await save({defaultPath:'workspace.slipp',filters:[{name:'SLiPP workspace',extensions:['slipp']}]});
        if(path)await invoke('save_export',{path,bytes:Array.from(new TextEncoder().encode(text))});
      } else {const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='workspace.slipp';a.click();URL.revokeObjectURL(url);}
    } catch(e){onError(String(e));}
  }
  async function restore(text:string) {
    const restored=parseWorkspace(JSON.parse(text));
    // Import merges documents; it never discards the current workspace.
    const current=useWorkspace.getState();
    const docs:Record<string,ProteinDocument>={...current.documents};let active=restored.activeId;
    const incoming=restored.lipids.map(l=>{const existing=current.lipids.find(x=>x.id===l.id);return existing&&(existing.smiles!==l.smiles||existing.name!==l.name)?{...l,id:crypto.randomUUID()}:l;});
    const lipidMap=new Map(restored.lipids.map((l,i)=>[l.id,incoming[i]]));
    for(const [original,doc] of Object.entries(restored.documents)){
      const id=docs[original]?`${original}@import-${Date.now()}`:original;
      docs[id]={...doc,runs:doc.runs.map(r=>({...r,lipid:lipidMap.get(r.lipid.id)!})),loaded:{...doc.loaded,project:{...doc.loaded.project,id}}};if(original===active)active=id;
    }
    useWorkspace.setState({documents:docs,activeId:active,lipids:[...current.lipids,...incoming.filter(l=>!current.lipids.some(x=>x.id===l.id))],library:restored.library,folder:restored.folder});
    useStudio.getState().select(null);await persistWorkspace();
  }
  async function importWorkspace() {
    if(!isTauri()){file.current?.click();return;}
    try {const path=await open({multiple:false,filters:[{name:'SLiPP workspace',extensions:['slipp']}]});if(path)await restore(await invoke<string>('read_workspace',{path}));}catch(e){onError(String(e));}
  }
  return <div className={`workflow-controls ${home?"home-workflow":""}`}>
    <details open={home||undefined}><summary>{home?"Retrieve by PDB ID / import workspace":"Import PDB / workspace"}</summary>
      <form onSubmit={e=>{e.preventDefault();void run('fetch');}}><label>PDB ID or entry link<input aria-label="PDB ID or link" value={source} maxLength={2048} placeholder="7T1M or RCSB / PDBe link" onChange={e=>setSource(e.target.value)}/></label>
        <label className="workflow-check"><input type="checkbox" checked={auto} onChange={e=>setAuto(e.target.checked)}/> Detect and rank pockets</label>
        <button className="quiet" disabled={!w.hydrated||!isTauri()||!source.trim()||!!w.operation||(auto&&!available)}><Download size={12}/> Download structure</button>
      </form>
      <div className="workflow-actions"><button className="quiet" onClick={()=>void exportWorkspace()} disabled={!Object.keys(w.documents).length}><Save size={12}/> Export workspace</button><button className="quiet" disabled={!w.hydrated||!!w.operation} onClick={()=>void importWorkspace()}><FolderOpen size={12}/> Import</button></div>
      <input ref={file} type="file" hidden accept=".slipp" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f){if(f.size>250_000_000){onError('Workspace exceeds 250 MB.');return;}void f.text().then(restore).catch(e=>onError(String(e)));}}}/>
      {!isTauri()&&<p>Downloads and computation run in the native application.</p>}
    </details>
    {!home&&<StructurePicker/>}
    {!home&&loaded&&<button className="primary analyze-button" disabled={!available||!!w.operation} onClick={()=>void run('analyze')}><FlaskConical size={12}/>{loaded.project.pockets.length?'Recompute':'Detect'} pockets + {modelName}</button>}
    {w.operation&&w.operation!=='Docking screen'&&<div className="workflow-progress"><LoaderCircle size={12} className="spin"/>{w.operation}<button className="quiet" onClick={()=>void invoke('cancel_docking').catch(e=>onError(String(e)))}>Cancel</button></div>}
    {(home||loaded)&&!available&&isTauri()&&<p>Install the scientific runtime with scripts/setup-science.sh.</p>}
    {home&&isTauri()&&available&&<p className="home-runtime"><span className="dot teal"/> fpocket + SLiPP runtime installed</p>}
    {w.saveError&&<p className="docking-error" role="alert">{w.saveError}</p>}
  </div>;
}
