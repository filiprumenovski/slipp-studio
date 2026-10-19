import { useEffect, useState } from 'react';
import { Box, Droplets, ScanLine, Layers3, Waypoints, LoaderCircle, Crosshair } from 'lucide-react';
import type { MolstarController } from './molstar/MolstarController';
import type { AnatomyLayer, PocketAnatomy } from './molstar/anatomy';
import { residueKey } from './molstar/contacts';
import type { Pocket, Residue } from './types';
import { useStudio } from './store';

const layers:{id:AnatomyLayer;label:string;description:string;icon:typeof Box}[]=[
  {id:'shape',label:'Pocket shape',description:'Alpha-sphere cavity envelope',icon:Box},
  {id:'hydrophobic',label:'Hydrophobic lining',description:'Nonpolar atom highlights',icon:Droplets},
  {id:'polar',label:'Potential polar anchors',description:'Donors and acceptors',icon:Waypoints},
  {id:'openings',label:'Candidate openings',description:'Sampled solvent-access paths',icon:ScanLine},
  {id:'chains',label:'Neighboring chains',description:'Polymer atoms near the cavity',icon:Layers3},
];
export function AnatomyPanel({viewer,pocket}:{viewer:MolstarController|null;pocket?:Pocket}) {
  const [data,setData]=useState<PocketAnatomy|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [chain,setChain]=useState<string|undefined>(),[selected,setSelected]=useState<Residue|undefined>();
  const layer=useStudio(s=>s.anatomyLayer),setLayer=useStudio(s=>s.setAnatomyLayer);
  useEffect(()=>{
    let canceled=false;setData(null);setError('');
    if(viewer&&pocket){setBusy(true);void viewer.inspectAnatomy(pocket).then(result=>{if(!canceled)setData(result);}).catch(e=>{if(!canceled)setError(String(e));}).finally(()=>{if(!canceled)setBusy(false);});}
    return()=>{canceled=true;};
  },[viewer,pocket]);
  useEffect(()=>{void viewer?.showAnatomy(data,layer,chain,selected).catch(e=>setError(String(e)));},[viewer,data,layer,chain,selected]);
  useEffect(()=>()=>{void viewer?.showAnatomy(null,'shape');viewer?.hoverResidue();},[viewer]);
  const atoms=(layer==='chains'?data?.neighbors:data?.atoms)?.filter(a=>layer==='hydrophobic'?a.roles.includes('Hydrophobic'):layer==='polar'?a.roles.some(r=>r==='Donor'||r==='Acceptor'):layer==='chains'?chain===undefined||a.residue.chain===chain:true)??[];
  const residues=[...new Map(atoms.map(a=>[residueKey(a.residue),a.residue])).values()];
  const counts:Record<AnatomyLayer,string>={shape:pocket?`${pocket.geometry.alphaSpheres.length}`:'—',hydrophobic:data?`${data.atoms.filter(a=>a.roles.includes('Hydrophobic')).length}`:'—',polar:data?`${data.atoms.filter(a=>a.roles.some(r=>r==='Donor'||r==='Acceptor')).length}`:'—',openings:data?`${data.openings.length}`:'—',chains:data?`${data.chains.length}`:'—'};
  return <>
    <section className="panel-section">
      <div className="section-label"><span>POCKET ANATOMY</span><button className="icon-button" title="Focus pocket" aria-label="Focus pocket anatomy" disabled={!pocket||!viewer} onClick={()=>viewer?.focusPocket(pocket!,true)}><Crosshair size={13}/></button></div>
      {!pocket?<p className="section-description">Select a detected pocket to inspect its lining and geometry. This analysis does not require a bound ligand.</p>:<>
        <div className="anatomy-layers">{layers.map(item=><button key={item.id} disabled={!viewer} aria-pressed={layer===item.id} onClick={()=>{setLayer(item.id);setChain(undefined);setSelected(undefined);}}><item.icon size={15}/><span><strong>{item.label}</strong><small>{item.description}</small></span><b>{counts[item.id]}</b></button>)}</div>
        {busy&&<p className="section-description"><LoaderCircle size={12} className="spin"/> Analyzing pocket chemistry and access…</p>}
        {error&&<p className="docking-error" role="alert">{error}</p>}
      </>}
    </section>
    {pocket&&data&&<section className="panel-section">
      <div className="section-label"><span>{layers.find(l=>l.id===layer)!.label.toUpperCase()}</span></div>
      {layer==='shape'&&<>
        <div className="context-row"><span>fpocket volume</span><strong>{pocket.fpocket.Volume?.toFixed(1)??'—'} Å³</strong></div>
        <div className="context-row"><span>Envelope X / Y / Z</span><strong>{data.dimensions.map(v=>v.toFixed(1)).join(' / ')} Å</strong></div>
        <div className="context-row"><span>Lining residues</span><strong>{pocket.residues.length}</strong></div>
        <p className="descriptor-note">Envelope dimensions follow the coordinate axes. The alpha-sphere envelope represents the detected cavity.</p>
      </>}
      {layer==='polar'&&<div className="anatomy-legend"><span><i style={{background:'#518fb5'}}/>Donor</span><span><i style={{background:'#c16d7e'}}/>Acceptor</span><span><i style={{background:'#9a77b9'}}/>Both</span></div>}
      {layer==='hydrophobic'&&<p className="descriptor-note">Copper highlights mark chemically typed hydrophobic atoms within pocket-lining residues.</p>}
      {layer==='polar'&&<p className="descriptor-note">Potential headgroup anchors. These are donor/acceptor sites, not demonstrated bonds to a lipid.</p>}
      {layer==='chains'&&<p className="descriptor-note">Polymer atoms within 5 Å of the alpha-sphere envelope, colored by chain. Counts show nearby residues.</p>}
      {layer==='chains'&&<div className="contact-filters"><button aria-pressed={chain===undefined} onClick={()=>{setChain(undefined);setSelected(undefined);}}>All chains</button>{data.chains.map(c=><button key={c.id} aria-pressed={chain===c.id} onClick={()=>{setChain(c.id);setSelected(undefined);}}>Chain {c.id||'∅'} · {c.residues.length}</button>)}</div>}
      {layer==='openings'?<>
        <p className="section-description">{data.openings.length?`${data.openings.length} access markers on the cavity envelope. Select this layer to see solvent-facing exit regions.`:'No clear straight probe paths were found in this sample. Curved passages may still exist.'}</p>
        <div className="context-row"><span>Clear / tested rays</span><strong>{data.escapeRays.toLocaleString()} / {data.testedRays.toLocaleString()}</strong></div>
        <div className="context-row"><span>Probe radius</span><strong>1.4 Å</strong></div>
        <p className="descriptor-note">Markers are samples, not a count of distinct entrances. A water-sized probe path does not establish lipid accessibility.</p>
      </>:layer!=='shape'&&<>
        <div className="workbench-toolbar"><span>{atoms.length} atoms · {residues.length} residues</span>{selected&&<button className="quiet" onClick={()=>setSelected(undefined)}>Show all</button>}</div>
        <div className="anatomy-residues">{residues.map(r=><button key={residueKey(r)} aria-pressed={!!selected&&residueKey(selected)===residueKey(r)} onMouseEnter={()=>viewer?.hoverResidue(r)} onMouseLeave={()=>viewer?.hoverResidue()} onClick={()=>{setSelected(r);viewer?.focusResidue(r);}}><strong>{r.name}</strong><span>{r.chain}:{r.seq}{r.insertionCode}</span><small>{atoms.filter(a=>residueKey(a.residue)===residueKey(r)).map(a=>a.name).join(', ')}</small></button>)}</div>
      </>}
    </section>}
    {pocket&&<details className="panel-section docking-method"><summary>Geometry and chemical typing</summary><p>Mol* infers donor, acceptor and hydrophobic atom features from bonding and valence. Input protonation, missing atoms and alternate conformations can affect assignments.</p><p>Access is sampled in 96 directions from up to 128 alpha-sphere centers. Clear rays must avoid polymer van der Waals spheres expanded by a 1.4 Å probe. Exit points on the connected alpha-sphere envelope are grouped into 2 Å cells. Curved access routes are not evaluated.</p><p>Waters, ions and nonpolymer ligands are omitted from this ligand-free pocket inspection. Chain highlights show nearby atoms in the loaded coordinate model; biological assemblies are not inferred.</p></details>}
  </>;
}
