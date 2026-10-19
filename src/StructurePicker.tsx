import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useWorkspace } from './workspace';
import { useStudio } from './store';

export function StructurePicker() {
  const w=useWorkspace(),[open,setOpen]=useState(false),[query,setQuery]=useState('');
  const search=useRef<HTMLInputElement>(null);
  const current=w.activeId?w.documents[w.activeId]?.loaded.project:null;
  const documents=Object.entries(w.documents).reverse();
  const matches=documents.filter(([,d])=>`${d.loaded.project.name} ${d.loaded.project.structure.id}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog.Root open={open} onOpenChange={value=>{setOpen(value);if(value)setQuery('');}}>
    <Dialog.Trigger asChild><button className="structure-switcher" disabled={!w.hydrated||!documents.length} aria-label="Switch structure"><span className="structure-switcher-label">ACTIVE STRUCTURE <span>{documents.length} saved</span></span><span className="structure-switcher-id">{current?.structure.id??'Choose structure'}<ChevronDown size={15}/></span><span className="structure-switcher-name">{current?.name??'Open a saved analysis'}</span></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="structure-picker-overlay"/><Dialog.Content className="structure-picker" onOpenAutoFocus={e=>{e.preventDefault();search.current?.focus();}}>
      <div className="structure-picker-heading"><div><Dialog.Title>Switch structure</Dialog.Title><Dialog.Description>{documents.length} saved analyses · coordinates and results</Dialog.Description></div><Dialog.Close aria-label="Close structure picker"><X size={16}/></Dialog.Close></div>
      <label className="structure-picker-search"><Search size={15}/><input ref={search} aria-label="Search saved structures" placeholder="Search protein name or PDB ID" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <div className="structure-picker-results">{matches.map(([id,d])=>{const p=d.loaded.project;return <button key={id} aria-current={id===w.activeId?'true':undefined} onClick={()=>{useWorkspace.setState({activeId:id});useStudio.getState().select(null);setOpen(false);}}><span className="structure-picker-code">{p.structure.id}</span><span className="structure-picker-info"><strong>{p.name}</strong><small>{p.pockets.length} pockets · {d.runs.filter(r=>r.status==='complete').length} completed dockings · {p.structure.format.toUpperCase()}</small></span>{id===w.activeId&&<Check size={15}/>}</button>;})}{!matches.length&&<p className="structure-picker-empty">No structures match “{query}”.</p>}</div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
