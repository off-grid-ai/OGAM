import fs from 'node:fs';
import path from 'node:path';

const mobileRoot = process.cwd();

function productionTypeScript(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (/\.tsx?$/.test(entry.name)) files.push(absolute);
    }
  };
  visit(root);
  return files;
}

function offenders(
  files: readonly string[],
  pattern: RegExp,
  allowed: ReadonlySet<string>,
): string[] {
  return files.flatMap(file => {
    const relative = path.relative(mobileRoot, file).replaceAll(path.sep, '/');
    if (allowed.has(relative)) return [];
    pattern.lastIndex = 0;
    return pattern.test(fs.readFileSync(file, 'utf8')) ? [relative] : [];
  });
}

const production = [
  ...productionTypeScript(path.join(mobileRoot, 'src')),
  ...productionTypeScript(path.join(mobileRoot, 'pro')),
];

describe('cross-device model consumer boundaries', () => {
  it('keeps raw local text generation inside model adapters', () => {
    expect(offenders(
      production,
      /llmService\.(?:generateResponse|generateResponseWithTools|generateWithMaxTokens|generateToolSelection)\s*\(/g,
      new Set([
        'src/services/adapters/providers/localProvider.ts',
        'src/services/modelServices/sidecarGenerationAdapter.ts',
        'src/services/modelServices/toolPorts.ts',
      ]),
    )).toEqual([]);
  });

  it('keeps raw remote provider execution inside remote adapters', () => {
    expect(offenders(
      production,
      /provider\.(?:generate|loadModel)\s*\(/g,
      new Set([
        'src/services/adapters/remote/serverRuntime.ts',
        'src/services/modelServices/generationAdapters.ts',
      ]),
    )).toEqual([]);
  });

  it('keeps shared generation calls inside consumer facades and model composition', () => {
    expect(offenders(
      production,
      /mobile(?:Voice)?GenerationService\.generate\s*\(/g,
      new Set([
        'src/services/chatGenerationProjection.ts',
        'src/services/modelServices/chatGenerationApplication.ts',
        'src/services/mobileSidecarGeneration.ts',
        'src/services/mobileTranscription.ts',
        'src/services/sharedImageGeneration.ts',
        'pro/audio/voiceGeneration.ts',
      ]),
    )).toEqual([]);
  });

  it('keeps screens and components independent from engines and provider registries', () => {
    const ui = production.filter(file => /\/(?:screens|components|ui)\//.test(file));
    expect(offenders(
      ui,
      /from\s+['"][^'"]*(?:services\/llm|adapters\/providers|services\/litert)['"]/g,
      new Set(),
    )).toEqual([]);
  });
});
