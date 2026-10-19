# SLiPP Studio

## A desktop workbench for lipid-binding site exploration

*Software description · Version 0.1 · 27 September 2026*

> Version note: This is a Markdown edition of the existing software paper, including its full feature appendix. The worked example and Home reference have been revised to BstB (7T1M). The model description retains the original-SLiPP implementation snapshot and predates the subsequent SaProt–EGNN fold-2 integration; the original PDF retains the earlier FABP4 example.

## Abstract

SLiPP Studio is a local desktop workbench for examining where a protein might accommodate a lipid and how individual lipid structures could occupy candidate pockets. Starting from PDB or mmCIF coordinates, the application combines fpocket cavity detection, the original SLiPP random-forest recipe, three-dimensional inspection, and pocket-directed docking with AutoDock Vina or Vinardo scoring. A bound ligand is not required. Users can inspect cavity shape and lining chemistry, select lipid structures from a small library or supply isomeric SMILES, and queue searches across selected pocket–lipid pairs. Returned poses, interaction geometry, preparation settings, and run provenance remain associated with the protein in a persistent workspace. For comparison within a protein, SLiPP outputs are divided by that protein’s largest raw score; raw outputs remain available, and docking energies retain their original units and ordering. The software integrates candidate generation, prioritization, and pose inspection while keeping their different interpretations explicit. This description documents the implemented workflow, a ligand-free BstB example, and the scope of available software checks. It does not establish prospective lipid-binding accuracy or experimental affinity prediction.

## Introduction

An unliganded protein structure presents two related questions: where could a lipid bind, and which molecular arrangements are compatible with a candidate site? Answering the first requires identifying and prioritizing cavities. Addressing the second requires specifying the lipid’s chemistry, generating poses, and examining its local environment. A pocket score alone cannot show whether a fatty-acid headgroup has a plausible anchor or whether a hydrocarbon chain encounters a steric obstruction.

SLiPP Studio organizes these tasks around the protein structure. Its main workspace places a structure library and pocket list beside a molecular view and a property inspector. Selecting a pocket connects its geometry, residues, descriptors, model output, docking history, and pose contacts. Users can move between proteins while retaining each analysis, or inspect all detected pockets in the same coordinate frame.

The scientific components retain distinct roles. fpocket generates cavity candidates and descriptors [1]; SLiPP supplies a lipid-oriented model score [2]; and AutoDock Vina samples and ranks ligand poses [3, 4]. Mol\* provides molecular rendering and chemical feature analysis [5]. Studio’s contribution is their integration into an inspectable, persistent workflow. The application currently executes the original binary SLiPP recipe, not the separate SLIPP++ ensemble described elsewhere in this repository.

**Figure 1. The implemented Studio workflow.**

1.  **Protein coordinates:** PDB or mmCIF; no bound lipid required.

2.  **Candidate pockets:** fpocket geometry; SLiPP prioritization.

3.  **Lipid screening:** library or SMILES; Vina or Vinardo.

4.  **Pose inspection:** contacts and clashes; saved run provenance.

Pocket discovery and ranking precede user-directed docking. Lipid chemistry and receptor preparation enter the screening stage. The molecular view links each result to its structural context; the workspace retains the coordinates, settings, and outputs. Relative SLiPP scores and docking scores remain separate.

## Protein to pocket workflow

### Structure acquisition and preparation

Coordinates can be opened from a local PDB or mmCIF file, browsed in a folder, or retrieved using a four-character PDB identifier or supported RCSB/PDBe entry link. Remote retrieval uses the RCSB mmCIF download endpoint. Individual structures are bounded to 20 MB. Folder navigation loads selected structures on demand, rather than parsing the entire collection before the user can begin.

Pocket detection operates on the first coordinate model. Gemmi resolves alternate conformations; the worker retains amino-acid residues from the selected chains and removes hydrogens and nonprotein residues. Author chain identifiers, sequence numbers, and insertion codes are mapped through fpocket’s legacy PDB input and restored in the returned pocket records. The mapping changes identifiers, not coordinates. The pipeline does not automatically expand biological assemblies; the user must supply the assembly or coordinate model appropriate to the biological question.

This protein-only discovery path allows an apo structure to be analyzed directly. Docking preparation is a separate operation: users can exclude chains, retain supported waters or ions, and assign supported residue templates. The prepared receptor can be inspected before a search. Nonprotein components removed during preparation are reported, so the displayed pose can be interpreted against the receptor actually used by the docking engine.

### Cavity detection and lipid-oriented ranking

Studio runs pinned fpocket 4.0 and imports its alpha spheres, lining residues, and descriptors. The three-dimensional overlay is built from the returned spheres. Selecting a candidate therefore highlights the detected cavity, rather than an illustrative marker at an approximate center. fpocket rank, volume, pocket score, and druggability remain separately inspectable.

The SLiPP worker uses the 17 selected features in the order specified by the original Dassama Lab implementation [6]. They describe cavity size, alpha-sphere geometry, hydrophobicity, polarity, charge, flexibility, and solvent-accessible surface properties. The retained upstream repository supplies training data and a training recipe rather than frozen fitted weights. Studio refits a 100-tree random forest with square-root feature subsampling, scikit-learn 1.8.0, and seed 2026, then caches the fitted model. Training-data and executable hashes are recorded with the analysis. The fixed seed is a Studio reproducibility choice; outputs are not claimed to reproduce every upstream unseeded fit.

The raw pocket score is the forest’s output for the lipid class. It is an uncalibrated model probability estimate, not a measured probability of binding and not a lipid-category assignment. Sorting uses this lipid-class output even below 0.5, avoiding the mistake of ranking a pocket by confidence in the non-lipid class. fpocket’s stochastic descriptor calculations can still vary between recomputations.

### Normalization within a protein

For raw score $s_i$ of pocket $i$, let $M$ be the largest available raw score among all scored pockets in the current protein analysis. Studio displays

$$
r_i=\begin{cases}s_i/M,&M>0,\\0,&M=0.\end{cases}

$$

Missing predictions remain missing. The denominator uses the full analysis, regardless of the selected pocket or docking target subset. Positive maxima become 1, ties remain ties, and all-zero sets stay zero. Because the transformation is monotonic for $M>0$, it preserves pocket ordering.

This scale expresses relative priority within one protein. A maximum of 1 is guaranteed whenever any raw score is positive; it does not establish a credible binding site. Values should not be compared across proteins as a common confidence scale. Selecting another pocket or changing docking targets does not change normalization, whereas recomputing the full candidate set can. The overview retains the raw score, the model inspector retains the original class outputs, and pocket CSV export includes both raw and relative scores. Stored predictions are not overwritten by the display transformation.

## Lipid screening and structural inspection

### Defining lipid chemistry and search regions

The starter library contains palmitic, oleic, stearic, and linoleic acids and stereospecified cholesterol, with source identifiers and SMILES retained in each run. The fatty-acid starters are neutral species. Users can add other lipids through isomeric SMILES, including an explicitly chosen charge state. The workflow does not enumerate pH-dependent states, tautomers, or stereoisomers.

RDKit validates a single molecular fragment, required stereocenter assignments, and the supported size and flexibility limits: 3–100 heavy atoms and at most 25 rotatable bonds. Seeded ETKDGv3 embedding generates a three-dimensional conformer, followed by MMFF minimization. Meeko prepares ligand atom types, charges, and torsions and prepares the rigid receptor using supported residue templates [7, 8]. Unsupported preparation fails explicitly.

Each search box encloses the pocket’s alpha spheres with 4 Å padding on each side and a minimum edge length of 16 Å. Boxes with an edge exceeding 48 Å are rejected rather than cropped. The box defines a search region, not a physical wall: a returned pose must still be examined in relation to the intended cavity and surrounding structure.

### Search and comparison

Users select one pocket, the five highest-ranked pockets, or a custom set, and queue up to 100 pocket–lipid pairs. AutoDock Vina 1.2.7 executes the search with either Vina or Vinardo scoring [4, 9]. Search-effort presets correspond to exhaustiveness 8, 32, and 96. These settings control search effort; they are not fixed counts of molecular permutations. The worker requests up to ten poses within the configured energy range.

The pocket–lipid matrix links each pair’s latest run to its poses and history. Vina and Vinardo results are separated by scoring selection, and mixed receptor or search settings are flagged. Each run snapshots lipid chemistry, pocket geometry, preparation, seed, and effort, so later interface changes do not rewrite an earlier experiment.

Docking outputs retain the engine’s pose order and scores in kcal/mol. The pose inspector also exposes the difference from the best returned score, reported RMSD bounds, and the engine’s energy components. Those RMSD bounds compare a pose with the best pose in the same run, not with an experimental structure. Docking scores are neither normalized with SLiPP nor combined into a composite confidence score. Molecular size and preparation can influence comparisons between different lipids; a lower docking score alone does not establish selectivity.

### Inspecting pocket anatomy and pose contacts

The Anatomy inspector links cavity shape, hydrophobic atoms, potential hydrogen-bond donors and acceptors, neighboring chains, and candidate openings to selectable three-dimensional features. Neighboring atoms are identified within 5 Å of the alpha-sphere envelope. The view supports examining plausible anchoring chemistry and cavity context before committing to a docking screen.

Opening markers use bounded straight-ray sampling from at most 128 sphere centers in 96 directions, with a 1.4 Å probe against protein van der Waals spheres. They are geometric access samples, not identified transport pathways or proof that a lipid can enter. Curved paths may be missed. Pose contacts are computed from Mol\* chemical features and interaction geometry, with explicit handling of docked ligands loaded as separate coordinate models. The contact inspector links interacting atoms and residues, reports distances, and provides a separate steric-overlap check. These displays assist structural interpretation; they are not an independent free-energy calculation.

## Implementation and persistence

The desktop application uses Tauri 2 and Rust for native operations, React and Zustand for interface state, and Mol\* for molecular visualization. Rust launches a scientific Python worker outside the interface thread. Python coordinates chemical preparation and inference; the docking search itself runs in the compiled Vina executable. The browser preview supports visualization and local workspace inspection but cannot launch these native scientific processes.

One scientific job runs at a time. Docking parallelism is delegated to Vina, with the native application reserving two logical cores where possible and capping search threads at twelve. Prepared receptors are cached by coordinate content, format, preparation policy, and Meeko version. Searches are not substituted with cached pose results. Cancellation terminates and reaps the active external search; a preparation library call may need to finish before cancellation is observed. Search timeouts bound fpocket to five minutes and docking to fifteen minutes.

Workspace autosave retains coordinates, pocket records, lipid definitions, preparation, queued and completed searches, and selected results in local IndexedDB. Interrupted jobs reopen as paused and require explicit resumption. Portable `.slipp` exports embed visited structures and their analyses; unvisited library files remain external dependencies. Imports merge documents instead of discarding the open workspace. Recomputing pockets after docking preserves the prior analysis as a separate document so that historical poses retain their original pocket context.

Users can export pocket CSV tables, SDF poses with run metadata, normalized project JSON, and images of the molecular view. Here, a normalized project JSON is the application’s standardized data schema; its stored model outputs remain raw. Relative pocket scores are derived from those outputs on display. The scientific runtime must be installed separately from the app bundle. Computation can then run locally without a backend service; structure downloads still require network access.

## Worked example and verification

### Ligand-free BstB from Dassama Lab

The reference is BstB (MCA1014), a bacterial sterol-binding protein characterized by Zhai and colleagues in Dassama Lab's *Novel sterol binding domains in bacteria* [11]. PDB entry 7T1M contains one protein chain, waters and chloride, with no bound sterol, at 1.60 Å resolution [10]. It therefore supports the intended protein-first workflow without removing a bound lipid to create an artificial apo input.

The deposited structure uses selenomethionine. Studio retains that original file and uses an explicitly labeled preparation in which nine MSE residues are converted to MET, with atom SE renamed SD and selenium replaced by sulfur. All atom positions and author residue identifiers are retained. No minimization or reconstruction of missing residues is performed. This preparation is compatible with the installed Meeko templates; it is not a new experimental native-methionine structure. Default pocket detection and docking exclude the waters and chloride.

The study detected binding to bacterial C-4 methylsterols, but no detectable BstB binding to cholesterol or lanosterol under its assay conditions [11]. This supplies a useful comparison for structure-guided exploration. Cholesterol in Studio's starter tray is a comparison compound, not an established BstB positive ligand; the paper's native sterols require explicitly specified chemistry. Its proposed sterol poses are computational models, so 7T1M supplies no experimental bound pose for a redocking RMSD control.

The bundled analysis contains 17 fpocket candidates scored with original SLiPP. Table 1 reports the saved outputs for the prepared copy. These computed scores are separate from the paper's experimental binding measurements.

| Pocket | Raw SLiPP | Relative SLiPP |
|:---|---:|---:|
| 01 | 0.460 | 1.000 |
| 14 | 0.170 | 0.370 |
| 10 | 0.120 | 0.261 |
| 05 | 0.090 | 0.196 |
| 02 | 0.080 | 0.174 |
| 16 | 0.060 | 0.130 |
| 09 | 0.040 | 0.087 |
| 03 | 0.020 | 0.043 |
| 12 | 0.020 | 0.043 |
| 15 | 0.020 | 0.043 |
| 17 | 0.020 | 0.043 |
| 04 | 0.010 | 0.022 |
| 06 | 0.010 | 0.022 |
| 11 | 0.010 | 0.022 |
| 07 | 0.000 | 0.000 |
| 08 | 0.000 | 0.000 |
| 13 | 0.000 | 0.000 |

**Table 1. Relative scores in the bundled BstB analysis.** The denominator is 0.460; relative values are rounded to three decimals. fpocket descriptors can vary between recomputations.

Users can inspect cavity shape and polar/hydrophobic lining, select pockets, and compare explicitly defined sterols through docking. A successful docking search demonstrates software compatibility, not binding or selectivity. No poses are prepopulated in the example. BstB was selected for its biological relevance and ligand-free structure; this example is not a held-out predictive benchmark or a reproduction of the publication's docking and molecular dynamics calculations.

### Scope of the software checks

Executable checks cover feature ordering and direct agreement with the fitted forest, author-residue mapping, invalid inputs, cancellation, workspace round trips, independent preparation state, queue transitions, and retention of run settings. The normalization checks cover positive maxima, tied maxima, missing predictions, all-zero sets, single-pocket analyses, and preservation of raw values. Viewer checks include pocket-overlay state and coordinated canvas resize and redraw.

A retained Vina redocking control used the upstream prepared 1IEP receptor and imatinib ligand, exhaustiveness 32, and seeds 2026–2028. Top-pose symmetry-corrected heavy-atom RMSDs were 0.373, 0.385, and 0.367 Å, measured in the receptor frame without alignment. The source inputs and numerical records are identified in the repository. This control checks an engine-and-pose-recovery path with upstream preparation; it does not validate Studio’s preparation for arbitrary proteins or lipid screening performance. For this BstB example revision, a separate cholesterol docking smoke check was run to verify preparation and pose generation; it is not a binding-validation experiment.

## Discussion

Studio supports a practical sequence of decisions: identify candidate cavities, compare their model support within the protein, inspect their chemistry, and test explicitly specified lipids through docking. Keeping geometry, raw model output, relative priority, and docking score separate allows the user to inspect why a candidate is interesting without treating several unrelated numbers as a single probability.

The present implementation has clear scientific limits. Candidate detection depends on the supplied protein conformation. Docking treats the receptor as rigid and does not model induced fit, membrane embedding, lipid aggregation, explicit solvent dynamics, or binding thermodynamics. Long, flexible lipids may be expensive to search or exceed the supported limits. Generic Vina or Vinardo scores do not establish metal coordination chemistry or the energetic effect of displaced waters. Relative normalization cannot repair poor model calibration or a missed cavity, and a lone scored pocket necessarily receives a relative value of 1 whenever its raw value is positive.

The application is therefore a workbench for developing and examining structural hypotheses. Evidence of improved lipid recognition would require an evaluation of the complete workflow on appropriately held-out targets and lipids, with pose recovery and screening performance assessed separately. Additional predictors, receptor-ensemble docking, and explicit lipid headgroup/tail analyses are not implemented in the version described here. Its current value is the ability to move from an unliganded protein to traceable pocket–lipid experiments within one local workspace.

## Software and evidence availability

The accompanying repository contains the application source, scientific worker, installation scripts, bundled coordinate examples, validation programs, and retained docking-control records. A public archival release for Studio is not established by this document. Original model data and recipe are available from the Dassama Lab SLiPP repository [6]. An accompanying implementation map identifies the local files supporting this description and the source used to typeset it.

## References

1.  Le Guilloux V, Schmidtke P, Tuffery P. Fpocket: An open source platform for ligand pocket detection. *BMC Bioinformatics*. 2009;10:168. [doi:10.1186/1471-2105-10-168](https://doi.org/10.1186/1471-2105-10-168).

2.  Chou JC-C, Chatterjee P, Decosto CM, Dassama LMK. A Machine Learning Model for the Proteome-Wide Prediction of Lipid-Interacting Proteins. *J Chem Inf Model*. 2025;65:9623–9638. [doi:10.1021/acs.jcim.5c01076](https://doi.org/10.1021/acs.jcim.5c01076).

3.  Trott O, Olson AJ. AutoDock Vina: improving the speed and accuracy of docking with a new scoring function, efficient optimization, and multithreading. *J Comput Chem*. 2010;31:455–461. [doi:10.1002/jcc.21334](https://doi.org/10.1002/jcc.21334).

4.  Eberhardt J, Santos-Martins D, Tillack AF, Forli S. AutoDock Vina 1.2.0: New Docking Methods, Expanded Force Field, and Python Bindings. *J Chem Inf Model*. 2021;61:3891–3898. [doi:10.1021/acs.jcim.1c00203](https://doi.org/10.1021/acs.jcim.1c00203).

5.  Sehnal D, Bittrich S, Deshpande M, et al. Mol\* Viewer: modern web app for 3D visualization and analysis of large biomolecular structures. *Nucleic Acids Res*. 2021;49:W431–W437. [doi:10.1093/nar/gkab314](https://doi.org/10.1093/nar/gkab314).

6.  Dassama Lab. SLiPP_2024. Source and training data, revision `944b3700ace6`. <https://github.com/dassamalab/SLiPP_2024>.

7.  RDKit. Open-source cheminformatics. Documentation and source. <https://www.rdkit.org/docs/>. Studio runtime version 2026.3.6.

8.  Meeko. Ligand and receptor preparation documentation. <https://meeko.readthedocs.io/>. Studio runtime version 0.8.0.

9.  Quiroga R, Villarreal MA. Vinardo: A Scoring Function Based on Autodock Vina Improves Scoring, Docking, and Virtual Screening. *PLoS ONE*. 2016;11:e0155183. [doi:10.1371/journal.pone.0155183](https://doi.org/10.1371/journal.pone.0155183).

10. RCSB Protein Data Bank. Entry 7T1M, crystal structure of a bacterial sterol transporter. [Structure record](https://www.rcsb.org/structure/7T1M). [doi:10.2210/pdb7T1M/pdb](https://doi.org/10.2210/pdb7T1M/pdb).

11. Zhai L, Bonds AC, Smith CA, Oo H, Chou JC-C, Welander PV, Dassama LMK. Novel sterol binding domains in bacteria. *eLife*. 2024;12:RP90696. [doi:10.7554/eLife.90696](https://doi.org/10.7554/eLife.90696).

## Appendix A — Implemented feature inventory

This inventory records user-facing capabilities present in Studio 0.1. Native scientific operations require the separately installed runtime. Source inspection establishes implementation coverage; it does not mean that every feature has been revalidated experimentally or tested on every platform. The accompanying feature checklist maps each entry to its implementation.

### Structure management and molecular inspection

| **Feature group** | **Implemented behavior and scope** |
|:---|:---|
| A01 — Home | Interactive apo BstB reference (7T1M; MSE→MET prepared copy); file and folder entry points; PDB/workspace import dialog; searchable, paginated saved analyses with pocket and run counts; resume analysis; return Home without deleting results. |
| A02 — Structure input | Open PDB/ENT, CIF/mmCIF, or a standardized Studio JSON project; retrieve a four-character PDB ID or supported HTTPS RCSB/PDBe link; optionally detect and rank pockets after download. Raw imports may be inspected before inference. |
| A03 — Folder library | Recursive folder browsing, filename filtering, arrow-key and Home/End navigation, on-selection coordinate loading, virtualized rows, and previews of visited structures. Native scans skip symlinks and support up to 10,000 structures; up to 100 thumbnails are cached in the current interface session. |
| A04 — Saved structures | Search by protein name or PDB ID in the structure switcher; view format, pocket count, and completed-docking count. Switching retains each document’s preparation and run history. |
| A05 — Workspace layout | Light default and dark-mode toggle; draggable navigator and inspector dividers; persisted pane widths, keyboard resizing, and double-click reset. The central molecular view retains a minimum width. Theme choice is session state. |
| A06 — Molecular view | Rotate, pan, zoom, reset camera, and focus a pocket; double-click a pocket for tighter framing. Independent cartoon, protein surface, cavity geometry, lining-residue, and input-ligand controls. All-pocket overlay preserves selected-pocket emphasis. |
| A07 — Inspection visibility | Pocket envelopes become more transparent during docking, contact inspection, and atom-oriented anatomy inspection. Docked-pose visibility is controlled separately from input ligands. Contacts provides a section-depth clipping control and reset. |
| A08 — Pocket navigation | Sort by relative SLiPP, fpocket rank, or volume; keyboard selection; show pocket and residue counts. Overview exposes fpocket volume, score, druggability, mean sphere radius, structure source, and prediction state. |
| A09 — Features and residues | Raw feature values with supplied units; complete pocket-lining residue table with author chain, position, and insertion code. Hover or keyboard focus highlights a residue; clicking focuses it in 3D. Feature values are not attribution scores. |
| A10 — Anatomy | Select shape, hydrophobic lining, polar anchors, candidate openings, or neighboring chains. Inspect axis-aligned envelope dimensions, atom/residue counts, donor/acceptor legend, clear/tested rays, and probe radius. Filter neighboring chains and isolate a residue’s markers. |
| A11 — Contacts | Choose an input ligand or current docked pose; use original or prepared receptor context accordingly. Toggle contact lines, filter by interaction type, inspect contact counts, atom names, distances and steric overlaps, hover residues, and focus contact endpoints. A selectable radial map shows up to 12 contacted residues; the full list remains available. |
| A12 — Atom measurements | Click atoms to inspect identity, element, formal charge, occupancy, and coordinates. Measurement mode reports pair distances for two/three picked atoms and the three-atom angle; clear picks resets the selection. These are coordinate measurements, not energy estimates. |
| A13 — Presentation | Presentation mode and camera reset; searchable command palette for navigation, reference loading, view toggles, pocket focus, and exports. Shortcuts include Ctrl/Cmd+K, Ctrl/Cmd+O, P, R, and Escape; inspector tabs and pocket lists support arrow keys. |

## Appendix A — Computation and analysis records

| **Feature group** | **Implemented behavior and scope** |
|:---|:---|
| A14 — Pocket inference | Local fpocket detection plus original binary SLiPP recipe; detect or recompute without a bound ligand. First-model protein preparation respects excluded chains and restores author residue identifiers. Geometry, descriptors, model version, training-data and executable hashes accompany the output. |
| A15 — Model controls | Separate docking, pocket-detector, and lipid-binding-model selectors. Vina/Vinardo selection is shared with Docking. fpocket and original SLiPP are the sole installed detector and predictor choices; the selectors do not imply additional integrated engines. Raw class outputs and calibration/provenance details remain inspectable. |
| A16 — Relative scores | Raw score divided by the full protein analysis’s largest raw score; ties preserved, all-zero sets remain zero, missing predictions remain absent. List, overview, command hints, target list, and matrix use the relative scale. Raw values remain available; CSV includes both values. |
| A17 — Receptor editing | Include/exclude protein chains; search hetero residues, focus them in 3D, and retain supported waters/ions. Explicit HIS, ASP, GLU, and LYS template overrides; prepare-and-preview toggle; retained/removed residue and atom counts; undo and reset settings. Unsupported cofactors stay excluded; missing sequence segments are not rebuilt. |
| A18 — Lipid definitions | Five named starter lipids with source links; multi-selection; add a named custom isomeric SMILES to the tray. Chemical validation, seeded conformer generation, MMFF minimization, and Meeko preparation precede docking. Each run retains its lipid definition. |
| A19 — Screening setup | Choose current, top five, all, or custom pockets and selected lipids; queue up to 100 pairs. Vina or Vinardo scoring, three exhaustiveness presets, editable seed, automatic pocket-derived search box, and a direct route to receptor preparation. |
| A20 — Job control | Serial pair queue with native Vina threading; stop active search and pause remaining jobs; resume paused jobs; retry a failed or canceled run as a new record. Errors remain with failed runs while other queued pairs can continue. Scientific jobs have bounded runtimes and receptor preparation caching. |
| A21 — Results and poses | Expandable pocket–lipid matrix, scoring-function separation, mixed-protocol notice, completion/pending/failure counts, and run-history selection. Inspect up to ten poses, visibility, native scores, score differences, RMSD bounds, and intermolecular/intramolecular/unbound terms. |
| A22 — Run provenance | Inspect engine/scoring, seed, exhaustiveness, CPU count, elapsed/preparation/search times, search-box center and dimensions, cache status, preparation choices, and warnings. Queued requests snapshot settings; recomputing pockets after docking preserves the previous analysis. |
| A23 — Persistence | Local autosave, explicit save-error state, paused recovery of interrupted jobs, portable workspace export, and validated merge import. Visited coordinates/results are embedded; unvisited library files may need re-selection. A failed workspace restore pauses autosave to preserve existing stored data. |
| A24 — Exports | Molecular-view PNG; pocket CSV with raw/relative SLiPP, fpocket values and model version; standardized project JSON; docked-pose SDF with chemistry and run metadata; portable `.slipp` workspace. Native export writes through a temporary file before replacing the destination. |

### Capabilities not present in this version

The feature inventory does not claim SLIPP++ inference, alternative pocket detectors, predictor ensembling, arbitrary model installation, calibrated binding probabilities, automated lipid-category prediction, pH/tautomer enumeration, protein rebuilding, flexible-receptor or ensemble docking, membrane simulation, tunnel solving, quantitative headgroup/tail-fit analysis, synchronized dual-pose or apo/holo comparison, residue attribution heatmaps, per-pocket notes, in-app paper/report generation, cloud execution, or multi-user collaboration. File-picker import is implemented; direct drag-and-drop import is not. The downloadable software paper is a separate document artifact, not an application report-export feature.
