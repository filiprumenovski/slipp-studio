# SLiPP Studio

A local Tauri 2 app. Rust reads and validates a versioned `studio.json` plus its relative PDB/mmCIF file. The structure is transferred once with the normalized DTO. React renders that contract; the MolstarController alone owns molecular state and representations. Zustand holds small presentation/selection state.

Build order: validated project + real demo → native viewer and pocket selection → geometry/residues/ligands → polished inspector and commands → cold-launch recording checks.

No inference runs inside V1. Missing predictions stay missing. Model probabilities retain their class names, source version and calibration status. The repo is new; SLiPP-Plus is being inspected as a data source, not copied wholesale into the application.

References: https://v2.tauri.app/develop/resources/ and https://molstar.org/docs/plugin/selections/.

Local docking is a separate native computation path: `DockingPanel` → Tauri `run_docking` → background Rust task → pinned Python chemistry preparation → compiled Vina executable. The result contains SDF poses and provenance; MolstarController adds the selected pose without reloading the protein. One active job, cancellation markers, a receptor preparation cache and bounded inputs keep this local workflow simple. See [docking](docking.md). This does not add SLiPP++ model inference.
