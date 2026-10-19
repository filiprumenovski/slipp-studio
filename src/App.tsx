import { useEffect, useRef, useState, useCallback, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import {
  Atom,
  Home as HomeIcon,
  ArrowUpRight,
  ChevronRight,
  Command,
  Crosshair,
  FileDown,
  FolderOpen,
  Layers3,
  Maximize2,
  Microscope,
  RotateCcw,
  Search,
  Sparkles,
  X,
  Camera,
  Circle,
  Box,
  Boxes,
  Hexagon,
  Check,
  LoaderCircle,
  PanelRightClose,
  Sun,
  Moon,
} from "lucide-react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { MolstarController } from "./molstar/MolstarController";
import { AnatomyPanel } from "./AnatomyPanel";
import { useWorkspace, initializeWorkspace } from "./workspace";
import { WorkflowControls } from "./WorkflowControls";
import { Home } from "./Home";
import { PaneDivider, fitPanes, readPanes } from "./PaneDivider";
import { StructureLibrary, type StructureLibraryHandle } from "./StructureLibrary";
import { ContactsPanel } from "./ContactsPanel";
import { PreparationPanel } from "./PreparationPanel";
import { DockingPanel } from "./DockingPanel";
import { useStudio } from "./store";
import { relativePocketScores } from "./pocketScores";
import { LIPID_CLASSES } from "./types";
import type { LoadedProject, Pocket, ViewOptions } from "./types";

const number = (v: number | undefined, digits = 2) =>
  v == null
    ? "—"
    : v.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
const pocketName = (p: Pocket) => `Pocket ${String(p.rank).padStart(2, "0")}`;
const csvCell = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;

function Viewport({
  loaded,
  onReady,
  onError,
}: {
  loaded: LoadedProject;
  onReady: (v: MolstarController | null) => void;
  onError: (e: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<MolstarController | null>(null);
  const [ready, setReady] = useState(false);
  const selected = useStudio((s) => s.selectedId);
  const options = useStudio((s) => s.options);
  const theme = useStudio((s) => s.theme);
  const docking = useStudio((s) => s.tab === "docking" || s.tab === "contacts" || (s.tab === "anatomy" && s.anatomyLayer !== "shape"));
  useEffect(() => {
    let canceled = false;
    let completed = false;
    setReady(false);
    const c = new MolstarController();
    // Each asynchronous controller owns its own mount; disposal cannot remove a successor canvas.
    const mount=document.createElement("div");mount.className="molstar-instance";host.current!.appendChild(mount);
    controller.current = c;
    void (async () => {
      try {
        await c.init(mount, useStudio.getState().theme);
        if (canceled) {
          c.dispose();
          return;
        }
        await c.load(loaded);
        if (canceled) {
          c.dispose();
          return;
        }
        completed = true;
        setReady(true);
        onReady(c);
      } catch (e) {
        if (!canceled) onError(String(e));
        c.dispose();
      }
    })();
    return () => {
      canceled = true;
      mount.remove();
      onReady(null);
      if (completed) c.dispose();
    };
  }, [loaded, onReady, onError]); // loaded is replaced only when opening a project.
  useEffect(() => {
    if (ready) {
      controller.current?.setTheme(theme);
      void controller.current
        ?.synchronize(
          loaded.project.pockets.find((p) => p.id === selected),
          options,
          docking,
        )
        .catch((e) => onError(String(e)));
    }
  }, [ready, loaded, selected, options, theme, docking, onError]);
  return (
    <>
      <div
        ref={host}
        className="molstar-host"
        aria-label="Interactive molecular structure. Drag to rotate, scroll to zoom, right-drag to pan."
      />
      {!ready && (
        <div className="viewport-loading">
          <LoaderCircle className="spin" size={22} />
          <span>Loading structure</span>
          <small>Parsing coordinates and generating representations</small>
        </div>
      )}
    </>
  );
}

function Metric({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <div>
        {number(value, label === "Volume" ? 1 : 3)}
        {unit && <small> {unit}</small>}
      </div>
    </div>
  );
}

export function App() {
  const workspace=useWorkspace();
  const workspaceHost=useRef<HTMLDivElement>(null);
  const [paneWidths,setPaneWidths]=useState(readPanes),[workspaceWidth,setWorkspaceWidth]=useState(window.innerWidth);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setWorkspaceWidth(entry.contentRect.width));observer.observe(workspaceHost.current!);return()=>observer.disconnect();},[]);
  useEffect(()=>{try{localStorage.setItem('slipp-pane-widths',JSON.stringify(paneWidths));}catch{/* Resizing remains available without persistence. */}},[paneWidths]);
  const panes=fitPanes(workspaceWidth,paneWidths);
  const resizePane=(side:'left'|'right',width:number)=>setPaneWidths({...panes,[side]:width});
  const loaded=workspace.activeId?workspace.documents[workspace.activeId]?.loaded??null:null;
  const setLoaded=workspace.open;
  useEffect(()=>{void initializeWorkspace();},[]);
  const [loading, setBusy] = useState(false);
  const busy=loading||!workspace.hydrated;
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("slipp");
  const [notice, setNotice] = useState("");
  const [renderReady, setRenderReady] = useState(false);
  const [hasDockedPose, setHasDockedPose] = useState(false);
  const [poseRevision,setPoseRevision] = useState(0);
  const viewer = useRef<MolstarController | null>(null);
  const library=useRef<StructureLibraryHandle>(null);
  const studio = useStudio();
  useEffect(() => {
    document.documentElement.dataset.theme = studio.theme;
  }, [studio.theme]);
  const project = loaded?.project;
  const relativeScores = relativePocketScores(project?.pockets ?? []);
  const pocket = project?.pockets.find((p) => p.id === studio.selectedId);
  const onReady = useCallback((c: MolstarController | null) => {
    viewer.current = c;
    setRenderReady(!!c);
    if (!c) setHasDockedPose(false);
  }, []);
  const showPose = useCallback(async (sdf: string | null, receptor?: string) => {
    const controller = viewer.current;
    if (!controller) return;
    await controller.setPreparedReceptor(receptor ?? null);
    await controller.showDockedPose(sdf);
    setPoseRevision(v=>sdf ? v+1 : 0);
    if (viewer.current === controller) setHasDockedPose(!!sdf);
  }, []);
  const onError = useCallback((message: string) => setError(message), []);

  function goHome(){
    useWorkspace.setState({activeId:null});studio.select(null);studio.setTab('overview');
    if(studio.presentation)studio.present();setError(null);
  }
  async function loadProject(demo = false) {
    if (busy) return;
    setError(null);
    try {
      let path: string | null = null;
      if (!demo) {
        if (!isTauri()) {
          library.current?.openFiles();
          return;
        }
        const chosen = await open({
          title: "Open SLiPP Studio project",
          filters: [{ name: "Structures and Studio projects", extensions: ["json", "pdb", "ent", "cif", "mmcif"] }],
          multiple: false,
        });
        if (!chosen) return;
        path = chosen;
      }
      setBusy(true);
      let next: LoadedProject;
      if (isTauri())
        next = await invoke<LoadedProject>(
          demo ? "open_demo" : /\.(pdb|ent|cif|mmcif)$/i.test(path!) ? "open_structure" : "open_project",
          demo ? {} : { path },
        );
      else {
        const [dto, structure] = await Promise.all([
          import("../demo/lipid-reference/studio.json"),
          import("../demo/lipid-reference/structure.pdb?raw"),
        ]);
        next = {
          project: dto.default as unknown as LoadedProject["project"],
          structureData: structure.default,
          warnings: [],
        };
      }
      studio.select(null);
      setLoaded(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportFile(kind: "json" | "csv" | "png") {
    if (!project) return;
    try {
      let bytes: number[],
        text = "";
      if (kind === "png") {
        if (!viewer.current) return;
        const uri = await viewer.current.screenshot();
        bytes = Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0));
      } else {
        text =
          kind === "json"
            ? JSON.stringify(project, null, 2)
            : [
                [
                  "pocket",
                  "rank",
                  "fpocket_score",
                  "volume_A3",
                  "slipp_class",
                  "slipp_score",
                  "slipp_relative_score",
                  "model_version",
                  "model_name",
                  ...LIPID_CLASSES.map(name=>`lipid_class_${name}`),
                ],
                ...project.pockets.map((p) => [
                  p.id,
                  p.rank,
                  p.fpocket.Score,
                  p.fpocket.Volume,
                  p.prediction?.label,
                  p.prediction?.probability,
                  relativeScores.get(p.id),
                  project.model.version,
                  project.model.name,
                  ...LIPID_CLASSES.map(name=>p.prediction?.lipidClasses?.scores[name]),
                ]),
              ]
                .map((row) => row.map(csvCell).join(","))
                .join("\r\n");
        bytes = Array.from(new TextEncoder().encode(text));
      }
      const filename = `${project.structure.id}-${kind === "png" ? (pocket?.id ?? "structure") : "pockets"}.${kind}`;
      if (isTauri()) {
        const path = await save({
          defaultPath: filename,
          filters: [{ name: kind.toUpperCase(), extensions: [kind] }],
        });
        if (!path) return;
        await invoke("save_export", { path, bytes });
      } else {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], {
            type: kind === "png" ? "image/png" : "text/plain",
          }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      }
      setNotice(`Exported ${filename}`);
    } catch (e) {
      setError(`Export failed: ${String(e)}`);
    }
  }

  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((s) => !s);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void loadProject();
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        palette
      )
        return;
      if (e.key === "Escape") {
        if (studio.presentation) studio.present();
        else studio.select(null);
      }
      if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && project)
        studio.present();
      if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey)
        viewer.current?.reset();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const commands = [
    {label:"Return to Home",hint:"",action:goHome},
    {
      label: `Switch to ${studio.theme === "light" ? "dark" : "light"} mode`,
      hint: "",
      action: studio.toggleTheme,
    },
    { label: "Open project", hint: "⌘ O", action: () => void loadProject() },
    {
      label: "Open reference project · BstB / 7T1M",
      hint: "Demo",
      action: () => void loadProject(true),
    },
    ...(project
      ? [
          {
            label: "Reset camera",
            hint: "R",
            action: () => viewer.current?.reset(),
          },
          {
            label: studio.presentation
              ? "Exit presentation"
              : "Enter presentation",
            hint: "P",
            action: studio.present,
          },
          ...(
            [
              "surface",
              "geometry",
              "allPockets",
              "residues",
              "ligands",
            ] as const
          ).map((key) => ({
            label: `${studio.options[key] ? "Hide" : "Show"} ${key === "geometry" ? "pocket geometry" : key === "allPockets" ? "all pockets" : key}`,
            hint: "",
            action: () => studio.toggle(key),
          })),
          {
            label: "Export pocket table",
            hint: "CSV",
            action: () => void exportFile("csv"),
          },
          {
            label: "Export normalized project",
            hint: "JSON",
            action: () => void exportFile("json"),
          },
          {
            label: "Capture molecular view",
            hint: "PNG",
            action: () => void exportFile("png"),
          },
          ...project.pockets.map((p) => ({
            label: `Focus ${pocketName(p)}`,
            hint: sort==="slipp"&&p.prediction?`Relative pocket score ${relativeScores.get(p.id)?.toFixed(3)} · raw ${p.prediction.probability.toFixed(3)}`:`${number(p.fpocket.Volume, 0)} Å³`,
            action: () => studio.select(p.id),
          })),
        ]
      : []),
  ].filter((c) => c.label.toLowerCase().includes(query.toLowerCase()));
  const pockets = [...(project?.pockets ?? [])].sort((a, b) =>
    sort === "slipp" ? (b.prediction?.probability ?? -1) - (a.prediction?.probability ?? -1) || a.rank-b.rank : sort === "volume"
      ? (b.fpocket.Volume ?? -Infinity) - (a.fpocket.Volume ?? -Infinity)
      : a.rank - b.rank,
  );
  const representations: {
    key: keyof ViewOptions;
    label: string;
    icon: typeof Atom;
  }[] = [
    { key: "cartoon", label: "Cartoon", icon: Atom },
    { key: "surface", label: "Surface", icon: Layers3 },
    { key: "geometry", label: "Pocket", icon: Box },
    { key: "allPockets", label: "All pockets", icon: Boxes },
    { key: "residues", label: "Residues", icon: Hexagon },
    { key: "ligands", label: "Ligands", icon: Circle },
  ];

  return (
    <div className={`studio ${studio.presentation ? "presenting" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>
            SLiPP<span> Studio</span>
          </strong>
          <span className="lab-wordmark" aria-label="Dassama Lab">Dassama Lab</span>
          <span className="version">PREVIEW</span>
        </div>
        <div className="project-breadcrumb">
          <span className="divider" />
          {project ? (
            <>
              <span>{project.name}</span>
              <ChevronRight size={13} />
              <span className="mono">{project.structure.id}</span>
            </>
          ) : (
            <span>Structural workspace</span>
          )}
        </div>
        <div className="top-actions">
          <button className="quiet home-button" aria-label="Home" disabled={!workspace.hydrated} aria-current={!project?"page":undefined} onClick={goHome} title="Return to Home"><HomeIcon size={15}/><span>Home</span></button>
          <button
            className="icon-button"
            title={`Switch to ${studio.theme === "light" ? "dark" : "light"} mode`}
            aria-label={`Switch to ${studio.theme === "light" ? "dark" : "light"} mode`}
            onClick={studio.toggleTheme}
          >
            {studio.theme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </button>
          <button
            className="quiet"
            title="Open project · ⌘O"
            onClick={() => void loadProject()}
            disabled={busy}
          >
            <FolderOpen size={15} />
            <span>Open project</span>
          </button>
          <button
            className="command-trigger"
            onClick={() => {
              setQuery("");
              setPalette(true);
            }}
            title="Commands · ⌘K"
          >
            <Search size={14} />
            <span>Commands</span>
            <kbd>⌘ K</kbd>
          </button>
          <span className="divider" />
          <button
            className="icon-button"
            title="Presentation mode · P"
            aria-label="Presentation mode"
            disabled={!project}
            onClick={studio.present}
          >
            <Maximize2 size={16} />
          </button>
        </div>
      </header>
      <div ref={workspaceHost} className={`workspace ${!project?"home-workspace":""}`} style={{"--navigator-width":`${panes.left}px`,"--inspector-width":`${panes.right}px`} as CSSProperties}>
        <aside className="navigator" id="structure-navigator">
          {project&&<WorkflowControls onError={onError}/>}
          <StructureLibrary ref={library} loaded={loaded} viewer={viewer.current} ready={renderReady} busy={busy} onBusy={setBusy} onError={onError} onLoad={next=>{setError(null);studio.select(null);setLoaded(next);}} onReset={()=>{studio.select(null);viewer.current?.reset();}}/>
          <div className="section-label">
            <span>CANDIDATE POCKETS</span>
            <span className="count">
              {pockets.length.toString().padStart(2, "0")}
            </span>
          </div>
          {project && (
            <div className="list-caption">
              <label>
                Sort by{" "}
                <select
                  aria-label="Sort pockets"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="slipp">Relative pocket score</option>
                  <option value="rank">fpocket rank</option>
                  <option value="volume">volume</option>
                </select>
              </label>
              <span>{sort==="slipp"&&pockets.some(p=>p.prediction)?"REL. · 0–1":"VOLUME · Å³"}</span>
            </div>
          )}
          <div
            className="pocket-list"
            role="listbox"
            aria-label="Candidate pockets"
          >
            {pockets.map((p, i) => (
              <button
                key={p.id}
                role="option"
                aria-selected={p.id === studio.selectedId}
                tabIndex={
                  p.id === studio.selectedId || (!studio.selectedId && i === 0)
                    ? 0
                    : -1
                }
                className={`pocket-row ${p.id === studio.selectedId ? "selected" : ""}`}
                onClick={() => studio.select(p.id)}
                onDoubleClick={() => viewer.current?.focusPocket(p, true)}
                onKeyDown={(e) => {
                  const direction =
                    e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
                  if (direction) {
                    e.preventDefault();
                    const index =
                      (i + direction + pockets.length) % pockets.length;
                    studio.select(pockets[index].id);
                    (
                      e.currentTarget.parentElement?.children[
                        index
                      ] as HTMLButtonElement
                    )?.focus();
                  }
                }}
              >
                <span className="pocket-row-info">
                  <strong>{pocketName(p)}</strong>
                  <small
                    title={
                      p.prediction?.label ??
                      `${p.residues.length} lining residues`
                    }
                  >
                    {p.prediction?.label ?? `${p.residues.length} res.`}
                  </small>
                </span>
                <span className="pocket-volume" title={sort==="slipp"&&p.prediction?`Relative to the highest score in this protein · raw model ${p.prediction.probability.toFixed(3)}`:undefined}>
                  {sort==="slipp"?(relativeScores.get(p.id)?.toFixed(3) ?? "—"):number(p.fpocket.Volume, 0)}
                  <span className="selection-dot" />
                </span>
              </button>
            ))}
            {!pockets.length && (
              <div className="nav-empty">
                <Layers3 size={25} strokeWidth={1} />
                <p>{project ? "Coordinates only" : "No pocket data loaded."}</p>
                <span>
                  {project ? "Choose a lipid-binding model, then detect pockets to analyze this protein." : "Open a folder of structures or a Studio project."}
                </span>
              </div>
            )}
          </div>
          <div className="nav-footer">
            <span className="source-symbol">
              <Microscope size={15} />
            </span>
            <div>
              <strong>{pockets.length ? "fpocket results" : project ? "Local structure" : "Project data"}</strong>
              <small>
                {pockets.length
                  ? (project?.model.version?project.model.name:"Precomputed geometry")
                  : project ? "Coordinates only" : "PDB/mmCIF + pocket results"}
              </small>
            </div>
          </div>
        </aside>
        <PaneDivider side="left" value={panes.left} max={Math.max(170,Math.min(380,workspaceWidth-310-panes.right))} onChange={width=>resizePane("left",width)}/>
        <main className="viewport">
          {loaded && (
            <Viewport loaded={loaded} onReady={onReady} onError={onError} />
          )}
          {project && (
            <div className="viewport-heading">
              <div className="eyebrow">MOLECULAR VIEW</div>
              <h1>{project.name}</h1>
              <p>{project.description}</p>
            </div>
          )}
          {project && (
            <div className="viewport-badges">
              <span>
                <i className="dot teal" />
                {project.structure.id}
              </span>
              <span>{pocket ? pocketName(pocket) : "Whole structure"}</span>
            </div>
          )}
          {!project&&<Home busy={busy} onOpen={()=>void loadProject()} onFolder={()=>library.current?.openFolder()} onReference={()=>void loadProject(true)} onError={onError}/>}
          {project && (
            <>
              <div className="viewport-legend">
                <span>
                  <i className="dot teal" />
                  Protein
                </span>
                <span>
                  <i className="dot gold" />
                  {pocket
                    ? "Selected pocket"
                    : studio.options.allPockets
                      ? "Pocket overlays"
                      : "Ligand"}
                </span>
                {hasDockedPose && (
                  <span>
                    <i className="dot docked" />
                    Docked ligand
                  </span>
                )}
                {(studio.options.allPockets || pocket) && (
                  <span className="geometry-caption">
                    {studio.options.allPockets
                      ? `${project.pockets.length} pocket overlays`
                      : `${pocket!.geometry.alphaSpheres.length} alpha spheres`}
                  </span>
                )}
              </div>
              <div className="camera-actions">
                <button
                  className="icon-button"
                  aria-label="Capture molecular view"
                  title="Capture molecular view · PNG"
                  disabled={!renderReady}
                  onClick={() => void exportFile("png")}
                >
                  <Camera size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset camera"
                  title="Reset camera · R"
                  disabled={!renderReady}
                  onClick={() => viewer.current?.reset()}
                >
                  <RotateCcw size={16} />
                </button>
              </div>
              <div className="viewport-toolbar">
                <div className="representation-buttons">
                  {representations.map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      aria-pressed={studio.options[key]}
                      data-representation={key}
                      title={`Toggle ${label.toLowerCase()}`}
                      disabled={!renderReady}
                      className={studio.options[key] ? "active" : ""}
                      onClick={() => studio.toggle(key)}
                    >
                      <Icon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
                <span className="toolbar-divider" />
                <button
                  className="focus-button"
                  disabled={!pocket || !renderReady}
                  onClick={() =>
                    pocket && viewer.current?.focusPocket(pocket, true)
                  }
                  title="Focus pocket · double-click pocket row"
                >
                  <Crosshair size={15} />
                  <span>Focus</span>
                </button>
              </div>
              <div className="interaction-hint">
                Drag to rotate<span>·</span>Scroll to zoom<span>·</span>
                Right-drag to pan
              </div>
            </>
          )}
          {busy && project && (
            <div className="loading-pill">
              <LoaderCircle className="spin" size={14} />
              Opening project…
            </div>
          )}
          {studio.presentation && (
            <button className="exit-presentation" onClick={studio.present}>
              <PanelRightClose size={14} />
              Exit presentation<kbd>Esc</kbd>
            </button>
          )}
        </main>
        <PaneDivider side="right" value={panes.right} max={Math.max(280,Math.min(640,workspaceWidth-310-panes.left))} onChange={width=>resizePane("right",width)}/>
        <aside className="inspector" id="pocket-inspector">
          <div className="inspector-top">
            <span className="eyebrow">
              {pocket ? "POCKET INSPECTOR" : "STRUCTURE INSPECTOR"}
            </span>
            <button
              className="icon-button"
              aria-label="Export pocket table"
              title="Export pocket table · CSV"
              disabled={!project}
              onClick={() => void exportFile("csv")}
            >
              <FileDown size={15} />
            </button>
          </div>
          {project ? (
            <>
              <div className="inspector-title">
                <span className="eyebrow">
                  {pocket
                    ? `FPOCKET RANK ${String(pocket.rank).padStart(2, "0")}`
                    : project.structure.source}
                </span>
                <h2>{pocket ? pocketName(pocket) : project.structure.id}</h2>
                <p>
                  {pocket
                    ? `${pocket.residues.length} residues · ${new Set(pocket.residues.map((r) => r.chain)).size} chains`
                    : project.name}
                </p>
              </div>
              <div
                className="inspector-tabs"
                role="tablist"
                aria-label="Pocket information"
              >
                {(
                  [
                    "overview",
                    "anatomy",
                    "features",
                    "residues",
                    "model",
                    "docking",
                    "contacts",
                    "prepare",
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab}
                    id={`tab-${tab}`}
                    role="tab"
                    tabIndex={studio.tab === tab ? 0 : -1}
                    onKeyDown={(e) => {
                      const tabs = [
                        "overview",
                        "anatomy",
                        "features",
                        "residues",
                        "model",
                        "docking",
                        "contacts",
                        "prepare",
                      ] as const;
                      const delta =
                        e.key === "ArrowRight"
                          ? 1
                          : e.key === "ArrowLeft"
                            ? -1
                            : 0;
                      if (delta) {
                        e.preventDefault();
                        const next =
                          (tabs.indexOf(tab) + delta + tabs.length) %
                          tabs.length;
                        studio.setTab(tabs[next]);
                        (
                          e.currentTarget.parentElement?.children[
                            next
                          ] as HTMLButtonElement
                        )?.focus();
                      }
                    }}
                    aria-selected={studio.tab === tab}
                    aria-controls="inspector-panel"
                    onClick={() => studio.setTab(tab)}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              <div
                className="inspector-scroll"
                id="inspector-panel"
                role="tabpanel"
                aria-labelledby={`tab-${studio.tab}`}
              >
                {loaded && (
                  <div hidden={studio.tab !== "docking"}>
                    <DockingPanel
                      loaded={loaded}
                      pocket={pocket}
                      ready={renderReady}
                      showPose={showPose}
                    />
                  </div>
                )}
                {loaded && <div hidden={studio.tab !== "prepare"}><PreparationPanel loaded={loaded} viewer={renderReady?viewer.current:null} active={studio.tab === "prepare"}/></div>}
                {studio.tab === "anatomy" && <AnatomyPanel key={pocket?.id ?? "none"} viewer={renderReady?viewer.current:null} pocket={pocket}/>}
                {studio.tab === "contacts" && renderReady && <ContactsPanel viewer={viewer.current} poseRevision={poseRevision}/>}
                <div>
                    {studio.tab === "overview" && (
                      <>
                        <div className="panel-section">
                          <div className="section-label">
                            <span>LIPID-BINDING PREDICTION</span>
                            <Sparkles size={13} />
                          </div>
                          {pocket?.prediction ? (
                            <div className="prediction">
                              <span>Relative pocket score</span>
                              <strong>
                                {relativeScores.get(pocket.id)?.toFixed(3)}
                                <small> / 1</small>
                              </strong>
                              <p>
                                Raw model score: {pocket.prediction.probability.toFixed(3)}. Relative score = raw ÷ highest raw score in this protein; all-zero sets remain 0. Not a binding probability or a cross-protein scale.
                              </p>
                            </div>
                          ) : (
                            <div className="prediction-pending">
                              <span className="empty-dash">—</span>
                              <div>
                                <strong>Prediction unavailable</strong>
                                <p>
                                  {pocket
                                    ? "No model output is included for this pocket."
                                    : "Select a pocket to inspect its model output."}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="panel-section">
                          <div className="section-label">
                            <span>
                              {pocket
                                ? "FPOCKET DESCRIPTORS"
                                : "STRUCTURAL CONTEXT"}
                            </span>
                            <span className="tiny-tag">
                              {pocket ? "RAW" : "PDB"}
                            </span>
                          </div>
                          {pocket ? (
                            <>
                              <div className="metric-grid">
                                <Metric
                                  label="Volume"
                                  value={pocket.fpocket.Volume}
                                  unit="Å³"
                                />
                                <Metric
                                  label="Pocket score"
                                  value={pocket.fpocket.Score}
                                />
                                <Metric
                                  label="Druggability"
                                  value={pocket.fpocket["Druggability Score"]}
                                />
                                <Metric
                                  label="Mean radius"
                                  value={
                                    pocket.fpocket["Mean alpha sphere radius"]
                                  }
                                  unit="Å"
                                />
                              </div>
                              <div className="descriptor-note">
                                fpocket descriptors describe cavity geometry and chemistry;
                                model scores are shown separately.
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="context-row">
                                <span>Candidate pockets</span>
                                <strong>{project.pockets.length}</strong>
                              </div>
                              <div className="context-row">
                                <span>Coordinates</span>
                                <strong>
                                  {project.structure.format.toUpperCase()}
                                </strong>
                              </div>
                              <div className="context-row">
                                <span>Pocket geometry</span>
                                <strong>{project.pockets.length ? "Alpha spheres" : "Not computed"}</strong>
                              </div>
                              <div className="context-row">
                                <span>Model predictions</span>
                                <strong>
                                  {
                                    project.pockets.filter((p) => p.prediction)
                                      .length
                                  }{" "}
                                  supplied
                                </strong>
                              </div>
                            </>
                          )}
                        </div>
                        {pocket && (
                          <div className="panel-section">
                            <div className="section-label">
                              <span>LINING RESIDUES</span>
                              <button
                                className="text-button"
                                onClick={() => studio.setTab("residues")}
                              >
                                View all <ChevronRight size={11} />
                              </button>
                            </div>
                            <div className="residue-chips">
                              {pocket.residues.slice(0, 12).map((r) => (
                                <button
                                  key={`${r.chain}-${r.seq}-${r.insertionCode}-${r.name}`}
                                  onClick={() =>
                                    viewer.current?.focusResidue(r)
                                  }
                                  onMouseEnter={() =>
                                    viewer.current?.hoverResidue(r)
                                  }
                                  onMouseLeave={() =>
                                    viewer.current?.hoverResidue()
                                  }
                                  title={`Focus ${r.chain}:${r.seq}${r.insertionCode} ${r.name}`}
                                >
                                  {r.name}
                                  <span>
                                    {r.seq}
                                    {r.insertionCode}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="evidence-note">
                          <span className="eyebrow">DATA PROVENANCE</span>
                          <p>
                            First coordinate model. Residues use author chain
                            IDs and sequence numbering.
                          </p>
                          <span>{project.structure.source}</span>
                        </div>
                      </>
                    )}
                    {studio.tab === "features" && (
                      <div className="panel-section">
                        <div className="section-label">
                          <span>MODEL INPUT DESCRIPTORS</span>
                          <span className="count">
                            {pocket?.features.length ?? 0}
                          </span>
                        </div>
                        {pocket ? (
                          <>
                            <p className="section-description">
                              Unstandardized model input descriptors, with units where
                              specified. {pocket.prediction?.lipidClasses?'Includes derived shape and residue-chemistry features; graph and SaProt inputs are recorded in provenance.':''}
                            </p>
                            <div className="feature-table">
                              {pocket.features.map((f) => (
                                <div key={f.name}>
                                  <span>{f.name}</span>
                                  <strong>
                                    {number(f.value, 3)}
                                    {f.unit && <small> {f.unit}</small>}
                                  </strong>
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="section-description">
                            Select a pocket to explore its descriptors.
                          </p>
                        )}
                      </div>
                    )}
                    {studio.tab === "residues" && (
                      <div className="panel-section">
                        <div className="section-label">
                          <span>POCKET-LINING RESIDUES</span>
                          <span className="count">
                            {pocket?.residues.length ?? 0}
                          </span>
                        </div>
                        <p className="section-description">
                          Hover to highlight. Click to focus in 3D.
                        </p>
                        <div className="residue-table">
                          <div className="residue-table-head">
                            <span>RESIDUE</span>
                            <span>CHAIN</span>
                            <span>POSITION</span>
                          </div>
                          {pocket?.residues.map((r) => (
                            <button
                              key={`${r.chain}-${r.seq}-${r.insertionCode}-${r.name}`}
                              onClick={() => viewer.current?.focusResidue(r)}
                              onMouseEnter={() =>
                                viewer.current?.hoverResidue(r)
                              }
                              onMouseLeave={() =>
                                viewer.current?.hoverResidue()
                              }
                              onFocus={() => viewer.current?.hoverResidue(r)}
                              onBlur={() => viewer.current?.hoverResidue()}
                            >
                              <strong>{r.name}</strong>
                              <span>{r.chain || "∅"}</span>
                              <span>
                                {r.seq}
                                {r.insertionCode}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {studio.tab === "model" && (
                      <div className="panel-section">
                        <div className="section-label">
                          <span>MODELS & SCORING</span>
                          <Sparkles size={13} />
                        </div>
                        <div className="model-selectors">
                          <label>Docking<select aria-label="Docking method" disabled={!!workspace.operation} value={studio.dockingScoring} onChange={e=>studio.setDockingScoring(e.target.value as "vina"|"vinardo")}><option value="vina">AutoDock Vina · Vina scoring</option><option value="vinardo">AutoDock Vina · Vinardo scoring</option></select><small>Scoring for new docking runs. Shared with the Docking tab.</small></label>
                          <label>Pocket detection<select aria-label="Pocket detection method" defaultValue="fpocket" disabled={!!workspace.operation}><option value="fpocket">fpocket 4.0</option></select><small>Installed detector · alpha-sphere geometry and pocket descriptors.</small></label>
                          <label>Lipid-binding model<select aria-label="Lipid-binding model" value={studio.inferenceModel} onChange={e=>studio.setInferenceModel(e.target.value as typeof studio.inferenceModel)} disabled={!!workspace.operation}><option value="slipp">SLiPP · original Dassama Lab model</option><option value="saprot-egnn-fold2">SaProt–EGNN · asymmetric fold 2</option></select><small>{studio.inferenceModel==='slipp'?'17-feature random forest.':'SaProt-35M + residue/cavity EGNN. Binary pocket ranking and eight lipid-class scores; single fold, not the ensemble.'} Applied on the next Detect / Recompute action.</small></label>
                        </div>
                        <p className="descriptor-note">Displayed results: {project.model.name}{project.model.version?'':' · not run'}.</p>
                        {pocket?.prediction?.lipidClasses&&<div className="model-class-scores"><div className="section-label">LIPID-CLASS SCORES</div><p className="descriptor-note">Conditional multilabel head · raw 0–1 scores. Classes can coexist; these scores do not sum to one and do not determine pocket rank.</p>{LIPID_CLASSES.map(label=><div className="probability-row" key={label}><span>{label.replace(/([a-z])([A-Z])/g,'$1 $2')}</span><div><i style={{width:`${pocket.prediction!.lipidClasses!.scores[label]*100}%`}}/></div><strong>{pocket.prediction!.lipidClasses!.scores[label].toFixed(3)}</strong></div>)}</div>}
                        <details className="model-details"><summary>Current prediction details & provenance</summary>
                        <div className="context-row">
                          <span>Version</span>
                          <strong>
                            {project.model.version ?? "Not supplied"}
                          </strong>
                        </div>
                        <div className="context-row">
                          <span>Calibration</span>
                          <strong>{project.model.calibration}</strong>
                        </div>
                        <p className="section-description">
                          {project.model.classes.length} output classes. Scores are the model’s
                          probability estimates on a 0–1 scale, rounded for display.
                          They are not calibrated experimental binding probabilities.
                        </p>
                        {pocket?.prediction &&
                          Object.entries(pocket.prediction.probabilities).map(
                            ([label, p]) => (
                              <div className="probability-row" key={label}>
                                <span>{label}</span>
                                <div>
                                  <i style={{ width: `${p * 100}%` }} />
                                </div>
                                <strong>{p.toFixed(3)}</strong>
                              </div>
                            ),
                          )}
                        <div className="class-labels">
                          {project.model.classes.map((c) => (
                            <span key={c}>{c}</span>
                          ))}
                        </div>
                        <p className="provenance">{project.provenance}</p>
                        </details>
                      </div>
                    )}
                </div>
              </div>
              <div className="inspector-footer">
                <i className="dot gold" />
                {pocket
                  ? "Geometry from fpocket"
                  : project.pockets.length ? (project.model.version?`fpocket + ${project.model.name}`:"Precomputed project bundle") : "Coordinates only · no pocket results"}
                <span>Å</span>
              </div>
            </>
          ) : (
            <div className="inspector-empty">
              <Crosshair size={29} strokeWidth={1} />
              <h3>Pocket inspection</h3>
              <p>
                Load a project to inspect pocket geometry, lining residues,
                fpocket descriptors, and SLiPP++ predictions.
              </p>
              <div className="empty-sequence">
                <span>
                  01 <strong>Load project bundle</strong>
                </span>
                <span>
                  02 <strong>Select candidate pocket</strong>
                </span>
                <span>
                  03 <strong>Inspect geometry and descriptors</strong>
                </span>
              </div>
            </div>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <i className={`dot ${busy ? "gold" : "teal"}`} />
          {busy
            ? "Opening project"
            : project
              ? renderReady
                ? "Structure ready"
                : "Preparing molecular view"
              : "Ready"}
          {project && (
            <span className="status-detail">
              {project.structure.id} · {project.pockets.length} pockets
            </span>
          )}
        </span>
        <span>
          {project
            ? "Local project · coordinates in Å"
            : "PDB/mmCIF · fpocket · SLiPP++"}
          <span className="status-divider">/</span>SLiPP Studio 0.1
        </span>
      </footer>
      <AnimatePresence>
        {notice && (
          <motion.div
            role="status"
            className="toast"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={15} />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>
      <Dialog.Root
        open={!!error}
        onOpenChange={(value) => {
          if (!value) setError(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="error-dialog">
            <Dialog.Title>Operation failed</Dialog.Title>
            <Dialog.Description>{error}</Dialog.Description>
            <Dialog.Close className="primary">Return to workspace</Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={palette} onOpenChange={setPalette}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="command-dialog">
            <Dialog.Title className="sr-only">Studio commands</Dialog.Title>
            <Dialog.Description className="sr-only">
              Search actions and jump to a pocket.
            </Dialog.Description>
            <div className="command-input">
              <Search size={19} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands or jump to a pocket…"
                aria-label="Search commands"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    document
                      .querySelector<HTMLButtonElement>(
                        ".command-results button",
                      )
                      ?.focus();
                  }
                  if (e.key === "Enter" && commands[0]) {
                    setPalette(false);
                    commands[0].action();
                  }
                }}
              />
              <Dialog.Close className="icon-button" aria-label="Close commands">
                <X size={16} />
              </Dialog.Close>
            </div>
            <div className="command-results">
              {commands.map((c) => (
                <button
                  key={c.label}
                  onClick={() => {
                    setPalette(false);
                    c.action();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const next =
                        e.key === "ArrowDown"
                          ? e.currentTarget.nextElementSibling
                          : e.currentTarget.previousElementSibling;
                      (next as HTMLButtonElement | null)?.focus();
                    }
                  }}
                >
                  <Command size={14} />
                  <span>{c.label}</span>
                  <kbd>{c.hint}</kbd>
                </button>
              ))}
              {!commands.length && <p>No matching commands.</p>}
            </div>
            <div className="command-foot">
              <span>↑ ↓ Navigate</span>
              <span>↵ Run command</span>
              <span>Esc Close</span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
