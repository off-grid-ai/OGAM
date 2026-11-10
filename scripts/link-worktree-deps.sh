#!/bin/bash
set -euo pipefail
# A linked git worktree holds only the codebase. Its node_modules points at the main checkout's
# packages, so a new worktree costs megabytes, not gigabytes. Runs from .husky/post-checkout when a
# worktree is created; safe to run again by hand in any worktree.
ROOT="$(git rev-parse --show-toplevel)"
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
[ "$ROOT" = "$MAIN" ] && exit 0

# Same lockfile and patches, so the main checkout's packages are the ones this worktree needs.
deps_fingerprint() {
  cat "$1/package-lock.json" "$1"/patches/* 2>/dev/null | shasum | cut -d' ' -f1
}

# node_modules stays a real folder of per-package links. A link to the whole folder is unsafe:
# `npm ci` empties the link target, which would wipe the main checkout's packages. With per-package
# links `npm ci` removes only the links and installs a private copy.
link_node_modules() {
  local source="$MAIN/node_modules" target="$ROOT/node_modules" entry name
  [ -d "$source" ] || return 0
  [ -e "$target" ] && return 0
  if [ "$(deps_fingerprint "$ROOT")" != "$(deps_fingerprint "$MAIN")" ]; then
    echo "link-worktree-deps: package-lock.json or patches/ differ from $MAIN; run npm ci here." >&2
    return 0
  fi
  mkdir "$target"
  for entry in "$source"/* "$source"/.[!.]*; do
    name="$(basename "$entry")"
    # npm rewrites its hidden lockfile in place, and tool caches are per checkout.
    case "$name" in .package-lock.json | .cache | '.[!.]*' | '*') continue ;; esac
    ln -s "$entry" "$target/$name"
  done
}

# Native build output (ios/build, android/app/build, .video-build) stays private to each checkout:
# two worktrees building at once would overwrite each other's outputs and intermediates.

link_node_modules
