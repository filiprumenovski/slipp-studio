# SLiPP Studio · User guide

Native structural-biology workspace built with Tauri 2, Rust, React and Mol*. Presentation-first: inspect a protein, focus a pocket, reveal its geometry and residues, and explore its evidence.

[Paper-style software description](../output/pdf/SLiPP-Studio-software-paper.pdf) · [Source, implementation map and rebuild instructions](studio-paper/README.md)

This repository contains the desktop app, reference projects, and software documentation. Optional geometric model weights and their scientific runtime are installed separately; see [geometric model setup](geometric-model.md).

The Model dropdown also supports the registered **SaProt–EGNN asymmetric fold-2 checkpoint**, with binary pocket ranking and eight separate lipid-class scores. See [installation, inference semantics and checks](geometric-model.md). This addition postdates the paper's original-SLiPP snapshot.

## Run

```sh
npm ci
npm run tauri dev
```

Requires Node 22.12+ (or a compatible current release), Rust and the Tauri platform prerequisites. No backend service is required. Vite runs only during development.

```sh
npm run build           # TypeScript + frontend production build
npm test                # Rust project-loading and validation checks
npm run tauri build     # Packaged native application
```

On macOS the app is produced at `src-tauri/target/release/bundle/macos/SLiPP Studio.app`. It embeds the reference project and works without a development server or network connection.

## Presentation flow

1. From Home, open **BstB reference analysis**. The bundled apo BstB structure (7T1M, MSE→MET prepared copy) and 17 real fpocket candidates load.
2. Rotate with left-drag; zoom with the wheel; pan with right-drag.
3. Select **Pocket 01**. Its actual alpha spheres and lining residues appear; the camera frames the pocket.
4. Toggle **All pockets** to overlay every pocket at once and frame the whole structure. The selected pocket stays emphasized. Toggle it off to return to a single overlay; **Pocket** hides all pocket geometry. **Surface**, **Residues**, and **Ligands** remain independent. Double-click a pocket for tighter framing.
5. Open **Features** or **Residues**. Hover a residue to highlight it; click to focus.
6. Compare Pocket 03 or 04, then reset the camera with **R**.
7. Press **P** for presentation mode; **Escape** to exit. **⌘K / Ctrl+K** opens commands.
8. Use the camera button for a PNG of the molecular view; the inspector export button saves the pocket table as CSV.

The BstB reference includes real fpocket geometry, descriptors and original SLiPP scores. The older 1ATP geometry-only fixture remains in `demo/canonical-project/`. Use **Detect pockets + SLiPP** to compute new pockets and original SLiPP scores locally.

## Projects

Open a normalized `studio.json` beside its PDB/mmCIF file. Rust validates schema version, IDs, coordinates, probabilities, file containment and residue references. See [schema](schema.md) and [reference provenance](../demo/canonical-project/README.md).

Browser preview (`npm run dev`) can inspect the reference, local folders and imported workspaces. Native project IO and exports use Tauri/Rust. Vite 7 is pinned because Vite 8's dependency optimizer failed to initialize Mol*'s cyclic behavior modules during runtime verification.

## SMILES docking

The native app now runs local **AutoDock Vina** docking from the inspector's **Docking** tab. Install the scientific runtime with `./scripts/setup-science.sh`, select a pocket, enter a prepared isomeric SMILES string, and run a search. Poses can be selected in the molecular viewer and exported as SDF with scores and run metadata. The worker uses a rigid protein receptor; supported waters and ions can be retained explicitly in preparation. Read [method, assumptions and performance](docking.md) before interpreting results. Pocket detection and original SLiPP inference run through the same local scientific runtime.

Light mode is the default. The top-bar theme control switches to dark mode. The compact workspace uses Helvetica/Arial, tabular numerals, shaded blue pocket overlays, and independently scrolling inspectors; narrow browser panes stack the inspector beneath the canvas.

### Structure library

Use the folder button beside **Structures** to browse a directory of PDB/ENT and CIF/mmCIF files, including subfolders. Filter by filename and use Up/Down or Home/End in the rail to navigate. Only selected coordinates are parsed; visible rows are rendered on demand, and previews are generated for visited structures (up to 100 cached thumbnails). Native folder scans skip symlinks and accept up to 10,000 structures; individual files are limited to 20 MB. The browser preview also accepts folders through its local file picker. Workspace autosave preserves visited structures, preparation settings, lipid definitions, docking jobs and pose results. Native folder entries persist, and visited structures remain usable if their source files move. Raw imports initially have no pocket results; use Detect pockets + SLiPP. Switching structures retains each analysis. Browser folder files are retained in IndexedDB; exported workspaces embed visited coordinates and folder metadata, so unvisited files must be reselected when importing in a browser.

### Pocket anatomy

The **Anatomy** inspector links cavity shape, hydrophobic atoms, potential hydrogen-bond anchors, candidate openings and neighboring chains directly to the molecular viewer. Residue selection isolates its markers and focuses the camera. Atom inspection fades the pocket envelope; selecting shape restores it. Nearby chain atoms are those within 5 Å of the alpha-sphere envelope in the loaded coordinate model.

Mol* derives chemical features from polymer bonding and valence, with nonpolymer ligands, waters and ions omitted. Access markers use straight rays from at most 128 alpha-sphere centers in 96 directions, avoiding polymer van der Waals spheres expanded by a 1.4 Å water probe. These are candidate access samples, not distinct entrances or evidence of lipid passage; a zero count does not rule out curved paths. No bound ligand is required. Run `npm run test:anatomy` for geometry and real-structure checks, including invariance after removing the reference ligand.

### Protein → pockets → lipids

1. Install once: `./scripts/setup-science.sh` (C toolchain, git and uv required). It builds pinned fpocket 4.0 and installs the scientific Python runtime. The first inference fits and caches the original SLiPP forest.
2. Open a protein file/folder, or expand **Import PDB / workspace** and enter a four-character PDB ID or HTTPS RCSB/PDBe entry URL. Download uses the canonical RCSB mmCIF endpoint, bounded to 20 MB. Automatic pocket detection after download is selected by default.
3. **Detect pockets + SLiPP** uses first-model protein heavy atoms, removes alternate conformations, excludes nonprotein residues, and respects excluded chains. Author chain/residue IDs are mapped through legacy PDB coordinates and restored; coordinate positions are unchanged. Current fpocket input limits are 62 protein chains / 99,999 heavy atoms / 9,999 residues per chain, reported explicitly on overflow.
4. Pockets default to descending **Relative SLiPP**, calculated as raw score divided by the highest raw score in that protein's full analysis. A positive maximum becomes 1; all-zero sets remain zero and missing predictions remain missing. This is a within-protein prioritization scale, not calibrated binding likelihood or a cross-protein confidence scale. Raw scores remain in the overview, model details and CSV export (`slipp_score`); CSV also includes `slipp_relative_score`. Stored model outputs are unchanged. This is the original binary SLiPP recipe, not the SLiPP++ multi-class model. The original repo ships training data and an unseeded training recipe, not frozen weights. Studio uses its exact 17 features, sklearn 1.8.0 and a fixed forest seed of 2026. See [model provenance](../scripts/inference/model/README.md). fpocket's own Monte Carlo descriptors may vary between runs.
5. In **Docking**, select named lipids or add an explicitly prepared isomeric SMILES. Choose the current pocket, top five by SLiPP, or a custom pocket set. Queue up to 100 pairs; the queue runs one native Vina job at a time, leaving parallel search to Vina. Stop pauses pending jobs and cancels the current search. Failed jobs retain the error; other queued pairs continue.
6. The **Pocket × lipid** grid shows each pair's latest run and separates Vina from Vinardo. Expand it for comparison; click a score to inspect poses, then use Contacts for actual interaction geometry. Relative SLiPP remains separate from unchanged docking scores in kcal/mol, and different lipid sizes can bias cross-lipid comparisons. Run history preserves repeat searches.
7. Workspaces autosave locally in IndexedDB. Restarted queued/running jobs become paused; resume explicitly. Export a portable `.slipp` copy containing coordinates, preparation, lipid definitions, jobs, poses and provenance. Imports merge rather than discard existing documents. Recomputing pockets after docking preserves the prior analysis as a separate saved document.

`npm run test:inference` checks the actual fpocket pipeline, model feature ordering, author-ID mapping and cancellation. `npm run test:workspace` checks persistence payloads, independent preparation state, paused recovery and malformed-input rejection. Starter neutral fatty acids and stereospecified cholesterol come from PubChem; exact source links and SMILES are stored with each lipid and each run. No pH state enumeration is implied.
