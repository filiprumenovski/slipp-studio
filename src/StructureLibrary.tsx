import { useEffect, useMemo, useRef, useState, useImperativeHandle } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Atom, FolderOpen, LoaderCircle, Search, X } from "lucide-react";
import type { LoadedProject } from "./types";
import type { MolstarController } from "./molstar/MolstarController";

import { useWorkspace, type LibraryEntry as Entry } from "./workspace";
const id = (entry: Entry) => `structure:${entry.path}`;
const formatOf = (name: string): Entry['format'] | null => /\.(pdb|ent)$/i.test(name) ? 'pdb' : /\.(cif|mmcif)$/i.test(name) ? 'mmcif' : null;

export interface StructureLibraryHandle {openFolder:()=>void;openFiles:()=>void}
export function StructureLibrary({ref,loaded,viewer,ready,busy,onBusy,onLoad,onError,onReset}: {
  ref?:React.Ref<StructureLibraryHandle>;
  loaded: LoadedProject|null; viewer: MolstarController|null; ready: boolean; busy: boolean;
  onBusy: (value:boolean)=>void; onLoad:(value:LoadedProject)=>void; onError:(message:string)=>void; onReset:()=>void;
}) {
  const entries=useWorkspace(s=>s.library),folder=useWorkspace(s=>s.folder);
  const setLibrary=useWorkspace(s=>s.setLibrary);
  const [query,setQuery]=useState('');
  const [scroll,setScroll]=useState(0);
  const [height,setHeight]=useState(250);
  const [pending,setPending]=useState('');
  const [thumbnails,setThumbnails]=useState<Map<string,string>>(new Map());
  const chooser=useRef<HTMLInputElement>(null), list=useRef<HTMLDivElement>(null);
  const fileChooser=useRef<HTMLInputElement>(null);
  useImperativeHandle(ref,()=>({openFolder:()=>void chooseFolder(),openFiles:()=>fileChooser.current?.click()}));
  const active=loaded?.project.id;
  const rows=useMemo(()=>entries.filter(e=>e.name.toLowerCase().includes(query.toLowerCase())),[entries,query]);
  const rowHeight=64, start=Math.max(0,Math.floor(scroll/rowHeight)-3);
  const visible=rows.slice(start,start+Math.ceil(height/rowHeight)+6);
  useEffect(()=>{
    if(!list.current)return;
    const observer=new ResizeObserver(([e])=>setHeight(e.contentRect.height));
    observer.observe(list.current);return()=>observer.disconnect();
  },[entries.length]);
  useEffect(()=>{
    if(!ready||!viewer||!active||!entries.some(e=>id(e)===active))return;
    let canceled=false;
    const timer=setTimeout(()=>{
      void viewer.thumbnail().then(uri=>{
        if(canceled)return;
        setThumbnails(previous=>{const next=new Map(previous);next.delete(active);next.set(active,uri);if(next.size>100)next.delete(next.keys().next().value!);return next;});
      }).catch(()=>{});
    },700);
    return()=>{canceled=true;clearTimeout(timer);};
  },[ready,viewer,active,entries]);
  async function select(entry:Entry) {
    if(busy)return;
    if(id(entry)===active){onReset();return;}
    onBusy(true);setPending(entry.path);
    try {
      let next:LoadedProject;
      const cached=useWorkspace.getState().documents[id(entry)];
      if(cached)next=cached.loaded;
      else if(entry.file instanceof File) {
        if(entry.size>20_000_000)throw new Error('Choose a structure file no larger than 20 MB.');
        const structureData=await entry.file.text();
        if(entry.format==='pdb'?!/^(ATOM  |HETATM)/m.test(structureData):!/_atom_site\./.test(structureData))throw new Error('No atomic coordinate records found in this file.');
        const name=entry.name.split('/').at(-1)!.replace(/\.[^.]+$/,'');
        next={structureData,warnings:[],project:{schemaVersion:1,id:id(entry),name,description:'Local coordinates · first model',
          structure:{id:name,path:entry.name,format:entry.format,source:'Local structure file'},
          model:{name:'SLiPP++',version:null,classes:[],calibration:'Not available'},
          provenance:'Imported coordinates. Pocket detection and model inference have not been run.',pockets:[]}};
      } else {if(!isTauri())throw Error('Reopen the original folder to load unvisited structures in the browser.');next=await invoke<LoadedProject>('open_structure',{path:entry.path});}
      onLoad(next);
    } catch(e){onError(`${entry.name}: ${String(e)}`);}finally{onBusy(false);setPending('');}
  }
  async function importEntries(files:Entry[],name:string) {
    if(!files.length){onError('No PDB, ENT, CIF or mmCIF files found in this folder.');return;}
    if(files.length>10_000){onError('Choose a folder with at most 10,000 structures.');return;}
    files.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
    setLibrary(files,name);setQuery('');setScroll(0);setThumbnails(new Map());
    if(list.current)list.current.scrollTop=0;
    await select(files[0]);
  }
  async function chooseFolder() {
    if(!isTauri()){chooser.current?.click();return;}
    try {
      const path=await open({directory:true,multiple:false,title:'Open structure folder'});
      if(!path)return;
      onBusy(true);
      let files:Entry[];
      try {files=await invoke<Entry[]>('list_structures',{path});}finally{onBusy(false);}
      await importEntries(files,path.split(/[\\/]/).at(-1)||path);
    } catch(e){onError(String(e));}
  }
  function importFiles(files:File[]){
    if(!files.length)return;
    const entries=files.flatMap(file=>{const format=formatOf(file.name);return format?[{path:file.webkitRelativePath||file.name,name:(file.webkitRelativePath||file.name).split('/').slice(1).join('/')||file.name,format,size:file.size,file}]:[];});
    void importEntries(entries,files[0]?.webkitRelativePath.split('/')[0]||'Local structures');
  }
  function keyboard(event:React.KeyboardEvent) {
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!rows.length)return;
    event.preventDefault();event.stopPropagation();
    if(busy)return;
    const current=rows.findIndex(e=>id(e)===active);
    const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,current+(event.key==='ArrowDown'?1:-1)));
    const top=next*rowHeight;
    if(list.current){if(top<list.current.scrollTop)list.current.scrollTop=top;else if(top+rowHeight>list.current.scrollTop+height)list.current.scrollTop=top+rowHeight-height;}
    void select(rows[next]);
  }
  return <>
    <div className="nav-heading"><div className="eyebrow">STRUCTURES {entries.length>0&&<span className="count">{entries.length}</span>}</div>
      <button className="icon-button" disabled={busy} onClick={()=>void chooseFolder()} aria-label="Open structure folder" title="Open folder · PDB / mmCIF"><FolderOpen size={14}/></button>
    </div>
    <input ref={chooser} type="file" hidden multiple {...{webkitdirectory:''}} onChange={e=>{importFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
    <input ref={fileChooser} type="file" hidden multiple accept=".pdb,.ent,.cif,.mmcif" onChange={e=>{importFiles(Array.from(e.target.files??[]));e.target.value='';}}/>
    {!!entries.length&&<>
      <div className="library-folder" title={folder}><FolderOpen size={11}/><span>{folder}</span><span>{rows.length}/{entries.length}</span></div>
      <label className="library-search"><Search size={12}/><input aria-label="Filter structures" placeholder="Filter structures…" value={query} onChange={e=>{setQuery(e.target.value);setScroll(0);if(list.current)list.current.scrollTop=0;}}/>{query&&<button aria-label="Clear structure filter" onClick={()=>setQuery('')}><X size={11}/></button>}</label>
      <div className={`structure-library ${loaded?.project.pockets.length?'':'expanded'}`} ref={list} role="listbox" tabIndex={0} aria-label="Structure library" aria-busy={busy} aria-activedescendant={visible.some(e=>id(e)===active)?`structure-entry-${entries.findIndex(e=>id(e)===active)}`:undefined} onKeyDown={keyboard} onScroll={e=>setScroll(e.currentTarget.scrollTop)}>
        <div style={{height:rows.length*rowHeight,position:'relative'}}>
          {visible.map((entry,i)=><button key={entry.path} id={`structure-entry-${entries.indexOf(entry)}`} role="option" aria-selected={id(entry)===active} tabIndex={-1} disabled={busy} className="library-entry" style={{top:(start+i)*rowHeight,height:rowHeight}} title={entry.name} onClick={()=>{list.current?.focus();void select(entry);}}>
            <span className="structure-thumbnail">{pending===entry.path?<LoaderCircle size={17} className="spin"/>:thumbnails.has(id(entry))?<img src={thumbnails.get(id(entry))} alt=""/>:<Atom size={21} strokeWidth={1}/>}</span>
            <span className="library-entry-text"><strong>{entry.name.split('/').at(-1)}</strong><small>{entry.name.includes('/')?entry.name.slice(0,entry.name.lastIndexOf('/')):entry.format.toUpperCase()} · {Math.max(1,Math.round(entry.size/1024)).toLocaleString()} KB</small></span>
          </button>)}
        </div>
        {!rows.length&&<p className="library-empty">No matching structures.</p>}
      </div>
      <div className="library-hint">↑ ↓ Browse · coordinates load on selection</div>
    </>}
    {(!entries.length||!entries.some(e=>id(e)===active))&&<button className="structure-item" disabled={!loaded} onClick={onReset}><span className="structure-icon"><Atom size={19}/></span><span><strong>{loaded?.project.structure.id??'No structure'}</strong><small>{loaded?'Current project':'Open a folder or project'}</small></span></button>}
  </>;
}
