import { useEffect, useState } from "react";
import { Crosshair, Eye, LoaderCircle } from "lucide-react";
import type { MolstarController } from "./molstar/MolstarController";
import type { Contact, PickedAtom } from "./types";

export function ContactsPanel({ viewer, poseRevision }: { viewer: MolstarController | null; poseRevision: number }) {
  const ligands=viewer?.getLigands() ?? [];
  const [target,setTarget]=useState(ligands[0]?.id ?? "");
  const [contacts,setContacts]=useState<Contact[]>([]);
  const [filter,setFilter]=useState("All");
  const [selected,setSelected]=useState("");
  const [visible,setVisible]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [clip,setClip]=useState(0);
  const [picks,setPicks]=useState<PickedAtom[]>([]);
  const [measure,setMeasure]=useState(false);
  useEffect(()=>viewer?.onAtomPick(atom=>setPicks(previous=>measure?[...previous.slice(-2),atom]:[atom])),[viewer,measure]);
  useEffect(()=>{setPicks([]);},[poseRevision]);
  const distance=(a:PickedAtom,b:PickedAtom)=>Math.hypot(...a.position.map((v,i)=>v-b.position[i]));
  const angle=picks.length===3 ? Math.acos(Math.max(-1,Math.min(1,
    picks[0].position.reduce((sum,v,i)=>sum+(v-picks[1].position[i])*(picks[2].position[i]-picks[1].position[i]),0)/(distance(picks[0],picks[1])*distance(picks[2],picks[1])))))*180/Math.PI : null;

  useEffect(()=>{
    let canceled=false;
    setBusy(true); setContacts([]); setError("");
    void viewer?.inspectContacts(target).then(rows=>{if(!canceled)setContacts(rows);})
      .catch(e=>{if(!canceled)setError(String(e));}).finally(()=>{if(!canceled)setBusy(false);});
    return ()=>{canceled=true;};
  },[viewer,target,poseRevision]);
  const shown=contacts.filter(c=>filter==='All'||c.kind===filter);
  useEffect(()=>{
    void viewer?.showContacts(visible ? contacts.filter(c=>filter==='All'||c.kind===filter) : [], selected).catch(e=>setError(String(e)));
  },[viewer,contacts,filter,visible,selected]);
  useEffect(()=>()=>{void viewer?.showContacts([]);viewer?.setClipping(0);viewer?.hoverResidue();},[viewer]);
  return <>
    <section className="panel-section workbench-controls">
      <div className="section-label"><span>INTERACTION INSPECTOR</span><Crosshair size={13}/></div>
      <label>Ligand<select value={target} onChange={e=>{setTarget(e.target.value);setFilter('All');setSelected('');}}>
        <option value="" disabled>Select a ligand</option>
        {poseRevision>0&&<option value="docked">Docked pose · prepared receptor</option>}
        {ligands.map(l=><option key={l.id} value={l.id}>{l.name} · {l.id}</option>)}
      </select></label>
      <div className="workbench-toolbar"><label className="docking-visibility"><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)}/><Eye size={12}/> Contact lines</label><span>{contacts.length} contacts</span></div>
      <label className="clip-control">Section depth <input aria-label="Section depth" type="range" min="0" max="95" value={clip} onChange={e=>{const v=Number(e.target.value);setClip(v);viewer?.setClipping(v);}}/><button className="quiet" onClick={()=>{setClip(0);viewer?.setClipping(0);}}>Reset</button></label>
      <p className="descriptor-note">Select a contact to focus its atoms. Original ligands use the input structure; docked poses use their prepared receptor.</p>
    </section>
    <details className="panel-section atom-inspector" open>
      <summary>Atom inspection & measurements</summary>
      <label className="docking-visibility"><input type="checkbox" checked={measure} onChange={e=>{setMeasure(e.target.checked);setPicks([]);}}/> Measure picked atoms</label>
      <p className="descriptor-note">{measure?'Pick two atoms for a distance, three for an angle.':'Click an atom in the molecular view to inspect it.'}</p>
      {picks.map((atom,i)=><div className="atom-pick" key={i}><strong>{i+1}. {atom.label}</strong><span>{atom.element} · formal charge {atom.charge} · occupancy {atom.occupancy.toFixed(2)}</span><small>{atom.position.map(v=>v.toFixed(2)).join(', ')} Å</small></div>)}
      {picks.length>=2&&<div className="measurement-result">1–2 <strong>{distance(picks[0],picks[1]).toFixed(2)} Å</strong>{picks.length===3&&<> · 2–3 <strong>{distance(picks[1],picks[2]).toFixed(2)} Å</strong></>}</div>}
      {angle!=null&&Number.isFinite(angle)&&<div className="measurement-result">Angle 1–2–3 <strong>{angle.toFixed(1)}°</strong></div>}
      {!!picks.length&&<button className="quiet" onClick={()=>setPicks([])}>Clear picks</button>}
    </details>
    <section className="panel-section">
      <div className="contact-filters">
        {['All',...new Set(contacts.map(c=>c.kind))].map(kind=><button key={kind} aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{kind}<span>{kind==='All'?contacts.length:contacts.filter(c=>c.kind===kind).length}</span></button>)}
      </div>
      {busy&&<p className="section-description"><LoaderCircle size={12} className="spin"/> Analyzing geometry…</p>}
      {error&&<p role="alert" className="docking-error">{error}</p>}
      {!busy&&!error&&!shown.length&&<p className="section-description">{target?'No contacts match this selection.':'Select an input ligand or dock a molecule to inspect its contacts.'}</p>}
      {!!shown.length&&<details className="contact-map"><summary>Residue contact map</summary><svg viewBox="0 0 260 220" role="img" aria-label="Ligand to residue interaction map">
        {[...new Map(shown.map(c=>[`${c.residue.chain}:${c.residue.seq}${c.residue.insertionCode}`,c])).values()].slice(0,12).map((c,i,rows)=>{
          const a=i/rows.length*Math.PI*2-Math.PI/2,x=130+Math.cos(a)*94,y=110+Math.sin(a)*86;
          return <g key={c.id} role="button" tabIndex={0} aria-label={`Focus ${c.residue.name} ${c.residue.chain}:${c.residue.seq}`} onClick={()=>{setSelected(c.id);viewer?.focusContact(c);}} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(c.id);viewer?.focusContact(c);}}}>
            <line x1="130" y1="110" x2={x} y2={y}/><rect x={x-28} y={y-13} width="56" height="26" rx="3"/><text x={x} y={y-1}>{c.residue.name}</text><text x={x} y={y+9}>{c.residue.chain}:{c.residue.seq}</text>
          </g>;
        })}<rect className="map-ligand" x="102" y="96" width="56" height="28" rx="4"/><text x="130" y="113">Ligand</text>
      </svg><p className="descriptor-note">Up to 12 contacted residues. Select a node to focus the first matching contact; all contacts remain in the table.</p></details>}
      <div className="contact-list">{shown.map(c=><button key={c.id} aria-pressed={selected===c.id} onMouseEnter={()=>viewer?.hoverResidue(c.residue)} onMouseLeave={()=>viewer?.hoverResidue()} onClick={()=>{setSelected(c.id);viewer?.focusContact(c);}}>
        <span className={c.kind==='Steric overlap'?'contact-kind clash':'contact-kind'}>{c.kind}</span>
        <strong>{c.residue.name} {c.residue.chain}:{c.residue.seq}{c.residue.insertionCode}</strong><b>{c.distance.toFixed(2)} Å</b>
        <small>{c.ligandAtom} ↔ {c.receptorAtom}{c.overlap!=null?` · overlap ${c.overlap.toFixed(2)} Å`:''}</small>
      </button>)}</div>
    </section>
    <details className="panel-section docking-method"><summary>Contact criteria</summary><p>Mol* chemical typing and geometry: donor/acceptor angles for hydrogen bonds; hydrophobic contacts within 4 Å; ionic contacts within 5 Å. Ring-contact distances refer to feature centers.</p><p>Steric overlaps exceed the summed heavy-atom van der Waals radii by 0.6 Å. Metals are excluded from this overlap screen. These geometric candidates are not bond energies; protonation and unresolved atoms affect assignments.</p></details>
  </>;
}
