# 1ATP structural reference

Unmodified structure and normalized fpocket test reference, from Discngine/fpocket commit `4bb0d8447f62fee77e2c3c29f54b5fcaf5e2c066`:
- https://github.com/Discngine/fpocket/tree/4bb0d8447f62fee77e2c3c29f54b5fcaf5e2c066/tests/reference_output/1ATP_out
- https://www.rcsb.org/structure/1ATP

Alpha spheres retain their original centers and radii; pocket centers are the arithmetic mean of sphere centers. Author chain, residue number and insertion code are preserved. Numeric descriptors are copied verbatim from fpocket's reference output. No model predictions are invented or inferred from fpocket scores.

SLiPP++ class vocabulary comes from filiprumenovski/SLiPP-Plus commit `9dbc027cf44f3b5e78970617e890b29c9d69feb0`. The GitHub checkout contains no matched per-pocket production predictions for this structure. `prediction` and model version remain null.

Rebuild using `python3 scripts/prepare-reference.py /path/to/fpocket` at the source revision above. See `FPOCKET-LICENSE` for the source license.
