# Studio feature coverage audit

Audited 27 September 2026 against the current application source. All 24 groups below are now explicitly listed in Appendix A of the software paper. This is a documentation coverage audit, not a claim that every feature has passed a new end-to-end test. No application behavior was changed in this revision.

| Appendix ID | Feature group | Source of implementation |
| --- | --- | --- |
| A01 | Home, interactive reference, saved-analysis search/pagination/resume, return Home | [Home](../../src/Home.tsx), [App](../../src/App.tsx) |
| A02 | Structure/project import, PDB/link retrieval, optional inference after download | [Workflow controls](../../src/WorkflowControls.tsx), [Structure library](../../src/StructureLibrary.tsx), [Native project loading](../../src-tauri/src/project.rs) |
| A03 | Recursive folder rail, filter, keyboard navigation, virtualization and thumbnails | [Structure library](../../src/StructureLibrary.tsx), [Native folder scan](../../src-tauri/src/project.rs) |
| A04 | Searchable saved-structure picker and retained analysis state | [Picker](../../src/StructurePicker.tsx), [Workspace](../../src/workspace.ts) |
| A05 | Light/dark mode, draggable/persisted pane widths and keyboard resize | [Pane divider](../../src/PaneDivider.tsx), [App](../../src/App.tsx), [View state](../../src/store.ts) |
| A06 | Camera controls, individual representations, selected/all pocket overlays | [Viewer controller](../../src/molstar/MolstarController.ts), [App](../../src/App.tsx) |
| A07 | Contextual pocket opacity, separate pose visibility, section clipping | [Viewer controller](../../src/molstar/MolstarController.ts), [Contacts](../../src/ContactsPanel.tsx), [Docking](../../src/DockingPanel.tsx) |
| A08 | Pocket sorting, navigation, overview descriptors and missing-output state | [App](../../src/App.tsx) |
| A09 | Raw feature values, full lining-residue table and linked highlighting | [App](../../src/App.tsx) |
| A10 | Shape, hydrophobic/polar atoms, openings and neighboring chain inspection | [Anatomy panel](../../src/AnatomyPanel.tsx), [Anatomy calculations](../../src/molstar/anatomy.ts) |
| A11 | Ligand target, filtered contacts, geometry criteria, linked 12-residue map | [Contacts panel](../../src/ContactsPanel.tsx), [Contacts analysis](../../src/molstar/contacts.ts) |
| A12 | Atom identity/chemistry/coordinates, two-atom distances, three-atom angle | [Contacts panel](../../src/ContactsPanel.tsx), [Atom-pick subscription](../../src/molstar/MolstarController.ts) |
| A13 | Presentation, commands and keyboard controls | [App](../../src/App.tsx), [View state](../../src/store.ts) |
| A14 | Native fpocket and original SLiPP inference, feature order and provenance | [Inference](../../scripts/inference/run.py), [Model provenance](../../scripts/inference/model/README.md) |
| A15 | Docking/detector/predictor selectors and raw model details; subsequent SaProt–EGNN fold-2 integration | [App](../../src/App.tsx), [Shared view state](../../src/store.ts), [Geometric worker](../../scripts/inference/geometric.py), [Integration notes](../geometric-model.md) |
| A16 | Protein-relative scores, edge cases, raw score preservation and export | [Normalization](../../src/pocketScores.ts), [App](../../src/App.tsx), [Docking](../../src/DockingPanel.tsx) |
| A17 | Receptor chains, supported hetero residues, templates, preview, undo/reset | [Preparation](../../src/PreparationPanel.tsx), [Worker](../../scripts/docking/run.py) |
| A18 | Starter library, source links, custom SMILES and chemical preparation | [Lipid definitions](../../src/data/lipids.json), [Docking](../../src/DockingPanel.tsx), [Worker](../../scripts/docking/run.py) |
| A19 | Pocket/lipid target sets, pair limit, scoring, seed, effort and search box | [Docking](../../src/DockingPanel.tsx), [Worker](../../scripts/docking/run.py) |
| A20 | Serial queue, stop/pause/resume/retry, errors, CPU policy, timeout/cache | [Workspace queue](../../src/workspace.ts), [Docking](../../src/DockingPanel.tsx), [Native job runner](../../src-tauri/src/docking.rs), [Worker](../../scripts/docking/run.py) |
| A21 | Expandable matrix, protocol warning, status/history and pose outputs | [Docking](../../src/DockingPanel.tsx) |
| A22 | Run parameters, chemistry/geometry snapshots and prior-analysis retention | [Docking](../../src/DockingPanel.tsx), [Workspace](../../src/workspace.ts), [Reanalysis](../../src/WorkflowControls.tsx) |
| A23 | Autosave, paused recovery, validated merge, portability and save errors | [Workspace](../../src/workspace.ts), [Import/export](../../src/WorkflowControls.tsx) |
| A24 | PNG, CSV, JSON, SDF and workspace export with native atomic write | [App](../../src/App.tsx), [Docking](../../src/DockingPanel.tsx), [Workflow controls](../../src/WorkflowControls.tsx), [Native exports](../../src-tauri/src/lib.rs) |

## What was missing from the original paper

The narrative already covered detection, inference, normalization, docking, anatomy, local execution, persistence and primary exports. The appendix makes the previously omitted or underspecified features explicit: atom inspection and measurements; section clipping; the radial residue contact map and its 12-residue limit; contact filters and line visibility; preparation undo/reset and exact editable residue families; home and saved-structure search; library previews and keyboard navigation; resizable panes; all representation toggles and contextual opacity; keyboard shortcuts and presentation; retry/resume behavior; selector availability; and export scope.

## Explicit scope exclusions

The PDF appendix describes the original-SLiPP snapshot. A subsequent revision adds the registered SaProt–EGNN asymmetric fold-2 component and eight class scores; see [integration notes](../geometric-model.md). It does not add the full SLiPP++ ensemble or a model-plugin system. Candidate opening samples are not a tunnel solver; contact inspection is not a quantitative headgroup/tail-fit score; the comparison grid is not a dual-view pose comparator; source-level scientific checks are not prospective validation; and this external PDF is not an in-app report generator.

The original build brief is historical product context, not an assertion that all proposed features shipped. Requested defaults and subsequent implementation supersede its earlier dark-mode, precomputed-only and model assumptions.
