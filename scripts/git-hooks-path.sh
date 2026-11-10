#!/bin/bash
set -euo pipefail
# Git resolves a relative core.hooksPath inside each worktree, and a new worktree has no
# .husky/_ yet, so its post-checkout hook would never run. Point every worktree at the main
# checkout's hooks by absolute path.
# An install from a source archive has no Git worktree (Husky skips itself there): nothing to point.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
git config core.hooksPath "$MAIN/.husky/_"
