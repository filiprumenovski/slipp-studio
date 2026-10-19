#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=mac_aarch64 ;;
  Darwin-x86_64) asset=mac_x86_64 ;;
  Linux-aarch64) asset=linux_aarch64 ;;
  Linux-x86_64) asset=linux_x86_64 ;;
  *) printf 'Unsupported platform for the local docking installer.\n' >&2; exit 1 ;;
esac
if [ ! -x "$repo_dir/.venv-docking/bin/python" ]; then
  uv venv --python 3.12 "$repo_dir/.venv-docking"
fi
uv pip install --python "$repo_dir/.venv-docking/bin/python" -r "$repo_dir/scripts/docking/requirements.txt"
curl --fail --location --silent --show-error "https://github.com/ccsb-scripps/AutoDock-Vina/releases/download/v1.2.7/vina_1.2.7_$asset" -o "$repo_dir/.venv-docking/bin/vina.download"
chmod +x "$repo_dir/.venv-docking/bin/vina.download"
mv "$repo_dir/.venv-docking/bin/vina.download" "$repo_dir/.venv-docking/bin/vina"
"$repo_dir/.venv-docking/bin/vina" --version
"$repo_dir/.venv-docking/bin/python" - <<'PY'
import json, os, sys
from pathlib import Path
root = Path.home() / 'Library/Application Support' if sys.platform == 'darwin' else Path(os.environ.get('XDG_DATA_HOME', str(Path.home()/'.local/share')))
config = root/'science.slipp.studio/docking-runtime.json'
config.parent.mkdir(parents=True,exist_ok=True)
config.write_text(json.dumps({'python':sys.executable}))
print('Docking runtime configured. Reopen SLiPP Studio.')
PY
