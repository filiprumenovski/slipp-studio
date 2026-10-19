import { useEffect, useState, useRef } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Eye, FlaskConical, RotateCcw, LoaderCircle } from "lucide-react";
import { useWorkspace } from "./workspace";
import type { MolstarController } from "./molstar/MolstarController";
import type { LoadedProject, PreparationReport, PreparationResidue, PreparationSettings } from "./types";
const empty: PreparationSettings = { excludedChains:[],keepResidues:[],templates:{} };

export function PreparationPanel({loaded,viewer,active}:{loaded:LoadedProject;viewer:MolstarController|null;active:boolean}) {
  const settings=useWorkspace(s=>s.documents[loaded.project.id]?.preparation??empty), setSettings=useWorkspace(s=>s.setPreparation);
  const generation=useRef(0);
  const [inventory,setInventory]=useState<PreparationResidue[]>([]);
  const [report,setReport]=useState<PreparationReport|null>(null);
  const [preview,setPreview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [query,setQuery]=useState('');
  const [history,setHistory]=useState<PreparationSettings[]>([]);
  useEffect(()=>{
    generation.current++;
    if(!viewer)return;
    let canceled=false;
    setReport(null);setPreview(false);setHistory([]);setBusy(false);
    setInventory(viewer?.getReceptorInventory() ?? []);
    if(isTauri()&&!useWorkspace.getState().operation) void invoke<{residues:PreparationResidue[]}>("run_docking",{request:{action:'inspect',structureData:loaded.structureData,format:loaded.project.structure.format}})
      .then(r=>{if(!canceled)setInventory(r.residues);}).catch(e=>{if(!canceled)setError(String(e));});
    return()=>{canceled=true;generation.current++;};
  },[loaded,viewer,setSettings]);
  useEffect(()=>{
    if(!viewer)return;
    void viewer.showPreparation(active&&preview&&report ? report.structureData : null).catch(e=>setError(String(e)));
    return()=>{void viewer.showPreparation(null);};
  },[viewer,active,preview,report]);
  const chains=[...new Set(inventory.filter(r=>r.protein).map(r=>r.chain))];
  function change(next:PreparationSettings){setHistory(h=>[...h,settings]);setSettings(next);setReport(null);setPreview(false);}
  async function prepare(){
    const revision=generation.current;
    setBusy(true);setError('');setReport(null);
    try { const r=await invoke<PreparationReport>('run_docking',{request:{action:'prepare',structureData:loaded.structureData,format:loaded.project.structure.format,preparation:settings}});if(revision===generation.current){setReport(r);setPreview(true);} }
    catch(e){if(revision===generation.current)setError(String(e));}finally{if(revision===generation.current)setBusy(false);}
  }
  const hetero=inventory.filter(r=>!r.protein);
  const editable=inventory.filter(r=>['HIS','ASP','GLU','LYS'].includes(r.name)&&!settings.excludedChains.includes(r.chain));
  const templates:Record<string,string[]>={HIS:['HID','HIE','HIP'],ASP:['ASP','ASH'],GLU:['GLU','GLH'],LYS:['LYS','LYN']};
  return <>
    <section className="panel-section workbench-controls">
      <div className="section-label"><span>RECEPTOR PREPARATION</span><FlaskConical size={13}/></div>
      <div className="workbench-toolbar"><span>{inventory.length} residues · first model</span><button className="quiet" disabled={!history.length||busy} onClick={()=>{const previous=history.at(-1)!;setHistory(h=>h.slice(0,-1));setSettings(previous);setReport(null);setPreview(false);}}><RotateCcw size={11}/> Undo</button></div>
      <div className="section-label"><span>PROTEIN CHAINS</span></div>
      {chains.map(chain=><label className="prep-row" key={chain}><input type="checkbox" disabled={busy} checked={!settings.excludedChains.includes(chain)} onChange={e=>change({...settings,excludedChains:e.target.checked?settings.excludedChains.filter(c=>c!==chain):[...settings.excludedChains,chain],templates:Object.fromEntries(Object.entries(settings.templates).filter(([id])=>!id.startsWith(chain+':')))})}/><strong>Chain {chain||'∅'}</strong><span>{inventory.filter(r=>r.protein&&r.chain===chain).length} residues</span></label>)}
      <div className="docking-actions"><button className="primary" disabled={busy||!isTauri()||!chains.some(c=>!settings.excludedChains.includes(c))} onClick={()=>void prepare()}>{busy?<LoaderCircle size={12} className="spin"/>:<FlaskConical size={12}/>} {busy?'Preparing…':'Prepare & preview'}</button><button className="quiet" disabled={busy} onClick={()=>change(empty)}>Reset</button></div>
      {!isTauri()&&<p className="descriptor-note">Inspect settings here; receptor preparation runs in the native application.</p>}
      {error&&<p role="alert" className="docking-error">{error}</p>}
      {report&&<div className="prep-report"><strong>{report.atomCount.toLocaleString()} docking atoms</strong><span>{report.retained.length} residues retained · {report.removed.length} removed</span><label className="docking-visibility"><input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)}/><Eye size={12}/> Prepared receptor preview</label><small>Meeko templates assign hydrogens. {report.alternateResidues} residues had alternate locations; one conformation was retained.</small></div>}
    </section>
    <section className="panel-section workbench-controls">
      <div className="section-label"><span>WATERS, IONS & COFACTORS</span><span>{hetero.length}</span></div>
      <input aria-label="Filter preparation residues" placeholder="Filter residue name or ID" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="prep-residues">{hetero.filter(r=>`${r.name} ${r.id}`.toLowerCase().includes(query.toLowerCase())).map(r=><div className="prep-row" key={r.id}>
        <input aria-label={`Retain ${r.name} ${r.id}`} type="checkbox" disabled={busy||!r.supported||settings.excludedChains.includes(r.chain)} checked={settings.keepResidues.includes(r.id)&&!settings.excludedChains.includes(r.chain)} onChange={e=>change({...settings,keepResidues:e.target.checked?[...settings.keepResidues,r.id]:settings.keepResidues.filter(id=>id!==r.id)})}/>
        <button className="quiet residue-link" onClick={()=>viewer?.focusResidue(r)}>{r.name} <span>{r.id}</span></button><small>{r.supported?'rigid':'unsupported'}</small>
      </div>)}</div>
      <p className="descriptor-note">Unchecked residues are excluded from docking. Retained waters and ions stay rigid; generic scoring does not resolve metal coordination or water displacement. Cofactors without supported parameters remain excluded.</p>
    </section>
    <details className="panel-section workbench-controls"><summary>Protonation templates · {Object.keys(settings.templates).length} overrides</summary><p className="descriptor-note">Explicit residue states, not a pH prediction. Auto uses Meeko template matching. HID/HIE protonate histidine δ/ε; HIP protonates both. ASH/GLH are neutral acids; LYN is neutral lysine.</p>
      {editable.map(r=><label className="prep-row" key={r.id}><button className="quiet residue-link" onClick={()=>viewer?.focusResidue(r)}>{r.name} {r.id}</button><select aria-label={`Protonation ${r.name} ${r.id}`} disabled={busy} value={settings.templates[r.id]??''} onChange={e=>{const next={...settings.templates};if(e.target.value)next[r.id]=e.target.value;else delete next[r.id];change({...settings,templates:next});}}><option value="">Auto{report?.assignments[r.id]?` · ${report.assignments[r.id]}`:''}</option>{templates[r.name].map(t=><option key={t}>{t}</option>)}</select></label>)}
    </details>
    <p className="panel-section descriptor-note">Missing heavy atoms that prevent template matching stop preparation. Missing sequence segments are not rebuilt. These settings are applied to the next docking run.</p>
  </>;
}
