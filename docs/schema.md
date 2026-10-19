# Project schema v1

A bundle is a directory containing `studio.json` and the structure file named by `structure.path`. The complete reference is `demo/canonical-project/studio.json`; Rust's types in `src-tauri/src/project.rs` are the authoritative contract.

- `schemaVersion`: exactly 1.
- `id`, `name`, `description`, `provenance`: project identity and source information.
- `structure`: `id`, relative `path`, `format` (`pdb` or `mmcif`), and `source`.
- `model`: `name`, nullable `version`, `classes`, `calibration` (preserve unknown as "Not supplied").
- `pockets`: unique nonempty `id`, unique positive `rank`, finite XYZ `center` in Å, `residues`, `fpocket` descriptor map, nullable `prediction`, `features`, and `geometry.alphaSpheres`.
- Each residue uses author `chain`, integer `seq`, `insertionCode` (empty when absent), and `name`. References must resolve in the first model. Alternative conformations share residue identity.
- Each alpha sphere preserves its finite XYZ `center` and positive `radius` in Å.
- Each feature preserves `name`, finite `value` and nullable `unit`. Unknown units remain null.
- A prediction has a known class `label`, finite `probability` in [0,1], and `probabilities` (either empty or a complete class vector summing to 1 within 0.001). The selected class value must agree with `probability`. Predictions require a model version.
- Optional `prediction.lipidClasses` contains `taxonomyVersion: "biodolphin_unique_values_to_canonical_v1"` and a `scores` map with exactly `FattyAcyls`, `Glycerolipids`, `Glycerophospholipids`, `Sphingolipids`, `SterolLipids`, `PrenolLipids`, `Saccharolipids`, and `Polyketides`. Each is finite and in [0,1]. These conditional multilabel scores do **not** sum to one; the binary `probability` remains the pocket-ranking score. Older projects omit this field.

Missing values must be omitted or null where permitted, never replaced with zero. fpocket descriptor names are preserved; the overview recognizes `Volume`, `Score`, `Druggability Score`, and `Mean alpha sphere radius`. All other descriptors remain inspectable in Features.

Structure paths cannot be absolute, traverse parents, or resolve via a symlink outside the bundle. The structure text crosses the native bridge once per project load. JSON export contains the normalized project DTO; keep the referenced structure alongside it to reopen it.

No thresholds, calibration, per-residue importance or feature attribution are inferred by the viewer.
