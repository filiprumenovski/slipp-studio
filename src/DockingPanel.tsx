import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { Play, Square, FileDown, LoaderCircle } from "lucide-react";
import { useStudio } from "./store";
import { relativePocketScores } from "./pocketScores";
import * as Dialog from "@radix-ui/react-dialog";
import { useWorkspace, runQueue, stopQueue, type ScreeningRun, type Lipid } from "./workspace";
import type { DockingResult, LoadedProject, Pocket } from "./types";

export function DockingPanel({
  loaded,
  pocket,
  ready,
  showPose,
}: {
  loaded: LoadedProject;
  pocket?: Pocket;
  ready: boolean;
  showPose: (sdf: string | null, receptor?: string) => Promise<void>;
}) {
  const w=useWorkspace(),doc=w.documents[loaded.project.id];
  const preparation=doc.preparation;
  const scoring=useStudio(s=>s.dockingScoring),setScoring=useStudio(s=>s.setDockingScoring);
  const [available,setAvailable]=useState(false),[smiles,setSmiles]=useState(''),[name,setName]=useState('');
  const [effort,setEffort]=useState(8),[seed,setSeed]=useState(2026),[error,setError]=useState('');
  const [lipidIds,setLipidIds]=useState<string[]>(['pubchem-985']),[targetIds,setTargetIds]=useState<string[]|null>(null);
  const [expanded,setExpanded]=useState(false),[visible,setVisible]=useState(true);
  const busy=!!w.operation;
  const selectedRun=doc.runs.find(r=>r.id===doc.selectedRun);
  const result=selectedRun?.result??null,pose=doc.pose;
  const setPose=(pose:number)=>w.updateDocument(loaded.project.id,{pose});
  const current=result?.pocketId===pocket?.id?result:null;
  useEffect(()=>{if(isTauri())void invoke<boolean>('docking_status').then(setAvailable).catch(e=>setError(String(e)));},[]);
  useEffect(()=>{setTargetIds(null);setError('');},[loaded.project.id]);
  useEffect(()=>{
    if(ready)void showPose(visible&&current?(current.poses[pose]?.sdf??null):null,current?.preparation.structureData).catch(e=>setError(String(e)));
  },[current,pose,visible,ready,showPose]);
  const targets=loaded.project.pockets.filter(p=>targetIds!==null?targetIds.includes(p.id):p.id===pocket?.id);
  const selectedLipids=w.lipids.filter(l=>lipidIds.includes(l.id));
  function enqueue(lipids=selectedLipids) {
    if(busy||!available||!targets.length||!lipids.length)return;
    if(targets.length*lipids.length>100){setError('Queue up to 100 pocket–lipid pairs at a time.');return;}
    const runs:ScreeningRun[]=targets.flatMap(pocket=>lipids.map(lipid=>({id:crypto.randomUUID(),lipid,pocket,preparation,scoring,seed,effort,status:'queued',created:new Date().toISOString()})));
    w.updateDocument(loaded.project.id,{runs:[...doc.runs,...runs],selectedRun:runs[0].id,pose:0});setError('');setVisible(true);
    void runQueue().catch(e=>setError(String(e)));
  }
  function addCustom(){
    if(!name.trim()||!smiles.trim())return;
    const lipid:Lipid={id:crypto.randomUUID(),name:name.trim(),smiles:smiles.trim(),source:'User-supplied SMILES'};
    w.addLipid(lipid);setLipidIds(ids=>[...ids,lipid.id]);setName('');setSmiles('');
  }
  function selectRun(run:ScreeningRun){
    w.updateDocument(loaded.project.id,{selectedRun:run.id,pose:0});useStudio.getState().select(run.pocket.id);setVisible(true);setExpanded(false);
  }
  function resume(){
    w.updateDocument(loaded.project.id,{runs:doc.runs.map(r=>r.status==='paused'?{...r,status:'queued'}:r)});
    void runQueue().catch(e=>setError(String(e)));
  }
  const columns=w.lipids.filter(l=>lipidIds.includes(l.id)||doc.runs.some(r=>r.lipid.id===l.id&&r.scoring===scoring));
  const relativeScores=relativePocketScores(loaded.project.pockets);
  const ranked=[...loaded.project.pockets].sort((a,b)=>(b.prediction?.probability??-1)-(a.prediction?.probability??-1)||a.rank-b.rank);
  const mixedProtocols=new Set(doc.runs.filter(r=>r.scoring===scoring&&r.result).map(r=>JSON.stringify([r.preparation,r.seed,r.effort]))).size>1;
  function cell(pocketId:string,lipidId:string){return doc.runs.filter(r=>r.pocket.id===pocketId&&r.lipid.id===lipidId&&r.scoring===scoring).at(-1);}
  const matrix=<div className="screen-matrix-scroll"><table className="screen-matrix"><thead><tr><th>Pocket</th><th title="Raw model score divided by the highest raw score in this protein">Relative pocket score</th>{columns.map(l=><th key={l.id}>{l.name}</th>)}</tr></thead><tbody>{ranked.map(p=><tr key={p.id}><th><button onClick={()=>{useStudio.getState().select(p.id);setExpanded(false);}}>Pocket {p.rank}</button></th><td title={p.prediction?`Raw model score: ${p.prediction.probability.toFixed(3)}`:undefined}>{relativeScores.get(p.id)?.toFixed(3) ?? '—'}</td>{columns.map(l=>{const r=cell(p.id,l.id);return <td key={l.id}><button disabled={!r} className={r?.status==='complete'?'screen-score':''} aria-label={`Pocket ${p.rank}, ${l.name}: ${r?.result?r.result.poses[0].score+' kcal/mol':r?.status??'not run'}`} aria-pressed={r?.id===doc.selectedRun} title={r?.error??r?.status??'Not run'} onClick={()=>r&&selectRun(r)}>{r?.result?r.result.poses[0].score.toFixed(2):r?.status??'—'}</button></td>;})}</tr>)}</tbody></table></div>;
  async function exportPoses() {
    if (!result) return;
    try {
      const path = await save({
        defaultPath: `${loaded.project.structure.id}-${result.pocketId}-${result.scoring}.sdf`,
        filters: [{ name: "Docked poses", extensions: ["sdf"] }],
      });
      if (!path) return;
      const sdf = result.poses
        .map((p) =>
          p.sdf.replace(
            "$$$$",
            `> <VINA_SCORE_KCAL_MOL>\n${p.score}\n\n> <POSE_RANK>\n${p.rank}\n\n> <DELTA_SCORE_KCAL_MOL>\n${p.deltaScore}\n\n> <VINA_COMPONENTS>\n${JSON.stringify(p.components)}\n\n> <DOCKING_METADATA>\n${JSON.stringify({ ...result, poses: undefined })}\n\n$$$$`,
          ),
        )
        .join("\n");
      await invoke("save_export", {
        path,
        bytes: Array.from(new TextEncoder().encode(sdf)),
      });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <section className="panel-section docking-form">
        <div className="section-label"><span>LIPID SCREENING</span><span className="tiny-tag">LOCAL CPU</span></div>
        <label>Scoring function<select disabled={busy} value={scoring} onChange={e=>setScoring(e.target.value as "vina"|"vinardo")}><option value="vina">AutoDock Vina</option><option value="vinardo">Vinardo</option></select></label>
        <div className="lipid-tray">{w.lipids.map(l=><label key={l.id} title={l.smiles}><input type="checkbox" aria-label={l.name} checked={lipidIds.includes(l.id)} onChange={e=>setLipidIds(ids=>e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))}/><span>{l.name}</span><a href={l.source.startsWith('https://pubchem.ncbi.nlm.nih.gov/')?l.source:undefined} target="_blank" rel="noreferrer" title={l.source}>{l.source.startsWith('https://')?'↗':'custom'}</a></label>)}</div>
        <p className="descriptor-note">Starter fatty acids are neutral species. Supply charged or other protonation states explicitly; RDKit validates chemistry before each run.</p>
        <details><summary>Add a lipid · SMILES</summary><label>Name<input aria-label="Custom lipid name" value={name} maxLength={100} onChange={e=>setName(e.target.value)}/></label><label>Isomeric SMILES<textarea aria-label="Custom lipid SMILES" value={smiles} maxLength={2048} spellCheck={false} onChange={e=>setSmiles(e.target.value)}/></label><button className="quiet" disabled={!name.trim()||!smiles.trim()} onClick={addCustom}>Add to lipid tray</button></details>
        <details><summary>Target pockets · {targets.length}</summary><div className="workflow-actions"><button className="quiet" onClick={()=>setTargetIds(null)}>Selected pocket</button><button className="quiet" onClick={()=>setTargetIds(ranked.slice(0,5).map(p=>p.id))}>Top 5</button><button className="quiet" onClick={()=>setTargetIds(ranked.map(p=>p.id))}>All</button></div><div className="screen-pocket-list">{ranked.map(p=><label key={p.id}><input type="checkbox" checked={targets.some(t=>t.id===p.id)} onChange={e=>setTargetIds(e.target.checked?[...targets.map(p=>p.id),p.id]:targets.filter(t=>t.id!==p.id).map(t=>t.id))}/>Pocket {p.rank}<span title={p.prediction?`Relative pocket score · raw ${p.prediction.probability.toFixed(3)}`:undefined}>{relativeScores.get(p.id)?.toFixed(3) ?? 'Unranked'}</span></label>)}</div></details>
        <div className="docking-fields"><label>Search effort<select value={effort} onChange={e=>setEffort(Number(e.target.value))} disabled={busy}><option value={8}>Standard · 8</option><option value={32}>Thorough · 32</option><option value={96}>Extended · 96</option></select></label><label>Seed<input type="number" min={1} max={2147483647} value={seed} onChange={e=>setSeed(Number(e.target.value))} disabled={busy}/></label></div>
        <button className="quiet" onClick={()=>useStudio.getState().setTab('prepare')}>Receptor preparation · {preparation.excludedChains.length} chains excluded →</button>
        <div className="docking-actions"><button className="primary" disabled={!available||busy||!ready||!targets.length||!selectedLipids.length||!Number.isInteger(seed)||seed<1||seed>2147483647} onClick={()=>enqueue()}><Play size={12}/> Screen {targets.length*selectedLipids.length} pairs</button>{w.operation==='Docking screen'&&<button className="quiet" onClick={()=>void stopQueue().catch(e=>setError(String(e)))}><Square size={11}/> Stop queue</button>}</div>
        {doc.runs.some(r=>r.status==='paused')&&<button className="quiet" disabled={busy||!available} onClick={resume}>Resume interrupted / paused jobs</button>}
        {!available&&<p className="descriptor-note">{isTauri()?'Install scripts/setup-science.sh to enable computation.':'Docking runs in the native Studio application.'}</p>}
        {error&&<p className="docking-error" role="alert">{error}</p>}
      </section>
      <section className="panel-section docking-results"><div className="section-label"><span>POCKET × LIPID</span><button className="quiet" onClick={()=>setExpanded(true)}>Expand ↗</button></div><p className="descriptor-note">{scoring.toUpperCase()} · best sampled score, kcal/mol. Relative pocket score (0–1) ranks pockets within this protein; it is not a binding probability. Scores across different lipids can favor molecular size; they do not establish selectivity.</p>{mixedProtocols&&<p className="descriptor-note">This grid includes different receptor or search settings. Inspect each run’s parameters before comparing scores.</p>}{matrix}
        {doc.runs.length>0&&<><p className="section-description">{doc.runs.filter(r=>r.status==='complete').length} complete · {doc.runs.filter(r=>r.status==='queued'||r.status==='running').length} pending · {doc.runs.filter(r=>r.status==='failed').length} failed</p><label className="docking-history">Run history<select aria-label="Docking run history" value={doc.selectedRun??''} onChange={e=>{const r=doc.runs.find(r=>r.id===e.target.value);if(r)selectRun(r);}}><option value="">Select a run</option>{[...doc.runs].reverse().map(r=><option key={r.id} value={r.id}>Pocket {r.pocket.rank} · {r.lipid.name} · {r.scoring} · {r.status}</option>)}</select></label></>}
        {selectedRun?.status==='running'&&<p><LoaderCircle size={12} className="spin"/> Searching {selectedRun.lipid.name}…</p>}
        {selectedRun?.error&&<p className="docking-error" role="alert">{selectedRun.error}</p>}
        {selectedRun&&['failed','canceled'].includes(selectedRun.status)&&<button className="quiet" disabled={busy||!available} onClick={()=>{const retry={...selectedRun,id:crypto.randomUUID(),status:'queued' as const,result:undefined,error:undefined,created:new Date().toISOString()};w.updateDocument(loaded.project.id,{runs:[...doc.runs,retry],selectedRun:retry.id,pose:0});void runQueue().catch(e=>setError(String(e)));}}>Retry selected run</button>}
      </section>
      <Dialog.Root open={expanded} onOpenChange={setExpanded}><Dialog.Portal><Dialog.Overlay className="screen-overlay"/><Dialog.Content className="screen-dialog"><div className="screen-dialog-heading"><Dialog.Title>Pocket × lipid comparison</Dialog.Title><Dialog.Close aria-label="Close comparison">Close ×</Dialog.Close></div><Dialog.Description>{loaded.project.name} · {scoring.toUpperCase()} · kcal/mol. Select a result to inspect its poses and contacts. Relative pocket score (0–1) is normalized within this protein and shown separately.</Dialog.Description>{matrix}</Dialog.Content></Dialog.Portal></Dialog.Root>
      {result && (
        <section className="panel-section">
          <div className="section-label">
            <span>{result.poses.length} RANKED POSES</span>
            <button
              className="icon-button"
              aria-label="Export docked poses"
              title="Export poses and run metadata · SDF"
              onClick={() => void exportPoses()}
            >
              <FileDown size={13} />
            </button>
          </div>
          <p className="section-description">
            {result.scoring.toUpperCase()} · {result.pocketId} · {result.wallSeconds.toFixed(1)} s · {result.cpu}{" "}
            CPU threads
          </p>
          {current ? (
            <>
              <label className="docking-visibility">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(e) => setVisible(e.target.checked)}
                />{" "}
                Show selected pose
              </label>
              <div className="pose-table-head">
                <span>POSE</span>
                <span>kcal/mol</span>
                <span>Δ score</span>
                <span>RMSD Å*</span>
              </div>
              <div className="pose-table">
                {result.poses.map((p, i) => (
                  <button
                    key={p.rank}
                    onClick={() => {
                      setPose(i);
                      setVisible(true);
                    }}
                    aria-pressed={pose === i}
                    aria-label={`Pose ${p.rank}, score ${p.score} kcal per mol`}
                  >
                    <span>{String(p.rank).padStart(2, "0")}</span>
                    <strong>{p.score.toFixed(2)}</strong>
                    <span>{p.deltaScore.toFixed(2)}</span>
                    <span>
                      {p.rmsdLower.toFixed(1)}–{p.rmsdUpper.toFixed(1)}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="section-description">
              Select {result.pocketId} to view these poses in the structure.
            </p>
          )}
          <p className="descriptor-note">
            *Bounds relative to the best pose, not a reference crystal pose. Δ
            score is relative to the best pose, not statistical significance.
            More negative scores are more favorable within this run.
          </p>
          {current && (
            <details className="docking-method">
              <summary>Selected pose · score components</summary>
              <div className="context-row">
                <span>Intermolecular</span>
                <strong>
                  {current.poses[pose].components.inter.toFixed(3)}
                </strong>
              </div>
              <div className="context-row">
                <span>Intramolecular</span>
                <strong>
                  {current.poses[pose].components.intra.toFixed(3)}
                </strong>
              </div>
              <div className="context-row">
                <span>Unbound reference</span>
                <strong>
                  {current.poses[pose].components.unbound.toFixed(3)}
                </strong>
              </div>
              <p>
                Raw Vina terms in kcal/mol. The total score also includes a
                conformation correction. These are scoring terms, not separately
                measured energies.
              </p>
            </details>
          )}
          <details className="docking-method">
            <summary>Run parameters and assumptions</summary>
            <p>
              {result.engine} · {result.scoring} · seed {result.seed} · exhaustiveness{" "}
              {result.exhaustiveness}
            </p>
            <p>Receptor chains excluded: {result.preparation.settings.excludedChains.join(', ')||'none'}; retained hetero residues: {result.preparation.settings.keepResidues.join(', ')||'none'}; template overrides: {JSON.stringify(result.preparation.settings.templates)}.</p>
            <p>
              Box {result.size.map((v) => v.toFixed(1)).join(" × ")} Å; center{" "}
              {result.center.map((v) => v.toFixed(1)).join(", ")} Å.
            </p>
            <p>
              Preparation {result.preparationSeconds.toFixed(2)} s; search{" "}
              {result.searchSeconds.toFixed(2)} s. Receptor cache{" "}
              {result.receptorCacheHit ? "hit" : "miss"}.
            </p>
            {result.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </details>
          <p className="descriptor-note">
            Exploratory docking scores, not binding probabilities. Compare ranks within a scoring function; Vina and Vinardo scores are not interchangeable.
          </p>
        </section>
      )}
    </>
  );
}
