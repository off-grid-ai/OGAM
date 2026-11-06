#!/bin/bash
set -euo pipefail
# Git resolves a relative core.hooksPath inside each worktree, and a new worktree has no
# .husky/_ yet, so its post-checkout hook would never run. Point every worktree at the main
# checkout's hooks by absolute path.
MAIN="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
git config core.hooksPath "$MAIN/.husky/_"
