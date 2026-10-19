#!/bin/sh
set -eu
repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$repo_dir/scripts/setup-docking.sh"
source_dir="$repo_dir/.venv-docking/fpocket-source"
if [ ! -d "$source_dir/.git" ]; then git clone https://github.com/Discngine/fpocket.git "$source_dir"; fi
git -C "$source_dir" checkout 4bb0d8447f62fee77e2c3c29f54b5fcaf5e2c066
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) architecture=MACOSXARM64; standardlib=-lc++ ;;
  Darwin-x86_64) architecture=MACOSXX86_64; standardlib=-lc++ ;;
  Linux-x86_64) architecture=LINUXAMD64; standardlib=-lstdc++ ;;
  *) printf 'Build fpocket for your platform and place it beside the scientific Python executable.\n' >&2; exit 1 ;;
esac
make -C "$source_dir" qhull
make -C "$source_dir" -j4 bin/fpocket ARCH="$architecture" LFLAGS="-lm plugins/$architecture/molfile/libmolfile_plugin.a $standardlib"
cp "$source_dir/bin/fpocket" "$repo_dir/.venv-docking/bin/fpocket"
printf 'fpocket and original SLiPP runtime configured.\n'
