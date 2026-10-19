import { useEffect, useRef, useState } from 'react';
import { Atom, ArrowUpRight, FolderOpen, Search, ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useWorkspace } from './workspace';
import { useStudio } from './store';
import * as Dialog from '@radix-ui/react-dialog';
import reference from '../demo/lipid-reference/studio.json';
import { WorkflowControls } from './WorkflowControls';
import { MolstarController } from './molstar/MolstarController';
import type { LoadedProject } from './types';

function HomeStructure() {
  const host=useRef<HTMLDivElement>(null),theme=useStudio(s=>s.theme);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    let canceled=false,finished=false;
    const controller=new MolstarController(),mount=document.createElement('div');
    mount.className='molstar-instance';host.current!.appendChild(mount);
    void (async()=>{
      try {
        const [project,structure]=await Promise.all([import('../demo/lipid-reference/studio.json'),import('../demo/lipid-reference/structure.pdb?raw')]);
        if(canceled)return;
        await controller.init(mount,theme);
        if(canceled)return;
        await controller.load({project:project.default as unknown as LoadedProject['project'],structureData:structure.default,warnings:[]},"home");
        if(canceled)return;
        await controller.synchronize(undefined,{cartoon:true,surface:false,geometry:false,allPockets:false,residues:false,ligands:false});
      } catch {if(!canceled)setFailed(true);}
      finally {finished=true;if(canceled)controller.dispose();}
    })();
    return ()=>{canceled=true;mount.remove();if(finished)controller.dispose();};
  },[theme]);
  return <figure className='home-molecule'><div ref={host} className='home-molecule-canvas' aria-label='Apo BstB, PDB 7T1M, MSE to MET prepared copy. Drag to rotate.' />{failed&&<div className='home-molecule-fallback'><Atom size={100} strokeWidth={.5}/></div>}<figcaption><span className='home-specimen-kicker'>DASSAMA LAB · REFERENCE</span><strong>BstB</strong><span className='home-specimen-name'>Bacterial sterol-<br/>binding protein</span><span className='home-specimen-meta'>7T1M · Apo · 1.60 Å</span><small>MSE → MET prepared copy</small><small>Zhai et al. · eLife 2024</small><small className='home-protein-legend'><span><i className='sheet'/> β sheet</span><span><i className='helix'/> α helix</span><span><i className='loop'/> Loop</span></small><small>{failed?'Reference structure':'Drag to rotate'}</small></figcaption></figure>;
}

export function Home({busy,onOpen,onFolder,onReference,onError}:{busy:boolean;onOpen:()=>void;onFolder:()=>void;onReference:()=>void;onError:(s:string)=>void}) {
  const w=useWorkspace(),[query,setQuery]=useState(''),[page,setPage]=useState(0);
  const documents=Object.entries(w.documents).reverse();
  const runs=documents.flatMap(([,d])=>d.runs);
  const entries=[...(!w.documents[reference.id]?[{id:reference.id,project:reference,doc:null}]:[]),...documents.map(([id,doc])=>({id,project:doc.loaded.project,doc}))];
  const filtered=entries.filter(({project:p})=>`${p.name} ${p.structure.id}`.toLowerCase().includes(query.toLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/2)),currentPage=Math.min(page,pages-1);
  function resume(id:string){
    const d=w.documents[id],run=d.runs.find(r=>r.id===d.selectedRun);
    useStudio.getState().select(run?.pocket.id??null);
    useStudio.getState().setTab(run?'docking':'overview');
    useWorkspace.setState({activeId:id});
  }
  return <div className="studio-home">
    <section className="home-hero">
      <div className="home-hero-copy"><div className="home-identity"><span className="lab-wordmark home-lab-wordmark">Dassama Lab</span><div className="home-kicker">SLiPP Studio · Lipid–protein workbench</div></div>
        <h1>Explore lipid<br/><span>binding.</span></h1>
        <p className="home-lead">From protein structure to binding pocket.<br/>A workbench for lipid–protein interactions.</p>
        <div className="home-open-actions"><button className="primary" disabled={busy} onClick={onOpen}>Open a protein <ArrowRight size={16}/></button><button className="home-folder" disabled={busy} onClick={onFolder}><FolderOpen size={15}/> Open folder</button></div>
        <div className="home-file-note">PDB / mmCIF <span>·</span> No bound ligand required</div>
        <Dialog.Root><Dialog.Trigger className="home-retrieve">Retrieve by PDB ID / import workspace <ArrowUpRight size={12}/></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="screen-overlay"/><Dialog.Content className="home-import-dialog"><div className="screen-dialog-heading"><Dialog.Title>Import a structure or workspace</Dialog.Title><Dialog.Close aria-label="Close import"><X size={17}/></Dialog.Close></div><Dialog.Description>Retrieve protein coordinates from the PDB, or restore an exported workspace.</Dialog.Description><WorkflowControls home onError={onError}/></Dialog.Content></Dialog.Portal></Dialog.Root>
      </div>
      <HomeStructure/>
    </section>
    <section className="home-analyses" aria-labelledby="home-analyses-title">
      <div className="home-panel-heading"><h2 id="home-analyses-title">Saved analyses <span>{documents.length}</span></h2><div className="home-library-actions"><label className="home-search"><Search size={13}/><input aria-label="Filter saved analyses" placeholder="Filter name or PDB ID" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></label><div className="home-pages"><button aria-label="Previous analyses" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><ChevronLeft size={15}/></button><span>{currentPage+1} / {pages}</span><button aria-label="Next analyses" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}><ChevronRight size={15}/></button></div></div></div>
      <div className="home-analysis-list">{filtered.slice(currentPage*2,currentPage*2+2).map(({id,project:p,doc:d})=>{
        const complete=d?.runs.filter(r=>r.status==='complete').length??0,pending=d?.runs.filter(r=>['queued','running','paused'].includes(r.status)).length??0;
        return <button className="home-analysis-row" key={id} disabled={busy} onClick={()=>d?resume(id):onReference()} aria-label={d?`Resume ${p.name}, ${p.pockets.length} pockets, ${complete} completed runs`:'Explore BstB reference analysis'}><span className="home-structure-icon"><Atom size={25} strokeWidth={1.2}/></span><span className="home-analysis-name"><strong>{p.name}</strong><small>{p.structure.id} · {p.pockets.length} pockets · {d?`${complete} dockings`:'Reference · fpocket + SLiPP'}{pending>0?` · ${pending} pending / paused`:''}</small></span><ArrowUpRight size={15}/></button>;
      })}{!filtered.length&&<p className="home-empty">No analyses match “{query}”.</p>}</div>
      <div className="home-analysis-footer"><span>{w.operation||`${runs.filter(r=>r.status==='complete').length} completed dockings · ${w.lipids.length} lipids in tray`}</span><span>{w.saveError?'Autosave needs attention':w.hydrated?'Saved on this device':'Opening workspace…'}</span></div>
    </section>
  </div>;
}
