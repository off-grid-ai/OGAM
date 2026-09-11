import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const applicationDist = resolve('../shared/packages/application/dist');
const runtimeEntry = resolve(applicationDist, 'index.mjs');
const declarationEntry = resolve(applicationDist, 'index.d.ts');

const runtimeExports = [
  'createOffGridApplication',
  'createWhisperPublicDownloadRequest',
  'imageDownloadCompatibility',
  'parseModelControlIntent',
];
const declarationExports = [
  ...runtimeExports,
  'ModelsDownloadPorts',
  'ModelsSnapshot',
  'ProjectorRepairPlatformPort',
];

await Promise.all([
  access(runtimeEntry, constants.R_OK),
  access(declarationEntry, constants.R_OK),
]);

const [runtime, declarations] = await Promise.all([
  import(`${pathToFileURL(runtimeEntry).href}?contract-check=${Date.now()}`),
  readFile(declarationEntry, 'utf8'),
]);

const missingRuntime = runtimeExports.filter(name => !(name in runtime));
const missingDeclarations = declarationExports.filter(
  name => !new RegExp(`\\b${name}\\b`).test(declarations),
);

if (missingRuntime.length || missingDeclarations.length) {
  const details = [
    missingRuntime.length ? `runtime: ${missingRuntime.join(', ')}` : null,
    missingDeclarations.length ? `declarations: ${missingDeclarations.join(', ')}` : null,
  ].filter(Boolean).join('; ');
  throw new Error(`Shared application consumer contract is stale or incomplete (${details}).`);
}

console.log('Shared application consumer contract passed.');
