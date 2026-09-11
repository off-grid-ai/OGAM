#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const repoRoot = path.resolve(import.meta.dirname, '..');
const forbiddenFiles = [
  'src/services/sync/nativeSync.ts',
  'pro/sync/discoverabilityControl.ts',
  'pro/sync/gossipedRouteReconnect.ts',
  'pro/sync/pairingQr.ts',
  'pro/sync/reconnectDevice.ts',
  'pro/sync/syncNetworkControl.ts',
  'pro/sync/syncRuntimeCallbacks.ts',
  'pro/sync/syncServiceAccessors.ts',
];
const facadeFreeServices = new Set([
  'pro/sync/knowledgeDocumentSyncService.ts',
  'pro/sync/stateSyncService.ts',
]);
const discoverabilityOwner = 'pro/sync/discoverabilityCommands.ts';
const findings = [];

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(test|spec)\.[jt]sx?$/.test(entry.name)
      ? [absolute]
      : [];
  });
}

const relative = file => path.relative(repoRoot, file).replaceAll(path.sep, '/');
const files = ['src', 'pro']
  .map(directory => path.join(repoRoot, directory))
  .filter(fs.existsSync)
  .flatMap(sourceFiles);
const rootApplication = fs.readFileSync(
  path.join(repoRoot, 'src/services/composition/application.ts'),
  'utf8',
);
const proEntry = fs.readFileSync(path.join(repoRoot, 'pro/index.ts'), 'utf8');

if (
  !rootApplication.includes('callHook<Promise<void>>(HOOKS.applicationStarted)') ||
  rootApplication.indexOf('.start()') >
    rootApplication.indexOf('callHook<Promise<void>>(HOOKS.applicationStarted)')
) {
  findings.push('src/services/composition/application.ts: dependent startup must follow root start');
}
if (!proEntry.includes('registerHook(HOOKS.applicationStarted')) {
  findings.push('pro/index.ts: Sync dependents are not registered behind root startup');
}
if (
  !rootApplication.includes('callHook<Promise<void>>(HOOKS.applicationStopping)') ||
  !proEntry.includes('registerHook(HOOKS.applicationStopping')
) {
  findings.push('Mobile Sync dependents must stop before the application root stops');
}

for (const file of forbiddenFiles) {
  if (fs.existsSync(path.join(repoRoot, file))) {
    findings.push(`${file}: obsolete Mobile Sync owner exists`);
  }
}

for (const file of files) {
  const name = relative(file);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const syncAliases = new Set();

  const visit = node => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === 'sync'
    ) {
      syncAliases.add(node.name.text);
    }
    if (ts.isIdentifier(node) && ['createNativeSync', 'NativeSync'].includes(node.text)) {
      findings.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: legacy ${node.text} reference`);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const member = node.expression.name.text;
      const receiverText = receiver.getText(source);
      const isSyncReceiver =
        syncAliases.has(receiverText) ||
        receiverText.endsWith('.sync') ||
        receiverText === 'applicationFacade().sync';
      if (isSyncReceiver && (member === 'start' || member === 'stop')) {
        findings.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: Sync lifecycle bypasses the application root`);
      }
      if (isSyncReceiver && member === 'setDiscoverable' && name !== discoverabilityOwner) {
        findings.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: discoverability bypasses its serialized command owner`);
      }
    }
    if (
      facadeFreeServices.has(name) &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'applicationFacade'
    ) {
      findings.push(`${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: service re-enters the application facade`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (findings.length > 0) {
  console.error('Mobile Sync architecture gate failed:');
  findings.forEach(finding => console.error(`- ${finding}`));
  process.exit(1);
}

console.log(`Mobile Sync architecture gate passed (${files.length} production files, 0 violations).`);
