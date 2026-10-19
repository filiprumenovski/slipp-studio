# SLiPP Studio software description

[Original PDF snapshot](../../output/pdf/SLiPP-Studio-software-paper.pdf) · [Editable LaTeX](main.tex) · [Markdown with revised BstB example](SLiPP-Studio-software-paper.md)

The Markdown edition and app reference now use apo BstB (7T1M) from Dassama Lab, with an explicitly documented MSE-to-MET prepared copy and freshly computed fpocket/SLiPP results. The original PDF/LaTeX retain FABP4; that exact fixture is archived under `demo/fabp4-reference/`. The PDF is the original-SLiPP implementation snapshot. The subsequent SaProt–EGNN asymmetric fold-2 integration is described in [its implementation notes](../geometric-model.md) and the updated feature checklist; the PDF does not yet describe this addition.

Six-page software description of the implemented Studio 0.1 workflow, dated 27 September 2026. The four-page, two-column narrative includes an abstract, workflow figure, normalization equation, real bundled FABP4 example, implementation, verification scope, limitations, and ten references. A two-page appendix inventories 24 feature groups, with a [source-linked checklist](feature-checklist.md) for verification. This is distinct from the SLIPP++ archived-experiment manuscript maintained separately; no SLIPP++ performance result is attributed to Studio.

No authorship, affiliation, submission, or public software-release claim is added. The retained 1IEP control is identified as historical and uses upstream prepared inputs. No new scientific inference or docking was run for this document. The 1LIB table comes from the bundled fixture, not a user's subsequently recomputed analysis.

## Rebuild

From the repository root, with pdfLaTeX installed:

```sh
mkdir -p tmp/pdfs/studio-paper output/pdf
pdflatex -interaction=nonstopmode -halt-on-error -output-directory=tmp/pdfs/studio-paper -jobname=SLiPP-Studio-software-paper docs/studio-paper/main.tex
pdflatex -interaction=nonstopmode -halt-on-error -output-directory=tmp/pdfs/studio-paper -jobname=SLiPP-Studio-software-paper docs/studio-paper/main.tex
cp tmp/pdfs/studio-paper/SLiPP-Studio-software-paper.pdf output/pdf/SLiPP-Studio-software-paper.pdf
```

The bibliography and vector workflow figure are embedded in `main.tex`; the feature appendix is in [features.tex](features.tex). No external images, BibTeX step, model execution, or network connection is needed. Inspect the PDF after changing prose; the final bibliography starts a new column deliberately. The delivered version was rendered and all six pages visually inspected, with no undefined references or overflowing boxes in the final compile log.

## Implementation map

| Subject | Implementation or retained evidence |
| --- | --- |
| Acquisition, analysis orchestration and exports | `src/WorkflowControls.tsx`, `src/StructureLibrary.tsx`, `src/App.tsx`, `src-tauri/src/lib.rs` |
| Protein preparation, fpocket and original SLiPP | `scripts/inference/run.py`, `scripts/inference/model/README.md`, `scripts/setup-science.sh` |
| Relative normalization | `src/pocketScores.ts`, `src/App.tsx`, `src/DockingPanel.tsx` |
| Docking preparation, search and output | `scripts/docking/run.py`, `scripts/docking/requirements.txt`, `src-tauri/src/docking.rs` |
| Anatomy and contacts | `src/molstar/anatomy.ts`, `src/molstar/contacts.ts`, `src/molstar/MolstarController.ts` |
| Run snapshots, autosave and interrupted jobs | `src/workspace.ts` |
| Original PDF FABP4 worked example | `demo/fabp4-reference/studio.json`, `demo/fabp4-reference/structure.pdb`, `demo/fabp4-reference/README.md` |
| Revised Markdown BstB worked example | `demo/lipid-reference/studio.json`, `demo/lipid-reference/structure.pdb`, `demo/lipid-reference/README.md` |
| Historical redocking control | `docs/docking-reference-check.json`, `scripts/check-docking-reference.py` |
| Executable verification scope | `scripts/check-inference.py`, `scripts/check-workspace.ts`, `scripts/check-view-options.mjs`, `scripts/check-contacts.ts`, `scripts/check-anatomy.ts` |

The source implementation takes precedence over older architecture/docking notes that describe an earlier application state. External references cite the component papers, official model repository, official preparation documentation, and RCSB structure record. They do not establish Studio-specific validation.

## Normalization and prior implementation verification

Relative score is raw score divided by the maximum raw score across all scored pockets in the active protein analysis. All-zero sets remain zero and absent predictions remain absent. The raw `prediction.probability` and class outputs are unchanged in persisted JSON; CSV retains `slipp_score` and adds `slipp_relative_score`. Selection, sorting and docking target subsets do not redefine the denominator. Vina/Vinardo energies are unchanged.

Executed successfully: `node --experimental-strip-types scripts/check-view-options.mjs`, `npm run test:workspace`, TypeScript checking and the native release build. Native UI verification covered pocket list, overview, docking target list and matrix. A native CSV export was parsed independently to confirm all six exported relative scores equal raw/max and the leading raw value remains 0.06. Older scientific controls were inspected, not rerun.

The subsequent feature-inventory revision audited the source for the 24 groups in the appendix and added documentation only. It did not rerun application tests or scientific jobs. Source coverage is not a claim of fresh end-to-end, experimental, or cross-platform validation.
