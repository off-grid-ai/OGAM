# Atlas learning interchange format (atlas-learning-interchange/1.0)

One ZIP per export. Schema version `1.0`. All timestamps are ISO-8601 UTC.

```
manifest.json     counts, per-file size and SHA-256, scope, compatibility notes
checksums.json    path -> SHA-256 of every data file
agents.jsonl      one expert-agent profile per line
cycles/<cycleId>/report.json | findings.jsonl | reviews.jsonl
documents/index.json
documents/chunks.jsonl            only the chunks the exported findings cite
documents/originals/<sha256>.pdf  optional (off by default)
revisions.jsonl   every earlier version of a finding
tombstones.jsonl  deletions that must stay deleted
```

## Import rules
- Every path must be a safe relative path (no `..`, no absolute paths); sizes and SHA-256 of every file are checked first.
- A newer major schema version is refused with a clear message.
- Every record is validated; a bad package changes nothing.
- A finding's status is never trusted from the package: it is recomputed from its reviews, and a review counts only if its
  evidence hash matches the evidence as it arrives. A finding that changed after approval is not approved.
- Matching is by `recordId` and content hash, so importing the same package twice adds nothing.
- A finding that contradicts an existing one is kept and marked `conflicted`; neither is overwritten.
- Tombstones delete the matching local records and stop them returning on a later import.

## Street Advisory
**Not verified.** This is not a Street Advisory knowledge bundle. Street uses `schemaVersion 2`
(`street-advisory-knowledge-bundle`, `manifest.json`, `records/<sha256>.json`, `artifacts/`) with capsule hashes and judge/manager
approvals that only Street can produce. Atlas does not fabricate them. The manifest marks this package `adapter-required`: Street
needs an adapter that reads this format and runs its own review. No Street validator was available here, so no test against it
has been run. To build the adapter, Street's validator and bundle writer are needed.
