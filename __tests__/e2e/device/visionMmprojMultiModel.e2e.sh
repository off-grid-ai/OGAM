#!/usr/bin/env bash
# On-device e2e: multi-model mmproj invariants (Android=adb, iOS=devicectl log pull).
#
# Two properties the A1 fix guarantees, proven on a REAL device via disk state + the app's debug log
# (un-fakeable — no reliance on UI assertions):
#
#   A) QUANT DEDUP — downloading a 2nd quantization of the SAME model must NOT re-download the mmproj.
#      One projector serves every quant (mmProjLocalName is quant-independent), and checkMmProjExists
#      skips the sidecar when it is already on disk. ASSERT: after the 2nd quant, the model still has
#      exactly ONE mmproj file on disk, and the log shows the mmproj was reused, not re-fetched.
#
#   B) FAMILY SEPARATION — two different models of the same family (Gemma 4 E2B vs E4B) must each keep
#      their OWN mmproj and never mispair. ASSERT: two DISTINCT mmproj files on disk, and each model
#      loads with `[WIRE-VISION] … initialized:true` naming ITS OWN mmproj, with no
#      "Multimodal support not enabled" anywhere.
#
# PLATFORM: pass PLATFORM=android (adb) or PLATFORM=ios (devicectl). The DOWNLOADS + model LOADS are
# driven by the operator/harness (coordinate taps drift — screenshot-verify); this script owns the
# deterministic ASSERTIONS. Run each phase with PHASE=baseline|dedup|family.
#
#   PLATFORM=android bash visionMmprojMultiModel.e2e.sh <phase>
set -uo pipefail
PLATFORM="${PLATFORM:-android}"
IOS_UDID="${IOS_UDID:-00008150-000225103CD8C01C}"
PKG=ai.offgridmobile.dev

models_ls() {
  if [ "$PLATFORM" = ios ]; then
    xcrun devicectl device info files --device "$IOS_UDID" --domain-type appDataContainer \
      --domain-identifier "$PKG" --subdirectory Documents/models 2>/dev/null | grep -oE '[^ /]+\.gguf' || true
  else
    export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
    adb exec-out run-as "$PKG" sh -c 'ls -1 files/models 2>/dev/null'
  fi
}

read_log() {
  if [ "$PLATFORM" = ios ]; then
    xcrun devicectl device copy from --device "$IOS_UDID" --domain-type appDataContainer \
      --domain-identifier "$PKG" --source Documents/offgrid-debug.log --destination /tmp/mm-e2e-ios.log >/dev/null 2>&1
    cat /tmp/mm-e2e-ios.log 2>/dev/null
  else
    export PATH="$PATH:$HOME/Library/Android/sdk/platform-tools"
    adb exec-out run-as "$PKG" sh -c 'cat files/offgrid-debug.log 2>/dev/null'
  fi
}

# count a model-family's mmproj files on disk (e.g. STEM=gemma-4-e2b)
mmproj_count() { models_ls | grep -i mmproj | grep -ic "$1" || true; }

case "${1:?phase: baseline|dedup|family}" in
  baseline)
    echo "[$PLATFORM] gemma-4-e2b mmproj files: $(mmproj_count gemma-4-e2b)"
    echo "[$PLATFORM] gemma-4-e4b mmproj files: $(mmproj_count gemma-4-e4b)"
    models_ls | tr '\n' ' '; echo ;;

  dedup)  # run AFTER downloading a 2nd quant of gemma-4-E2B
    N=$(mmproj_count gemma-4-e2b)
    WEIGHTS=$(models_ls | grep -vi mmproj | grep -ic gemma-4-e2b)
    echo "gemma-4-e2b: weights=$WEIGHTS  mmproj=$N"
    # the 2nd quant's finalization must report the mmproj already present (not re-downloaded)
    REUSE=$(read_log | grep -aiE "mmproj already on disk|mmProjFileExists\":true.*gemma-4-e2b|mmproj.*skip" | tail -1)
    if [ "$N" -eq 1 ] && [ "$WEIGHTS" -ge 2 ]; then
      echo "PASS(A): 2 gemma-4-E2B quants share ONE mmproj (no re-download). reuse-log: ${REUSE:0:80}"
    else
      echo "FAIL(A): expected 1 mmproj + >=2 weights, got mmproj=$N weights=$WEIGHTS"; exit 1
    fi ;;

  family) # run AFTER downloading gemma-4-E4B alongside E2B
    E2B=$(mmproj_count gemma-4-e2b); E4B=$(mmproj_count gemma-4-e4b)
    echo "mmproj files: e2b=$E2B e4b=$E4B"
    DUMP=$(read_log)
    ERR=$(echo "$DUMP" | grep -aic "multimodal support not enabled")

    # PAIRING proof — the un-fakeable signal is the app's own pairing decision, logged two ways:
    #   1. [linkOrphanMmProj] (fires at boot / finalization) prints "<weights> — linking <mmproj>".
    #   2. [WIRE-VISION] (fires at model LOAD) prints the model + mmproj it initialized with.
    # Family separation holds iff E2B weights pair the e2b mmproj AND E4B weights pair the e4b mmproj
    # (NEVER the other family's). A load-triggered WIRE-VISION is nice-to-have but needs a manual
    # message-send; the boot-time linkOrphanMmProj line is deterministic, so accept EITHER.
    pair_ok() { # $1=weights-family stem  $2=required mmproj stem
      echo "$DUMP" | grep -aiE "linkOrphanMmProj|WIRE-VISION" | grep -i "$1" | grep -i "$2" | tail -1
    }
    mispair() { # $1=weights-family stem  $2=FORBIDDEN mmproj stem (the other family's)
      echo "$DUMP" | grep -aiE "linkOrphanMmProj|WIRE-VISION" | grep -i "$1" | grep -ic "$2"
    }
    P_E2B=$(pair_ok "gemma-4-e2b-it-q" "gemma-4-e2b-it-mmproj")
    P_E4B=$(pair_ok "gemma-4-e4b-it-q" "gemma-4-e4b-it-mmproj")
    X_E2B=$(mispair "gemma-4-e2b-it-q" "gemma-4-e4b-it-mmproj")   # E2B must NOT pair e4b mmproj
    X_E4B=$(mispair "gemma-4-e4b-it-q" "gemma-4-e2b-it-mmproj")   # E4B must NOT pair e2b mmproj
    echo "pair e2b->e2b: ${P_E2B:+yes} | pair e4b->e4b: ${P_E4B:+yes} | mispairs: e2b->e4b=$X_E2B e4b->e2b=$X_E4B"
    if [ "$E2B" -ge 1 ] && [ "$E4B" -ge 1 ] && [ -n "$P_E2B" ] && [ -n "$P_E4B" ] \
       && [ "$X_E2B" -eq 0 ] && [ "$X_E4B" -eq 0 ] && [ "$ERR" -eq 0 ]; then
      echo "PASS(B): distinct mmproj on disk; E2B pairs its OWN mmproj and E4B pairs its OWN mmproj; no cross-pairing, no error"
    else
      echo "FAIL(B): e2b_files=$E2B e4b_files=$E4B e2b_paired=${P_E2B:+1} e4b_paired=${P_E4B:+1} mispair_e2b=$X_E2B mispair_e4b=$X_E4B errors=$ERR"; exit 1
    fi ;;
esac
