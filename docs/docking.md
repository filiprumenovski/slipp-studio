# Local molecular docking

Select a pocket, open **Docking**, paste an isomeric SMILES string, and choose search effort. The native app generates a 3D ligand, prepares a rigid protein receptor, runs AutoDock Vina, and displays up to ten ranked poses. Clicking a pose changes the purple ligand in the existing coordinate frame. The **Ligands** toolbar button controls crystallographic ligands; **Show selected pose** independently controls the docking result.

## Runtime

```sh
./scripts/setup-docking.sh
npm run tauri build
```

The installer needs `uv` and `curl`. It creates a Python 3.12 environment with pinned RDKit, Meeko, Gemmi, NumPy and SciPy, and downloads the official Vina 1.2.7 executable for the host platform. It records the Python location in the app data directory. `SLIPP_DOCKING_PYTHON` overrides that path. The app bundles its worker script, not the scientific runtime; another machine needs its own installation. Docking works offline after installation. Browser preview cannot launch local processes.

## Method

- RDKit validates a single organic molecule, explicit stereocenters, 3–100 heavy atoms and at most 25 rotatable bonds. ETKDGv3 generates a seeded conformer; MMFF minimizes it. Unsupported chemistry fails with an error.
- Meeko assigns ligand atom types, charges and torsions. Gemmi retains the first receptor model and resolves alternate conformations. Meeko uses residue templates and rejects unpreparable protein chemistry. Modified amino acids such as TPO and SEP are retained when supported.
- The initial receptor policy includes amino acids only. Waters, ions, non-amino-acid cofactors and existing small-molecule ligands are excluded and listed in the output. This is especially consequential for metal-dependent binding sites, including the bundled ATP complex; these exploratory results are not a validated biological binding prediction.
- The search box encloses the actual fpocket alpha spheres with 4 Å padding and a 16 Å minimum edge. Boxes exceeding 48 Å are rejected rather than silently cropped.
- Vina's compiled search varies translation, orientation and rotatable bonds using its empirical scoring function and local optimization. Standard, Thorough and Extended correspond to exhaustiveness 8, 32 and 96. This is rigid-receptor, noncovalent docking; receptor dynamics, explicit solvent and covalent chemistry are not simulated.
- Formal charges and stereochemistry are taken from input. There is no pH, tautomer or stereoisomer enumeration. Inspect and prepare these states before making comparisons.

Scores are approximate energies in kcal/mol, not calibrated binding probabilities or measured affinities. RMSD bounds compare each pose with the best pose from the same run, not a crystal reference. Repeated seeds characterize search variability, not experimental uncertainty. Docking remains independent of SLiPP++ class probabilities.

## Performance and cancellation

Vina owns the hot loop in its native ARM64/x86 executable. A background Rust task runs the worker outside the UI thread. The app runs one job at a time, reserves two logical cores for the OS/viewer, and caps Vina at twelve threads. Protein preparation is cached by coordinate content, format, preparation policy and Meeko version. Search outcomes are never cached or fabricated.

Cancel requests are checked before search and every 100 ms during search; the Vina child is killed and reaped. Closing the native window also requests cancellation. Preparation finishes its current library call before noticing cancellation. A 15-minute search limit bounds jobs. The UI keeps displaying the molecular view while the process runs.

SDF export preserves bonds and pose coordinates through Meeko's atom mapping. Each record includes score, rank, input SMILES, receptor coordinate hash, preparation versions, seed, CPU count, box, search effort, timing and assumptions. The workflow keeps the last result in memory; export it before closing or loading another project.

## Checks

```sh
npm test
.venv-docking/bin/python scripts/check-docking.py
.venv-docking/bin/python scripts/check-docking.py --benchmark
```

The worker check covers a real Vina search, chemical identity after SDF round-trip, search-box bounds, fixed-seed reproducibility, receptor cache reuse, invalid SMILES, fragments, unspecified chirality and cancellation. The benchmark records three seeds at each search effort for caffeine and palmitic acid against 1ATP pocket-01. Timings include worker startup and are machine-specific; the current measurements use an Apple M4 and four worker threads. The ligands are computational examples, not validated binders. Raw measurements are in `docking-benchmark.json`.

References: [AutoDock Vina](https://autodock-vina.readthedocs.io/en/latest/), [search API](https://autodock-vina.readthedocs.io/en/stable/vina.html), [Meeko ligand preparation](https://meeko.readthedocs.io/en/develop/lig_overview.html), [receptor chemistry](https://meeko.readthedocs.io/en/develop/rec_overview.html), [pose export](https://meeko.readthedocs.io/en/develop/export_usage.html).

## Ranking interpretation

Studio preserves Vina's native ordering. It now exposes Δ score relative to the best returned pose, RMSD bounds relative to that pose, and Vina's reported intermolecular, intramolecular and unbound-reference terms. The components are not a decomposition into experimentally measured energies, and the raw terms do not simply sum to the final score without the conformation correction. The intramolecular term is not a separately calculated MMFF strain energy. A 0.1 kcal/mol score difference should not be presented as statistical significance.

Vina uses empirical steric, hydrophobic and hydrogen-bond terms with a conformational correction. Its standard scoring function is not an explicit-solvent molecular-mechanics simulation, and does not provide a standalone Coulomb electrostatics term. Preserving chemically appropriate protonation and cofactors is a separate preparation problem, not something a low score proves correct. See [Trott and Olson's original scoring/search description](https://pmc.ncbi.nlm.nih.gov/articles/PMC3041641/).

For a control, `scripts/check-docking-reference.py` redocks the upstream 1IEP imatinib example at exhaustiveness 32 across three seeds, comparing recovered poses with the crystallographic ligand using symmetry-corrected heavy-atom RMSD in the receptor coordinate frame, without alignment. This specifically tests Vina with upstream prepared inputs; it does not validate Studio preparation for arbitrary receptors or establish virtual-screening performance. [The upstream tutorial](https://autodock-vina.readthedocs.io/en/stable/docking_basic.html) explains why this flexible ligand needs more search effort.

A broader ranking validation needs multiple target families, crystal-pose recovery, stereochemical and clash checks, and held-out active/decoy enrichment. These are distinct from score reproducibility. No confidence percentage or custom weighted composite rank is generated by this build.

The 1IEP control passed in all three runs: top-pose heavy-atom RMSDs were **0.373, 0.385 and 0.367 Å**. Raw score/rank/RMSD records are in `docking-reference-check.json`. These results use the upstream prepared complex and should not be extrapolated to the simplified protein-only preparation of the bundled 1ATP project.
