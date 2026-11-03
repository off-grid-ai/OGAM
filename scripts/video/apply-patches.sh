#!/bin/bash
set -euo pipefail
# Applies one platform's local patches (scripts/video/patches.txt) to a stable-diffusion.cpp checkout,
# in the list's order. A patch already applied is left as it is, so a build can run it again.
#
#   apply-patches.sh <android|ios> <source>   apply them
#   apply-patches.sh --list <android|ios>     print each patch's path, for a build key
VIDEO="$(cd "$(dirname "$0")" && pwd)"
# Prints "<target> <patch path>" for each of the platform's patches.
patches() {
  local target patch platforms
  while read -r target patch platforms; do
    case "$target" in ''|'#'*) continue ;; esac
    case ",$platforms," in *",$1,"*) echo "$target $VIDEO/$patch" ;; esac
  done < "$VIDEO/patches.txt"
}
case "${1:-}" in
  --list) patches "$2" | cut -d' ' -f2- ;;
  android|ios)
    source_dir="$2"
    patches "$1" | while read -r target patch; do
      if ! git -C "$source_dir/$target" apply --reverse --check "$patch" 2>/dev/null; then
        git -C "$source_dir/$target" apply "$patch"
      fi
    done
    ;;
  *) echo "usage: apply-patches.sh <android|ios> <source> | --list <android|ios>" >&2; exit 2 ;;
esac
