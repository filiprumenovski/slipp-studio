# BstB reference · PDB 7T1M

BstB (MCA1014), a bacterial sterol-binding protein from *Methylococcus capsulatus*, is the Home and Open reference example. It is a protein from Dassama Lab's [Zhai et al., *Novel sterol binding domains in bacteria*, eLife (2024)](https://doi.org/10.7554/eLife.90696). The [7T1M entry](https://www.rcsb.org/structure/7T1M) contains one protein chain, waters and chloride, with no bound sterol, at 1.60 Å resolution.

## Why this protein

The study measured binding to bacterial C-4 methylsterols and found no detectable BstB binding to cholesterol or lanosterol under its assay conditions. This makes it a useful protein-first example: discover cavities, inspect their lining, then test specified sterols. Cholesterol in the starter tray is a comparison compound, not an established positive ligand for BstB. The study's sterol poses were modeled; this apo entry supplies no experimental bound pose for redocking RMSD. Studio's example is not a held-out validation or a reproduction of the paper's calculations.

## Coordinate preparation

- `deposited-7T1M.pdb`: unchanged RCSB download, retained for provenance.
- `structure.pdb`: a prepared derivative used in Studio. Nine selenomethionines at A:23, A:47, A:50, A:80, A:83, A:98, A:132, A:220 and A:273 are converted to methionine: MSE → MET, atom SE → SD, selenium → sulfur. This allows the installed Meeko receptor templates to prepare the reference.
- Atom positions and author residue numbering are unchanged. There is no relaxation or missing-loop reconstruction; the derivative is not an independently determined native-Met structure.
- Waters and chloride remain in the input and are removed by default protein-only inference/docking preparation. No lipid was stripped to manufacture an apo example.

The bundled 17-pocket analysis was computed with the real fpocket + original SLiPP pipeline on this prepared copy. Raw outputs are uncalibrated; relative display scores are raw/max within this protein. Coordinates, preparation and model hashes are recorded in `studio.json`. No docking runs are prepopulated. fpocket descriptors may vary on regeneration.

Rebuild and check the deposited composition, coordinate preservation, real inference and Meeko preparation:

```sh
.venv-docking/bin/python scripts/prepare-lipid-reference.py
```

The earlier FABP4 fixture is retained in `../fabp4-reference/` for regression checks and as the evidence for the original PDF paper's worked example. The Desktop Markdown paper has the revised BstB example.
