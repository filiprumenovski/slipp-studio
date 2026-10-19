# SaProt–EGNN asymmetric fold 2

The **Model → Lipid-binding model** selector supports the original SLiPP random forest and the registered SaProt–EGNN checkpoint. Selection applies to the next **Detect / Recompute pockets** action, including automatic analysis after a PDB download. The model named under “Displayed results” identifies the existing analysis; changing the selector alone does not relabel it. Recomputing preserves an existing scored analysis or docking history as a separate saved document.

## Local setup

Run from the Studio repository, using the existing science checkout and the requested checkpoint:

```sh
sh scripts/setup-geometric.sh /path/to/slipp-science /path/to/residue_cavity_multitask_fold2.pt
```

UV installs the science checkout's locked Python 3.11 deep/train dependencies in its own `.venv`. Studio's original scientific runtime remains separate. Git, CMake and a C++ compiler are required to build Foldseek at the training commit `21952ed84e0f4a06ec6af08d58add77cef8dec14`; an existing executable can instead be supplied as the third argument. A different Foldseek version is explicitly recorded in result provenance.

The checkout must retain `data/models/saprot_35m_af2`, the `residue_cavity_v2/metadata.json` graph contract, and the original `residue_cavity_v1/saprot_35m/metadata.json` pooling metadata. Setup verifies encoder provenance, feature order, taxonomy and checkpoint shapes, then records file hashes in the application's `geometric-runtime.json`. It registers local paths; it does not embed research weights into the app. Moving or changing registered files requires running setup again. No network access is needed for inference after setup.

## What runs

The supported checkpoint is `multitask_saprot_egnn_asymmetric_taxonomymigrated_fullcv/residue_cavity_multitask_fold2.pt`, SHA256 `2aa1ab8c7d3aac3178b9a8332ba82018564aef4ed61a16447098cca6f463cc0b`. It is a **single fold-2 component**, seed 44, not the five-fold or four-view ensemble. No ensemble metrics are attributed to it.

Studio generates candidates with fpocket, retains its author-residue mapping, and passes the protein-only coordinates and identical cavity geometry to the science repository's existing feature builders. Inputs are 146 ordered descriptors, up to 48 lining-residue nodes and 48 farthest-point sampled cavity nodes, and frozen SaProt-35M mean/max pooling over mapped lining residues. Graph coordinates and pooled embeddings retain the float16 quantization used in training caches before float32 CPU inference. Missing graph or entirely missing pocket-embedding coverage fails the operation; no random forest fallback or fabricated scores are returned. Per-pocket embedding coverage is recorded in provenance.

The binary sigmoid head provides the raw pocket score. Its within-protein relative display remains raw divided by the maximum raw value in that analysis. Eight independent sigmoid outputs are displayed separately as conditional lipid-class scores. They are neither mutually exclusive nor normalized to sum to one. No class threshold, Platt calibration, experimental affinity, or calibrated binding probability is inferred. The canonical taxonomy is checked against checkpoint metadata before inference.

JSON and workspace exports retain both heads. Pocket CSV retains the legacy binary-score columns and adds `model_name` and eight `lipid_class_*` columns. The Model tab reports the active result's version and provenance independently of the predictor selected for the next run.

## Execution and checks

The native job launches a separate UV-managed Python worker. CPU threads are bounded at eight and EGNN batches at 32 pockets. SaProt runs per structure chain, using the upstream overlapping-window routine; aligned chain embeddings are cached by protein coordinates, registered source/weight hashes and the Studio adapter hash. Candidate scores are recomputed, not replaced by cached predictions. Cancellation kills the geometric worker process group, including Foldseek, and inference has a 15-minute timeout.

```sh
.venv-docking/bin/python scripts/check-geometric.py
npm run test:inference
npm run test:workspace
npm test
```

The geometric integration check runs real inference on apo FABP4 after changing author chain IDs and insertion codes, verifies all 146 descriptors and eight canonical class outputs, compares cached and uncached scores exactly, and exercises cancellation and unsupported-model rejection. Workspace/native schema checks verify that independent class scores survive round trips and invalid class maps are rejected. These are integration checks, not new predictive-performance validation.

Sources: the local `slipp-science` checkpoint and implementation; [SaProt-35M release](https://huggingface.co/westlake-repl/SaProt_35M_AF2); [Foldseek source](https://github.com/steineggerlab/foldseek/tree/21952ed84e0f4a06ec6af08d58add77cef8dec14).
