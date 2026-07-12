# Residency test mismatches — for review

When a residency/co-residency/auto-eviction/budget test (T115–T120 and beyond) **cannot reproduce** what the
device evidence says (`DEVICE_TEST_FINDINGS.md`, `DEVICE_SESSION_COMMENTARY.md`, `docs/wire-captures/`, the
prior conversation summary), it is logged HERE rather than forced to a false green or a wrong-reason red.

Each entry: what the finding/log expected, what the test actually observed, the trace evidence
(`DEBUG_LOGS=1`), and the hypothesis (device-only behavior / stale finding / harness gap / real code
divergence). Nothing here is "done" — each is a question for the human to resolve on return.

Format:
- **[Txxx] <one-line>** — Expected (from <source>): … · Observed (test): … · Trace: … · Hypothesis: … · Status: OPEN

---

_No mismatches logged yet._
