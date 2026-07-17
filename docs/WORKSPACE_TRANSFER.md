# Workspace transfer on Mobile

Workspace transfer moves projects, chats, messages, knowledge-base documents, and message attachments in one verified archive. It does not transfer model binaries, credentials, or account state.

## Export

1. Open **Settings**.
2. Select **Workspace transfer**.
3. Select **Export workspace**.
4. Choose where to send or save the archive in the system share sheet.

The temporary archive is removed after the share sheet finishes. If the share sheet is dismissed, Mobile reports the export as cancelled.

## Import

1. Open **Settings → Workspace transfer**.
2. Select **Import workspace** and choose an Off Grid workspace archive.
3. Keep the app open while Mobile verifies file names, sizes, hashes, and references, then indexes imported knowledge-base text.

Mobile currently uses **keep existing** behavior. Existing records with the same portable ID are retained; missing projects, chats, messages, documents, and attachments are added. A crash-safe journal rolls an interrupted import back on the next launch before transfer is enabled again.

Archives from unknown sources should not be imported. Mobile rejects unsupported, unsafe, corrupted, or oversized archives before applying their data.
