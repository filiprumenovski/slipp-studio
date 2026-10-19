#!/bin/sh
# Register the user's existing research checkpoint and its local feature/encoder runtime.
set -eu
science_root=${1:?Usage: scripts/setup-geometric.sh SCIENCE_ROOT CHECKPOINT [FOLDSEEK]}
checkpoint=${2:?Supply the asymmetric taxonomy-migrated fold-2 checkpoint}
studio_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tools_dir="$studio_root/.venv-docking/geometric-tools"
foldseek=${3:-"$tools_dir/foldseek-build/src/foldseek"}
uv sync --project "$science_root" --python 3.11 --extra deep --extra train --frozen
if [ ! -x "$foldseek" ]; then
  mkdir -p "$tools_dir"
  source_dir="$tools_dir/foldseek-source"
  if [ ! -d "$source_dir/.git" ]; then git clone --filter=blob:none --no-checkout https://github.com/steineggerlab/foldseek.git "$source_dir"; fi
  git -C "$source_dir" checkout 21952ed84e0f4a06ec6af08d58add77cef8dec14
  git -C "$source_dir" submodule update --init --recursive --depth 1
  # Xcode installed under a path with spaces can break recursive Apple make.
  if [ "$(uname -s)" = Darwin ] && [ -x /Library/Developer/CommandLineTools/usr/bin/make ]; then
    cmake -S "$source_dir" -B "$tools_dir/foldseek-build" -DCMAKE_MAKE_PROGRAM=/Library/Developer/CommandLineTools/usr/bin/make -DENABLE_PROSTT5=OFF -DREQUIRE_OPENMP=0 -DCMAKE_BUILD_TYPE=Release
  else
    cmake -S "$source_dir" -B "$tools_dir/foldseek-build" -DENABLE_PROSTT5=OFF -DREQUIRE_OPENMP=0 -DCMAKE_BUILD_TYPE=Release
  fi
  cmake --build "$tools_dir/foldseek-build" -j 4
fi
"$science_root/.venv/bin/python" - "$studio_root" "$science_root" "$checkpoint" "$foldseek" <<'PY'
import importlib.util, json, subprocess, sys
from pathlib import Path
studio, science, checkpoint, foldseek = [Path(p).resolve() for p in sys.argv[1:]]
spec=importlib.util.spec_from_file_location('geometric',studio/'scripts/inference/geometric.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
saprot=science/'data/models/saprot_35m_af2'
graph=science/'data/processed/v50_enriched/graphs/residue_cavity_v2/metadata.json'
pool=science/'data/processed/v50_enriched/graphs/residue_cavity_v1/saprot_35m/metadata.json'
files=[checkpoint,foldseek,graph,pool,science/'uv.lock',saprot/'provenance.json',*sorted((science/'src/slipp').rglob('*.py')),
       *[saprot/name for name in ['config.json','pytorch_model.bin','vocab.txt','tokenizer_config.json','special_tokens_map.json']]]
encoder=json.loads((saprot/'provenance.json').read_text())
if g.sha(saprot/encoder['weight_file'])!=encoder['weight_sha256']:
    raise ValueError('SaProt encoder does not match its recorded training provenance.')
config=dict(python=sys.executable,scienceRoot=str(science),checkpoint=str(checkpoint),
    saprot=str(saprot),graphMetadata=str(graph),foldseek=str(foldseek),
    foldseekVersion=subprocess.check_output([str(foldseek),'version'],text=True).strip(),
    trainingFoldseekVersion=json.loads(pool.read_text())['foldseek_version'],
    hashes={str(p):g.sha(p) for p in files})
# Validate architecture, weight shapes, feature order and taxonomy before registration.
sys.path.insert(0,str(science/'src'))
g.load_checkpoint(config)
path=g.config_path();path.parent.mkdir(parents=True,exist_ok=True)
temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(config,indent=2));temporary.replace(path)
print(f'Registered {g.MODEL_NAME}: {path}')
print(f'Checkpoint SHA256: {g.sha(checkpoint)}')
if config['foldseekVersion']!=config['trainingFoldseekVersion']:
    print('Foldseek differs from the training binary; both versions will be recorded in each result.')
PY
