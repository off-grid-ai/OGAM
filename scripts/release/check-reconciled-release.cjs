'use strict';
// Release guard: never silently ship the old Atlas navigation or artwork again.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const required = [
  'src/screens/WorkspaceScreen.tsx', 'src/screens/chatListGrouping.ts',
  'src/stores/protectedProjectVault.ts', 'src/services/nearbySync/index.ts',
  'src/atlasTools/projectBackupFiles.ts', 'src/atlasTools/backup.ts',
  'src/screens/ChatsListScreen.tsx', 'FUTURE_RELEASES.md',
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Release is missing: ' + file);
}
if (!read('src/navigation/AppNavigator.tsx').includes('workspace: WorkspaceScreen'))
  throw new Error('Merged Projects/Agents workspace is absent from navigation.');
if (!read('src/stores/agentStore.ts').includes('activeAgentId: null'))
  throw new Error('No Agent default was lost.');
if (!read('src/screens/ChatsListScreen.tsx').includes('buildChatListRows'))
  throw new Error('Project-folder chat grouping was lost.');
const iconPaths = ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png','android/app/src/main/res/drawable/splash_logo.png'];
const hashes = iconPaths.map(p => crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex'));
if (hashes[0] !== hashes[1]) throw new Error('Android launcher and splash artwork diverged.');
const ids = [...read('FUTURE_RELEASES.md').matchAll(/^\s*- \[ \] \*\*FF-\d\d/gm)];
if (ids.length !== 9) throw new Error('User-authored nine-item future-feature list is missing or modified.');
const releaseWorkflow = read('.github/workflows/atlas-apk.yml');
if (!/assembleRelease[^\n]*-PatlasVulkanEnabled=true/.test(releaseWorkflow) ||
    !releaseWorkflow.includes('lib/arm64-v8a/libllamakt.so'))
  throw new Error('Official APK must build and verify the llama.kt Vulkan text engine.');
if (read('android/app/build.gradle').includes('.vulkantest'))
  throw new Error('Vulkan builds must update the normal Atlas app, not install a side-by-side copy.');
console.log('Reconciled Atlas release contract passed: Workspace, no-agent, chat folders, privacy modules, icon, Vulkan engine and roadmap.');
