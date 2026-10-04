#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { temporaryModelArchitectureAllowlist } from './model-architecture-allowlist.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

function sourceFiles(directory, includeTests = false) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__' || entry.name === 'node_modules') return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute, includeTests);
    return /\.[cm]?[jt]sx?$/.test(entry.name) &&
      (includeTests || !/\.(test|spec)\.[jt]sx?$/.test(entry.name))
      ? [absolute]
      : [];
  });
}

const files = [path.join(repoRoot, 'src'), path.join(repoRoot, 'pro')]
  .filter(fs.existsSync)
  .flatMap(sourceFiles);
if (fs.existsSync(path.join(repoRoot, 'App.tsx'))) {
  files.push(path.join(repoRoot, 'App.tsx'));
}
const testFiles = [
  path.join(repoRoot, '__tests__'),
  path.join(repoRoot, 'pro', '__tests__'),
]
  .filter(fs.existsSync)
  .flatMap(directory => sourceFiles(directory, true));
const relative = file =>
  path.relative(repoRoot, file).replaceAll(path.sep, '/');
const nodeText = (source, node) => node.getText(source).replace(/\s+/g, ' ');
const lineOf = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
const keyOf = finding => `${finding.rule}|${finding.file}|${finding.detail}`;
const findings = [];
const forbiddenModelOwnerExports = new Set([
  'createModelWorkspace',
  'ModelResidencyManager',
]);
const forbiddenAppModelServices = new Set([
  'ModelDownloadCoordinator',
  'ModelDownloadRegistry',
  'ModelCommandApplicationService',
  'ModelLibraryCommandService',
  'ModelSelectionApplicationService',
]);
const forbiddenDownloadControlPlaneModules = [
  'modelDownloadCoordinator',
  'downloadRegistryBootstrap',
  'coordinatedDownloadBridge',
  'ttsDownloadProvider',
];
const selectionProjectionKeys = new Set([
  'activeModelId',
  'lastTextModelId',
  'activeImageModelId',
  'activeServerId',
  'activeRemoteTextModelId',
  'activeRemoteImageModelId',
  'activeRemoteMediaServerIds',
  'downloadedModelId',
  'classifierModelId',
]);
const ragRuntimeImportOwners = new Set([
  'src/services/composition/application.ts',
  'src/services/adapters/rag/mobileRagPorts.ts',
  // Native file and PDF I/O for document attachments.
  'src/services/documentService.ts',
]);

function importsRuntimeValue(node) {
  const clause = node.importClause;
  if (!clause) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name) return true;
  if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
    return true;
  }
  return (
    clause.namedBindings &&
    ts.isNamedImports(clause.namedBindings) &&
    clause.namedBindings.elements.some(element => !element.isTypeOnly)
  );
}

function runtimeNamedImports(node) {
  const clause = node.importClause;
  if (
    !clause ||
    clause.isTypeOnly ||
    !clause.namedBindings ||
    !ts.isNamedImports(clause.namedBindings)
  ) return [];
  return clause.namedBindings.elements
    .filter(element => !element.isTypeOnly)
    .map(element => (element.propertyName ?? element.name).text);
}

function assignedSelectionKeys(node) {
  const keys = [];
  const inspect = candidate => {
    if (
      ts.isPropertyAssignment(candidate) ||
      ts.isShorthandPropertyAssignment(candidate)
    ) {
      const name =
        candidate.name &&
        (ts.isIdentifier(candidate.name) ||
          ts.isStringLiteralLike(candidate.name))
          ? candidate.name.text
          : '';
      if (selectionProjectionKeys.has(name)) keys.push(name);
    }
    ts.forEachChild(candidate, inspect);
  };
  inspect(node);
  return keys;
}

/**
 * ---- residency-admission-has-one-owner -----------------------------------------------------------
 *
 * THE INVARIANT: every LOCAL model that can stay resident in memory loads through
 * `ModelResidencyManager`, which owns admission, co-residency, eviction, leases, budgeting,
 * overrides and reclaim failures. Platform code performs the native load/unload ONLY as an adapter
 * the manager invokes, and never decides residency policy. Call direction is fixed:
 * app -> `ModelsFacade` -> residency manager -> native adapter.
 *
 * WHY A GATE AND NOT A COMMENT: `src/services/adapters/native/modelLoaders.ts` states this
 * invariant in its own header. The claim is TRUE at HEAD - its one caller goes through the manager -
 * and nothing stopped the next call site from making it false, while the comment kept reassuring
 * every reader either way. A true claim with no enforcement decays into a false one silently, and
 * the comment is what makes the decay invisible. This is the desktop rule, same shape.
 *
 * HOW IT MATCHES: on the engine MODULE, never on a receiver name - an earlier scan of ours anchored
 * on a receiver and was blind to every injected facade, i.e. every hexagonal file. It records the
 * bindings a file gets from an engine module (static, namespace, or `const { x } = await
 * import(...)`) and only then looks at lifecycle member calls on those bindings, so renaming the
 * binding cannot evade it.
 *
 * BLIND SPOTS - stated because a gate that silently misses a bypass is as bad as the comment:
 * an INJECTED PORT (a file handed an engine port as a parameter has no import to anchor on; this is
 * also how the legitimate path works, and the import graph is what narrows it); a RE-EXPORT CHAIN;
 * a COMPUTED MEMBER `engine[name]()`; anything outside TypeScript. And the short-lived-process
 * carve-out is where it is weakest: a process INTENDED to exit can survive a kill and still hold
 * model memory, so that carve-out must mean PROVEN exited - which is a runtime fact this rule cannot
 * see. Do not widen it on the strength of a comment.
 */
const residencyEngineModules = new Map([
  ['services/llm', 'llama text engine'],
  ['services/litert', 'LiteRT text engine'],
  ['services/localDreamGenerator', 'ONNX image engine'],
]);
/** Members that CHANGE residency. Deliberately not generation members: those consume, not admit. */
const residencyLifecycleMembers = new Set([
  'loadModel',
  'unloadModel',
  'initialize',
  'release',
  'warm',
  'evict',
  'unload',
  'load',
]);
/**
 * The only files that may touch a native lifecycle member, each because the manager invokes it or
 * composes what it invokes. SHORT by design: if this needs to grow, the call direction is wrong.
 */
const residencyAdapterFiles = new Set([
  'src/services/adapters/native/modelLoaders.ts',
  'src/services/adapters/native/modelLifecycle.ts',
  'src/services/modelServices/textEnginePorts.ts',
]);
const engineModuleFor = specifier => {
  for (const [suffix, label] of residencyEngineModules) {
    const bare = suffix.split('/').at(-1);
    if (specifier.endsWith(`/${bare}`) || specifier === `./${bare}` || specifier.endsWith(suffix)) {
      return label;
    }
  }
  return null;
};

function checkResidencyAdmission(fileName, source) {
  if (residencyAdapterFiles.has(fileName)) return;
  if ([...residencyEngineModules.keys()].some(suffix => fileName === `src/${suffix}.ts`)) return;
  const bindings = new Map();
  const bind = (name, label) => {
    if (name) bindings.set(name, label);
  };
  const collect = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const label = engineModuleFor(node.moduleSpecifier.text);
      if (label && node.importClause) {
        const named = node.importClause.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const element of named.elements) bind(element.name.text, label);
        }
        if (named && ts.isNamespaceImport(named)) bind(named.name.text, label);
        if (node.importClause.name) bind(node.importClause.name.text, label);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (
        ts.isCallExpression(initializer) &&
        initializer.expression.kind === ts.SyntaxKind.ImportKeyword &&
        initializer.arguments[0] &&
        ts.isStringLiteral(initializer.arguments[0])
      ) {
        const label = engineModuleFor(initializer.arguments[0].text);
        if (label) {
          if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              if (ts.isIdentifier(element.name)) bind(element.name.text, label);
            }
          } else if (ts.isIdentifier(node.name)) {
            bind(node.name.text, label);
          }
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(source);
  if (bindings.size === 0) return;
  const inspect = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        bindings.has(callee.expression.text) &&
        residencyLifecycleMembers.has(callee.name.text)
      ) {
        report(
          'residency-admission-has-one-owner',
          fileName,
          source,
          node,
          `native lifecycle call outside the residency adapter: ${callee.expression.text}.${callee.name.text}() on the ${bindings.get(callee.expression.text)}`,
        );
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}

/** The application root is the only owner allowed to construct the workspace or residency manager. */
function checkModelOwnerConstruction(fileName, source) {
  const inspect = node => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('@offgrid/models') &&
      node.importClause &&
      !node.importClause.isTypeOnly &&
      node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const element of node.importClause.namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && forbiddenModelOwnerExports.has(imported)) {
          report(
            'application-root-owns-model-workspace',
            fileName,
            source,
            element,
            `runtime import of ${imported}`,
          );
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer
    ) {
      const initializer = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (
        ts.isCallExpression(initializer) &&
        initializer.expression.kind === ts.SyntaxKind.ImportKeyword &&
        initializer.arguments[0] &&
        ts.isStringLiteral(initializer.arguments[0]) &&
        initializer.arguments[0].text.startsWith('@offgrid/models')
      ) {
        for (const element of node.name.elements) {
          const imported = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : '';
          if (forbiddenModelOwnerExports.has(imported)) {
            report(
              'application-root-owns-model-workspace',
              fileName,
              source,
              element,
              `dynamic runtime import of ${imported}`,
            );
          }
        }
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}

/** Apps supply I/O ports. They do not construct a second model/download application layer. */
function checkAppModelControlPlanes(fileName, source) {
  const forbiddenBindings = new Map();
  const modelNamespaces = new Set();
  const inspect = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      const localOwner = forbiddenDownloadControlPlaneModules.find(name => specifier.includes(name));
      if (localOwner && importsRuntimeValue(node)) {
        report(
          'models-facade-is-the-only-app-control-plane',
          fileName,
          source,
          node,
          `runtime import of deleted app control plane ${localOwner}`,
        );
      }
      if (specifier.startsWith('@offgrid/models')) {
        const named = node.importClause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) modelNamespaces.add(named.name.text);
        if (named && ts.isNamedImports(named)) {
          for (const element of named.elements) {
            const imported = (element.propertyName ?? element.name).text;
            if (!element.isTypeOnly && forbiddenAppModelServices.has(imported)) {
              forbiddenBindings.set(element.name.text, imported);
            }
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = ts.isAwaitExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      const importedModule = ts.isCallExpression(initializer)
        && initializer.expression.kind === ts.SyntaxKind.ImportKeyword
        && initializer.arguments[0]
        && ts.isStringLiteral(initializer.arguments[0])
        ? initializer.arguments[0].text
        : null;
      const localOwner = importedModule
        ? forbiddenDownloadControlPlaneModules.find(name => importedModule.includes(name))
        : undefined;
      if (localOwner) {
        report(
          'models-facade-is-the-only-app-control-plane',
          fileName,
          source,
          node,
          `dynamic runtime import of deleted app control plane ${localOwner}`,
        );
      }
      if (importedModule?.startsWith('@offgrid/models') && ts.isIdentifier(node.name)) {
        modelNamespaces.add(node.name.text);
      }
      if (importedModule?.startsWith('@offgrid/models') && ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const imported = element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name) ? element.name.text : '';
          if (forbiddenAppModelServices.has(imported) && ts.isIdentifier(element.name)) {
            forbiddenBindings.set(element.name.text, imported);
          }
        }
      }
    }
    if (
      ts.isNewExpression(node)
      && (
        (ts.isIdentifier(node.expression) && forbiddenBindings.has(node.expression.text))
        || (
          ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && modelNamespaces.has(node.expression.expression.text)
          && forbiddenAppModelServices.has(node.expression.name.text)
        )
      )
    ) {
      const owner = ts.isIdentifier(node.expression)
        ? forbiddenBindings.get(node.expression.text)
        : node.expression.name.text;
      report(
        'models-facade-is-the-only-app-control-plane',
        fileName,
        source,
        node,
        `app constructs ${owner}`,
      );
    }
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'require'
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) {
      const localOwner = forbiddenDownloadControlPlaneModules.find(
        name => node.arguments[0].text.includes(name),
      );
      if (localOwner) {
        report(
          'models-facade-is-the-only-app-control-plane',
          fileName,
          source,
          node,
          `dynamic runtime import of deleted app control plane ${localOwner}`,
        );
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(source);
}

function report(rule, file, source, node, detail) {
  findings.push({ rule, file, line: lineOf(source, node), detail });
}

const controlPlaneNegativeProbes = [
  "import { ModelDownloadCoordinator as Owner } from '@offgrid/models'; new Owner({});",
  "import * as Models from '@offgrid/models'; new Models.ModelDownloadRegistry({});",
  "const { ModelSelectionApplicationService: Owner } = await import('@offgrid/models'); new Owner({});",
  "const Models = await import('@offgrid/models'); new Models.ModelCommandApplicationService({});",
  "const legacy = await import('./services/modelServices/coordinatedDownloadBridge'); void legacy;",
];
for (const [index, probe] of controlPlaneNegativeProbes.entries()) {
  const source = ts.createSourceFile(`negative-probe-${index}.ts`, probe, ts.ScriptTarget.Latest, true);
  const before = findings.length;
  checkAppModelControlPlanes(`negative-probe-${index}.ts`, source);
  const detected = findings.splice(before).some(
    finding => finding.rule === 'models-facade-is-the-only-app-control-plane',
  );
  if (!detected) {
    report(
      'architecture-gate-self-test',
      `negative-probe-${index}.ts`,
      source,
      source,
      'control-plane rule did not reject a renamed or dynamic bypass',
    );
  }
}

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fileName = relative(file);
  checkResidencyAdmission(fileName, source);
  checkModelOwnerConstruction(fileName, source);
  checkAppModelControlPlanes(fileName, source);
  const isUi = /^src\/(components|hooks|screens)\//.test(fileName);
  const isAdapter =
    /^src\/services\/(adapters|modelServices\/.*Adapter|.*Provider)/i.test(
      fileName,
    );
  const canonicalSelectionReadSurface =
    fileName === 'src/components/checklist/useOnboardingSteps.ts' ||
    fileName === 'src/hooks/useEjectAllModels.ts' ||
    fileName === 'src/screens/ProjectDetailScreen.tsx' ||
    fileName === 'src/screens/ChatScreen/useChatScreen.ts' ||
    fileName === 'pro/ui/McpServersScreen.tsx' ||
    fileName === 'pro/audio/ui/AudioMessageBubble/index.tsx';

  if (
    fileName === 'src/services/localDreamGenerator.ts' &&
    (!/\bprojectNativeImageGeneration\s*\(/.test(text) ||
      !/\bprojectNativeGeneratedImageResult\s*\(/.test(text) ||
      /(?:steps|guidanceScale|width|height|previewInterval|useOpenCL)\s*:\s*[^,\n]*(?:\|\||\?\?)\s*(?:true|false|\d+(?:\.\d+)?)/.test(
        text,
      ))
  ) {
    report(
      'local-image-adapter-has-no-generation-policy',
      fileName,
      source,
      source,
      'localDreamGenerator must consume Shared native request and result projections',
    );
  }

  // This asserted `.models.hydrateDownloads(` in App.tsx and was therefore UNSATISFIABLE:
  // `hydrateDownloads` is deliberately private to `@offgrid/application` - absent from
  // `dist/index.d.ts`, and two shared tests pin it that way
  // (`packages/application/test/models-download-owner.test.mjs:156` and `:696`). A rule that can
  // only be satisfied by breaking a boundary is a broken rule, so it was red for two days over
  // behavior that was never missing.
  //
  // Hydration IS reached at bootstrap, through the PUBLIC inventory refresh:
  //   App.tsx `await refreshMobileModelServices()` (in `initializeApp`, the mount path)
  //     -> src/services/modelServices/index.ts:126 refreshMobileModelServices
  //     -> src/services/modelServices/mobileLLMService.ts:14 `applicationFacade().models.refresh()`
  //     -> shared packages/application/src/models/projector-repair-facade.ts:24-30, whose `refresh`
  //        awaits `owner.hydrate()`, then `deps.hydrateDownloads()`, then `reconcile`.
  // The coordinator and ports that hydration needs are CONSTRUCTOR dependencies of the downloads
  // controller, not start()-time ones, so the boot refresh takes the real hydration path even
  // though it runs before `startMobileApplication()`.
  //
  // The rule now names the STARTUP LIFECYCLE as the owner. Cold-start recovery is a durable
  // concern for the whole app lifetime, so a component effect is the wrong owner - it would tie
  // recovery to a render tree. `startMobileApplication` owns it, unawaited, because the refresh
  // reads the native download database and the first screen must not wait on it.
  //
  // The rule deliberately does NOT accept App.tsx as the owner. App.tsx's own `models.refresh()`
  // sits inside `onForeground`, which fires only on a background->active AppState transition
  // (`src/hooks/useAppState.ts:13-19`) and never at mount, so a rule pointed at that file would be
  // satisfied by a foreground-only refresh.
  if (
    fileName === 'src/services/composition/application.ts' &&
    !/\.models\s*\n?\s*\.refresh\s*\(|\.models\.refresh\s*\(/.test(text)
  ) {
    report(
      'image-download-recovery-starts-at-bootstrap',
      fileName,
      source,
      source,
      'application startup does not run the public refresh that hydrates the download journal',
    );
  }

  if (
    fileName === 'pro/mcp/mcpService.ts' &&
    /\bconnectionGenerations\b|JSON\.parse\s*\(\s*match|new\s+RegExp\s*\(|\btoolOwners\s*\[/.test(
      text,
    )
  ) {
    report(
      'mobile-mcp-policy-is-shared',
      fileName,
      source,
      source,
      'local:lifecycle-parser-or-owner-policy',
    );
  }

  if (
    fileName === 'src/services/modelServices/toolPorts.ts' &&
    /selectionLimit\s*:\s*\d+/.test(text)
  ) {
    report(
      'mobile-tool-selection-limit-is-shared',
      fileName,
      source,
      source,
      'local:selection-limit',
    );
  }

  if (/\bresidencyMode\b/.test(text)) {
    report(
      'runtime-model-has-one-lifecycle-vocabulary',
      fileName,
      source,
      source,
      'deprecated:residencyMode',
    );
  }

  if (
    fileName === 'src/stores/appStore.ts' &&
    /(?:temperature:\s*0\.7|maxTokens:\s*1024|topP:\s*0\.9|repeatPenalty:\s*1\.1|liteRTMaxTokens:\s*4096)/.test(
      text,
    )
  ) {
    report(
      'model-configuration-defaults-are-shared',
      fileName,
      source,
      source,
      'local:text-default',
    );
  }

  if (
    /^(?:src\/services\/llmSafetyChecks|src\/services\/whisperModelFiles|pro\/sync\/modelPackageSink)\.ts$/.test(
      fileName,
    ) &&
    /\b(?:GGUF_MAGIC|MIN_GGUF_FILE_SIZE|MIN_MODEL_FILE_SIZE)\b|\.corruption\b|\.size\s*[<>]=?/.test(
      text,
    )
  ) {
    report(
      'artifact-verification-policy-is-shared',
      fileName,
      source,
      source,
      'app-owned format, size, or corruption branch',
    );
  }

  if (fileName === 'src/services/modelServices/remoteImageGeneration.ts') {
    report(
      'mobile-image-lifecycle-is-shared',
      fileName,
      source,
      source,
      'file:remoteImageGeneration',
    );
  }

  if (
    fileName === 'src/stores/remoteServerStore.ts' &&
    /\b(?:addServer|updateServer|removeServer|discoverModels|testConnection|clearAllServers)\s*:/.test(
      text,
    )
  ) {
    report(
      'remote-server-workflow-is-shared',
      fileName,
      source,
      source,
      'store:actionable-workflow',
    );
  }

  if (
    /^src\/(?:components|hooks|screens)\//.test(fileName) &&
    /services\/networkDiscovery/.test(text)
  ) {
    report(
      'remote-server-workflow-is-shared',
      fileName,
      source,
      source,
      'ui:direct-lan-discovery',
    );
  }

  if (
    /^src\/(?:components|hooks|screens)\//.test(fileName) &&
    /\bmodelLibrary\.(?:repairMmProj|repairVision)\s*\(/.test(text)
  ) {
    report(
      'vision-repair-command-is-shared',
      fileName,
      source,
      source,
      'UI calls a raw vision repair workflow instead of the typed application command',
    );
  }

  if (
    /^src\/services\/(?:llmToolGeneration|litertToolSelector|toolEmbeddingRouter|toolCapabilityPreflight)\.ts$/.test(
      fileName,
    )
  ) {
    report(
      'mobile-tool-routing-is-shared',
      fileName,
      source,
      source,
      `file:${path.basename(fileName)}`,
    );
  }

  if (
    /^src\/(?:constants\/models|services\/(?:curatedLiteRTRegistry|whisperModels))\.ts$/.test(
      fileName,
    )
  ) {
    report(
      'mobile-catalog-policy-is-shared',
      fileName,
      source,
      source,
      `file:${path.basename(fileName)}`,
    );
  }

  if (
    /^src\/services\/(?:huggingFaceModelBrowser|autoSetupImageCatalogProvider)\.ts$/.test(
      fileName,
    ) &&
    /\bguessStyle\b|(?:reality|realistic|chillout|photo|anime|anything|counterfeit|meina|abyssorange|pastel)[^\n]{0,80}\.includes\s*\(/i.test(
      text,
    )
  ) {
    report(
      'image-style-classification-is-shared',
      fileName,
      source,
      source,
      'local:image-style-heuristic',
    );
  }

  if (
    (fileName === 'src/services/adapters/remote/serverDiscovery.ts' &&
      /\/v1\/models|\/api\/tags|\b(?:remoteDiscoveryEndpoints|remoteTextDiscoveryCandidates|remoteGatewayCatalog|defaultRemoteSelections|detectServerType|testEndpoint)\b/.test(
        text,
      )) ||
    (fileName === 'src/services/httpClientUtils.ts' &&
      /\b(?:RemoteProviderDiscoveryApplicationService|remoteProviderProbes|detectServerType|testEndpoint)\b/.test(
        text,
      ))
  ) {
    report(
      'remote-discovery-policy-is-shared',
      fileName,
      source,
      source,
      'adapter:provider-policy',
    );
  }

  if (
    fileName === 'src/services/networkDiscovery.ts' &&
    /\b(?:PROVIDERS|FALLBACK_SUBNETS|MAX_IN_FLIGHT|TIMEOUT_MS|GATEWAY_TIMEOUT_MS|runPool|subnetBase|isPrivateIPv4|isIPv6)\b|\/v1\/models|\/api\/tags|192\.168\.[01]/.test(
      text,
    )
  ) {
    report(
      'lan-discovery-policy-is-shared',
      fileName,
      source,
      source,
      'adapter:lan-scan-policy',
    );
  }

  if (
    fileName === 'src/services/adapters/remote/modelCapabilityDiscovery.ts' &&
    /\/api\/show|\/api\/v1\/models|\/props|\/v1\/chat\/completions|Say hi|enable_thinking|\b(?:ollamaCapabilityInfo|lmStudioCapabilityInfo|llamaCppCapabilityInfo|resolveRemoteCapabilityEvidence|remoteDeltaHasReasoning)\b/.test(
      text,
    )
  ) {
    report(
      'remote-capability-discovery-policy-is-shared',
      fileName,
      source,
      source,
      'adapter:capability-probe-policy',
    );
  }

  if (
    fileName === 'src/stores/whisperStore.ts' &&
    /\b(?:downloadModel|selectModel|loadModel|unloadModel|deleteModel|deleteModelById|refreshPresentModels)\s*:/.test(
      text,
    )
  ) {
    report(
      'transcription-workflow-is-shared',
      fileName,
      source,
      source,
      'store:actionable-workflow',
    );
  }

  if (
    fileName === 'src/services/modelServices/modelLifecycleBootstrap.ts' &&
    /\bpending(?:Text|Image|Transcription)ModelId\b/.test(text)
  ) {
    report(
      'residency-workflow-is-shared',
      fileName,
      source,
      source,
      'module-global:pending-model-id',
    );
  }

  if (fileName === 'src/services/modelPreloader.ts') {
    report(
      'dead-boot-preloader-is-removed',
      fileName,
      source,
      source,
      'file:modelPreloader',
    );
  }

  if (
    /^(?:src\/screens\/ChatsListScreen|src\/components\/ModelSelectorModal\/index|src\/screens\/HomeScreen\/hooks\/useRemoteModelHandlers)\.tsx?$/.test(
      fileName,
    ) &&
    /\b(?:selectMobileModel|clearMobileModel|mobileResidencyIntents)\b/.test(
      text,
    )
  ) {
    report(
      'ui-model-commands-are-shared',
      fileName,
      source,
      source,
      'ui:direct-selection-or-residency-command',
    );
  }

  if (isUi && /\bmobileResidencyIntents\b/.test(text)) {
    report(
      'ui-model-commands-are-shared',
      fileName,
      source,
      source,
      'ui:direct-residency-intent-bypasses-model-command-application',
    );
  }

  if (
    fileName === 'src/screens/ModelsScreen/useImageModels.ts' &&
    /\breconcileMobileImageDownloads\b|imageDownloadRecoveryApplication/.test(
      text,
    )
  ) {
    report(
      'image-download-recovery-starts-at-bootstrap',
      fileName,
      source,
      source,
      'screen-owned:image-download-recovery',
    );
  }

  if (
    fileName === 'src/services/modelServices/downloadTypes.ts' &&
    /\b(?:ModelDownloadType|ModelDownloadStatus|PublicDownloadType)\b/.test(
      text,
    )
  ) {
    report(
      'download-vocabulary-is-shared',
      fileName,
      source,
      source,
      'local:download-type-or-status-alias',
    );
  }

  if (
    fileName === 'src/screens/ChatScreen/mobileChatSession.ts' &&
    /\b(?:imageIntentDecision|appendProjectKnowledge|composeChatContext)\b/.test(
      text,
    )
  ) {
    report(
      'chat-orchestration-is-shared',
      fileName,
      source,
      source,
      'screen:direct-chat-policy',
    );
  }

  if (fileName === 'src/services/modelServices/modelLifecycleBootstrap.ts') {
    // This was a PRESENCE CHECK on the literal `ModelLifecycleApplicationService`, and the file
    // stopped naming that class when load/unload moved to the Models FACADE commands
    // (`models().load` / `.unload`, typed Outcomes) and eject moved to shared's
    // `ejectModelResidency`. The transaction became MORE shared, not less - a typed command
    // instead of a directly held service - so the rule was measuring the wrong thing, not
    // catching drift.
    //
    // It now has two halves, reported separately so a future failure says WHICH one broke:
    //   1. the file must REACH the shared transaction through one of its sanctioned owners;
    //   2. the file must not ORCHESTRATE the native lifecycle itself, which is what "the
    //      transaction is shared" actually forbids. That half has teeth the name check never had:
    //      the old rule would have passed a file that imported the class and then drove
    //      `nativeModelLifecycle` around it.
    // Native load/unload belongs to `modelLifecyclePorts`, which shared invokes as an adapter.
    const reachesSharedTransaction =
      /\bModelLifecycleApplicationService\b/.test(text) ||
      /\bejectModelResidency\b/.test(text) ||
      (/\bapplicationFacade\b/.test(text) && /\.(?:load|unload)\(/.test(text));
    if (!reachesSharedTransaction) {
      report(
        'model-lifecycle-transaction-is-shared',
        fileName,
        source,
        source,
        'adapter:no-shared-transaction-owner',
      );
    }
    if (/\bnativeModelLifecycle\b/.test(text)) {
      report(
        'model-lifecycle-transaction-is-shared',
        fileName,
        source,
        source,
        'adapter:local-native-lifecycle-orchestration',
      );
    }
  }

  if (fileName === 'src/services/engines.ts') {
    report(
      'text-engine-policy-is-shared',
      fileName,
      source,
      source,
      'obsolete:parallel-engine-facade',
    );
  }

  if (fileName === 'src/utils/modelSelectorFilters.ts') {
    report(
      'catalog-filter-policy-is-shared',
      fileName,
      source,
      source,
      'obsolete:catalog-filter-projection',
    );
  }

  if (
    /^src\/services\/(?:modelServices\/bootstrap\/ragBootstrap|adapters\/rag\/mobileRagPorts)\.ts$/.test(
      fileName,
    ) &&
    /(?:chunkSize\s*:\s*600|overlap\s*:\s*120|minChunkLength\s*:\s*20|dimension\s*:\s*384|topK\s*=\s*5)/.test(
      text,
    )
  ) {
    report(
      'rag-profile-is-shared',
      fileName,
      source,
      source,
      'local:rag-profile-default',
    );
  }

  if (
    /^(?:src\/stores\/appStore|src\/services\/localDreamGenerator|src\/components\/GenerationSettingsModal\/ImageQualitySliders)\.tsx?$/.test(
      fileName,
    ) &&
    /(?:guidanceScale|imageGuidanceScale)[^\n]{0,30}(?:\|\||:)\s*7\.5/.test(
      text,
    )
  ) {
    report(
      'image-settings-defaults-are-shared',
      fileName,
      source,
      source,
      'local:image-guidance-default',
    );
  }

  if (
    fileName === 'src/services/llm.ts' &&
    /\b(?:effectiveAvailableMB|resolveSafeContext|checkMemoryForModel|getGpuLayersForDevice)\b|backend\s*===\s*INFERENCE_BACKENDS\.(?:HTP|OPENCL)/.test(
      text,
    )
  ) {
    report(
      'mobile-text-load-policy-is-shared',
      fileName,
      source,
      source,
      'local:text-load-policy',
    );
  }

  if (
    fileName === 'src/services/llmHelpers.ts' &&
    /\b(?:GPU_INIT_TIMEOUT_MS|HTP_INIT_TIMEOUT_MS|GPU_INIT_TIMEOUT_MS_IOS|gpuInitTimeoutMs|tryGpuInit|withTimeout)\b|Attempt\s+[123]\/3/.test(
      text,
    )
  ) {
    report(
      'mobile-native-load-fallback-is-shared',
      fileName,
      source,
      source,
      'local:native-load-fallback',
    );
  }

  if (
    fileName === 'src/services/contextCompaction.ts' &&
    /class\s+ContextCompactionService|\b(?:planContextCompaction|compactedConversation|SUMMARIZER_SYSTEM_PROMPT|oldMessages|summaryTokenBudget)\b/.test(
      text,
    )
  ) {
    report(
      'context-compaction-workflow-is-shared',
      fileName,
      source,
      source,
      'local:compaction-workflow',
    );
  }

  if (
    fileName === 'src/services/llmSafetyChecks.ts' &&
    /\b(?:estimateTextLoadMemory|modelMemoryFit|planSafeContext|checkMemoryForModel|resolveSafeContext)\b/.test(
      text,
    )
  ) {
    report(
      'mobile-load-admission-is-shared',
      fileName,
      source,
      source,
      'local:load-admission',
    );
  }

  if (
    fileName === 'src/services/modelServices/modelMemoryAdvisory.ts' &&
    /\b(?:modelMemoryBudgetMB|modelWarningThresholdMB|estimateRuntimeMemoryBytes|getCurrentlyLoadedMemoryGB|getOtherLoadedMemoryGB|loadedTextModelId|loadedImageModelId)\b/.test(
      text,
    )
  ) {
    report(
      'mobile-memory-advisory-is-shared',
      fileName,
      source,
      source,
      'app-owned budget, estimate, or loaded-id reconstruction',
    );
  }

  if (
    fileName === 'src/services/modelServices/modelState.ts' &&
    /export\s+async\s+function\s+checkMemoryForModel[\s\S]{0,800}\b(?:getLoadedModelIds|downloadedModels|hasSessionOverride|getLoadPolicy)\b/.test(
      text,
    )
  ) {
    report(
      'mobile-memory-advisory-is-shared',
      fileName,
      source,
      source,
      'facade-owned advisory inputs or verdict',
    );
  }

  if (
    fileName === 'src/utils/ggufCapabilities.ts' &&
    /(?:NAME_PATTERNS|\.includes\s*\(|new\s+RegExp|\.some\s*\()/.test(text)
  ) {
    report(
      'gguf-capability-policy-is-shared',
      fileName,
      source,
      source,
      'app-owned GGUF family policy',
    );
  }

  if (
    fileName === 'src/services/imageGenerationHelpers.ts' &&
    /\.slice\(-10\)|\.slice\(0,\s*500\)|function\s+readableText\b/.test(text)
  ) {
    report(
      'image-enhancement-context-policy-is-shared',
      fileName,
      source,
      source,
      'local:context-selection-policy',
    );
  }

  if (
    fileName === 'pro/sync/textModelTransferAdapter.ts' &&
    /function\s+(?:manifest|modelIdWithoutFile)\b|kind\s*:\s*files\.length/.test(
      text,
    )
  ) {
    report(
      'model-transfer-manifest-policy-is-shared',
      fileName,
      source,
      source,
      'local:text-manifest-policy',
    );
  }

  if (
    fileName === 'pro/sync/whisperModelTransferAdapter.ts' &&
    (!/\bprojectInstalledWhisperTransfer\s*\(/.test(text) ||
      !/\bwhisperModelIdFromTransferId\s*\(/.test(text) ||
      /WHISPER_ID_PREFIX|function\s+(?:displayName|manifest)\b|kind\s*:\s*['"]transcription['"][\s\S]{0,240}engine\s*:\s*['"]whisper['"]/.test(
        text,
      ))
  ) {
    report(
      'whisper-transfer-policy-is-shared',
      fileName,
      source,
      source,
      'local:whisper-transfer-policy',
    );
  }

  if (
    fileName === 'pro/sync/imageModelTransferAdapter.ts' &&
    /256\s*\*\s*1024\s*\*\s*1024|IMAGE_ARCHIVE_RESERVE_BYTES/.test(text)
  ) {
    report(
      'model-transfer-reserve-policy-is-shared',
      fileName,
      source,
      source,
      'local:image-archive-reserve',
    );
  }

  if (
    fileName === 'src/services/modelServices/coordinatedDownloadBridge.ts' &&
    /\b(?:kindFor|statusFor)\b|offgrid-download-staging|revision\s*:\s*['"]mobile|record\.phase\s*===/.test(
      text,
    )
  ) {
    report(
      'download-command-policy-is-shared',
      fileName,
      source,
      source,
      'local:coordinated-download-policy',
    );
  }

  if (
    fileName === 'src/services/whisperModelDownloads.ts' &&
    /\b(?:DownloadOperationRegistry|cancelRequested|markPublished|hasReplacement)\b|Downloaded model file is invalid/.test(
      text,
    )
  ) {
    report(
      'download-command-policy-is-shared',
      fileName,
      source,
      source,
      'local:whisper-download-policy',
    );
  }

  if (
    fileName === 'src/services/downloadEventProjection.ts' &&
    /entry\.modelType|mmProjStatus|setProcessing|setCompleted|updateMmProjProgress|updateProgress/.test(
      text,
    )
  ) {
    report(
      'download-command-policy-is-shared',
      fileName,
      source,
      source,
      'local:download-event-policy',
    );
  }

  if (
    fileName === 'src/services/modelFailureReasons.ts' &&
    /function\s+(?:reasonFromLoadError|modelNotReadyAlert)\b/.test(text)
  ) {
    report(
      'model-failure-policy-is-shared',
      fileName,
      source,
      source,
      'local:failure-policy',
    );
  }

  if (
    fileName === 'src/screens/ChatScreen/useChatModelActions.ts' &&
    /\b(?:isOverridableMemoryError|reasonFromLoadError|loadModelWithOverride|getMultimodalSupport)\b/.test(
      text,
    )
  ) {
    report(
      'chat-readiness-policy-is-shared',
      fileName,
      source,
      source,
      'app-owned readiness or force-load decision',
    );
  }

  if (
    fileName === 'src/screens/ChatScreen/modelReadiness.ts' &&
    /function\s+(?:reasonFromLoadError|modelNotReadyAlert)\b|\bisModelReady\b/.test(
      text,
    )
  ) {
    report(
      'chat-readiness-policy-is-shared',
      fileName,
      source,
      source,
      'screen-owned readiness decision',
    );
  }

  if (
    fileName === 'src/services/imagePromptEnhancement.ts' &&
    /\b(?:buildImageEnhancementMessages|cleanImageEnhancement|cleanEnhancedPrompt)\b/.test(
      text,
    )
  ) {
    report(
      'prompt-enhancement-orchestration-is-shared',
      fileName,
      source,
      source,
      'app-owned enhancement policy',
    );
  }

  if (
    fileName === 'src/utils/visionRepair.ts' &&
    /includes\(['"](?:vl|vision|smolvlm)['"]\)/.test(text)
  ) {
    report(
      'vision-repair-policy-is-shared',
      fileName,
      source,
      source,
      'app-owned model-name heuristic',
    );
  }

  if (
    fileName === 'src/utils/downloadStatus.ts' &&
    /(?:ACTIVE_STATUSES|return\s+status\s*===\s*['"](?:pending|running|failed)['"])/.test(
      text,
    )
  ) {
    report(
      'download-status-policy-is-shared',
      fileName,
      source,
      source,
      'local:status-policy',
    );
  }

  if (/\b(?:abortPreload|preloadSelectedModels)\b/.test(text)) {
    report(
      'dead-boot-preloader-is-removed',
      fileName,
      source,
      source,
      'symbol:boot-preload',
    );
  }

  if (
    fileName === 'src/services/loadPolicySync.ts' &&
    /\b(?:loadPolicyFromSettings|activeUnsubscribe|isInitialSeed|modelLoadingMode\s*[!=]=|aggressiveModelLoading\s*[!=]=)\b/.test(
      text,
    )
  ) {
    report(
      'load-policy-transition-is-shared',
      fileName,
      source,
      source,
      'adapter:policy-transition',
    );
  }

  if (
    fileName === 'src/screens/ModelsScreen/useTextModels.ts' &&
    /(?:cancelBackgroundDownload|deleteModel\s*\(|mobileResidencyIntents)/.test(
      text,
    )
  ) {
    report(
      'model-library-command-is-shared',
      fileName,
      source,
      source,
      'screen-owned cancellation, deletion, projection, or runtime ordering',
    );
  }

  if (
    /^src\/screens\/ModelsScreen\/(?:useModelsScreen|importHelpers|TextModelsTab)\.tsx?$/.test(
      fileName,
    ) &&
    /(?:lower\.includes\(['"](?:mmproj|projector)['"]\)|endsWith\(['"]\.(?:zip|gguf|litertlm)['"]\)|modelLibrary\.markVisionModel)/.test(
      text,
    )
  ) {
    report(
      'model-library-import-and-repair-commands-are-shared',
      fileName,
      source,
      source,
      'screen-owned import classification or metadata repair',
    );
  }

  if (
    /^src\/(?:components|hooks|screens)\//.test(fileName) &&
    /\bmodelLibrary\.importLocalModel\s*\(/.test(text)
  ) {
    report(
      'model-file-import-transaction-is-shared',
      fileName,
      source,
      source,
      'UI or screen helper calls the platform import workflow directly',
    );
  }

  if (
    /^src\/screens\/ModelsScreen\/(?:useModelsScreen|importHelpers|TextModelsTab)\.tsx?$/.test(
      fileName,
    ) &&
    /(?:react-native-fs|react-native-zip-archive|importedImageIdentity|detectImportedImageBackend|new\s+ImageArchiveImportService|addDownloadedImageModel\s*\()/.test(
      text,
    )
  ) {
    report(
      'image-archive-import-transaction-is-shared',
      fileName,
      source,
      source,
      'ui-owned archive, package, registration, or identity transaction',
    );
  }

  if (
    fileName === 'src/services/modelServices/sidecarGenerationAdapter.ts' &&
    /(?:Reply only YES or NO|\.slice\(0,\s*200\)|includes\(['"]yes['"]\)|labels\.map|score\s*:)/i.test(
      text,
    )
  ) {
    report(
      'classifier-policy-is-shared',
      fileName,
      source,
      source,
      'sidecar-owned prompt, parsing, labels, or confidence',
    );
  }

  if (
    fileName === 'src/services/modelServices/sidecarExecutionComposition.ts' &&
    /output\.labels\.(?:reduce|sort)|label\s*===\s*['"]image['"]/.test(text)
  ) {
    report(
      'classifier-policy-is-shared',
      fileName,
      source,
      source,
      'composition-owned classifier route projection',
    );
  }

  if (
    fileName === 'src/screens/ModelsScreen/useImageModels.ts' &&
    /(?:resumeImageDownload|modelDownloadProjection|resumingDownloadKeysRef)/.test(
      text,
    )
  ) {
    report(
      'image-download-recovery-is-shared',
      fileName,
      source,
      source,
      'screen-owned recovery admission, projection, or de-duplication',
    );
  }

  if (
    /^src\/services\/imageDownload(?:Actions|Resume|Retry|Qnn)\.ts$/.test(
      fileName,
    ) &&
    /(?:react-native-fs|react-native-zip-archive|\bRNFS\b|\bunzip\b|hardwareService|modelLibrary|imageDownloadRecoveryAction|imageDownloadRetryAction|createImageDownloadPlan|new\s+Date\s*\(|downloadSequentialImageFiles)/.test(
      text,
    )
  ) {
    report(
      'image-download-application-is-shared',
      fileName,
      source,
      source,
      'app service owns image transfer, compatibility, recovery, registration, or activation policy',
    );
  }

  if (
    fileName.startsWith('src/services/') &&
    !fileName.startsWith('src/services/adapters/') &&
    /(?:imageDownloadRecoveryAction|imageDownloadRetryAction|createImageDownloadPlan)/.test(
      text,
    )
  ) {
    report(
      'image-download-policy-is-shared',
      fileName,
      source,
      source,
      'non-composition service imports portable image-download policy primitives',
    );
  }

  if (
    /^src\/(?:screens|hooks|stores|components)\//.test(fileName) &&
    /(?:imageDownloadApplicationAdapter|react-native-zip-archive|coordinatedDownloadBridge|imageDownloadWorkflowAdapter)/.test(
      text,
    )
  ) {
    report(
      'image-download-ui-uses-typed-intents',
      fileName,
      source,
      source,
      'UI imports an image-download native or workflow adapter',
    );
  }

  if (
    !fileName.startsWith('src/services/adapters/') &&
    /(?:deviceVariant\s*===\s*['"]8gen2['"]|modelVariant\s*===\s*deviceVariant|modelVariant\s*!==\s*['"]8gen2['"])/.test(
      text,
    )
  ) {
    report(
      'image-device-compatibility-is-shared',
      fileName,
      source,
      source,
      'app-owned QNN compatibility matrix',
    );
  }

  if (
    /^src\/services\/adapters\/downloads\/(?:text|image)DownloadAdapter\.ts$/.test(
      fileName,
    ) &&
    /(?:modelLibrary\.(?:deleteModel|deleteImageModel)|removeDownloaded(?:Image)?Model|unload(?:Text|Image)Model)/.test(
      text,
    )
  ) {
    report(
      'model-library-command-is-shared',
      fileName,
      source,
      source,
      'provider-owned package deletion, projection cleanup, or runtime ordering',
    );
  }

  if (
    fileName === 'pro/audio/ttsStore.ts' &&
    /\b(?:ttsRegistry|modelResidencyManager|withVoiceSwitchTimeout|completedVoiceAssets|engine\.(?:setVoice|initialize|release|downloadAssets|deleteAssets|generateAndSave))\b/.test(
      text,
    )
  ) {
    report(
      'voice-control-plane-is-shared',
      fileName,
      source,
      source,
      'store:voice-workflow',
    );
  }

  if (
    fileName === 'pro/audio/ttsPlayback.ts' &&
    /\b(?:AbortController|dispatchPlayback|playbackStatus\s*[!=]=|currentMessageId\s*[!=]=)\b/.test(
      text,
    )
  ) {
    report(
      'voice-playback-control-is-shared',
      fileName,
      source,
      source,
      'adapter:playback-state-machine',
    );
  }

  if (
    fileName === 'pro/audio/ttsDownloadActions.ts' &&
    /\b(?:downloadAssets|deleteAssets|modelDownloaded|voiceAssetsDownloaded|modelResidencyManager)\b/.test(
      text,
    )
  ) {
    report(
      'voice-download-workflow-is-shared',
      fileName,
      source,
      source,
      'adapter:download-policy',
    );
  }

  if (
    fileName === 'pro/audio/voiceGenerationPort.ts' &&
    /\b(?:engine\.speak|initializeEngine|reconcileDownloadedFromPersisted|Promise\.race)\b/.test(
      text,
    )
  ) {
    report(
      'voice-synthesis-flow-is-shared',
      fileName,
      source,
      source,
      'adapter:synthesis-policy',
    );
  }

  if (
    /useWhisperStore\.getState\(\)\.(?:downloadModel|selectModel|loadModel|unloadModel|deleteModel|deleteModelById|refreshPresentModels)/.test(
      text,
    )
  ) {
    report(
      'transcription-workflow-is-shared',
      fileName,
      source,
      source,
      'call:whisper-store-workflow',
    );
  }

  const visit = node => {
    if (
      canonicalSelectionReadSurface &&
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      ts.isCallExpression(node.initializer) &&
      /^(?:useAppStore|useRemoteServerStore)$/.test(
        nodeText(source, node.initializer.expression),
      )
    ) {
      for (const element of node.name.elements) {
        const name = (element.propertyName ?? element.name).getText(source);
        if (selectionProjectionKeys.has(name)) {
          report(
            'ui-reads-shared-selection-snapshot',
            fileName,
            source,
            element,
            `raw-key:${name}`,
          );
        }
      }
    }

    if (
      /^src\/stores\/(?:appStore|remoteServerStore)\.ts$/.test(fileName) &&
      (ts.isPropertySignature(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:setActiveModelId|setActiveImageModelId|setActiveServerId|setActiveRemoteTextModelId|setActiveRemoteImageModelId|setActiveRemoteMediaServerId)$/.test(
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
          ? node.name.text
          : '',
      )
    ) {
      report(
        'stores-expose-no-selection-writers',
        fileName,
        source,
        node.name,
        `writer:${node.name.getText(source)}`,
      );
    }

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const isUiHookOrStore = /^src\/(?:components|hooks|screens|stores)\//.test(
        fileName,
      );
      const importsRawRemoteServerOwner =
        /(?:^|\/)services\/(?:remoteServerManager|modelServices\/remoteServerController)$/.test(
          specifier,
        ) && importsRuntimeValue(node);
      const importsRawRemoteServerFromBarrel =
        /(?:^|\/)services(?:\/index)?$/.test(specifier) &&
        runtimeNamedImports(node).includes('remoteServerManager');
      if (
        isUiHookOrStore &&
        (importsRawRemoteServerOwner || importsRawRemoteServerFromBarrel)
      ) {
        report(
          'ui-model-commands-use-application-facade',
          fileName,
          source,
          node,
          'import:remoteServerManager',
        );
      }
      if (
        fileName ===
          'src/components/models/RemoteModelOptionsSection.tsx' &&
        importsRuntimeValue(node) &&
        (/(?:^|\/)(?:services\/modelServices|stores\/remoteServerStore)(?:\/index)?$/.test(
          specifier,
        ) ||
          (/(?:^|\/)services(?:\/index)?$/.test(specifier) &&
            runtimeNamedImports(node).includes('selectMobileModel')))
      ) {
        report(
          'remote-model-options-use-models-facade',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        fileName ===
          'src/components/ChatInput/voiceControllerEffects.ts' &&
        /(?:^|\/)services\/voiceSession$/.test(specifier) &&
        importsRuntimeValue(node)
      ) {
        report(
          'voice-controller-uses-speech-facade',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        specifier === '@offgrid/rag' &&
        importsRuntimeValue(node) &&
        !ragRuntimeImportOwners.has(fileName)
      ) {
        report(
          'rag-runtime-imports-stay-in-platform-ports',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (/services\/engines$/.test(specifier)) {
        report(
          'text-engine-policy-is-shared',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        isUi &&
        /(services\/litert(?:\.|$)|llama|whisperService|localDreamGenerator|imageGenerationService|adapters\/providers)/i.test(
          specifier,
        )
      ) {
        report(
          'ui-does-not-import-raw-model-engine',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        !isAdapter &&
        fileName !== 'src/services/modelServices/mobileLLMService.ts' &&
        /adapters\/providers$/.test(specifier)
      ) {
        report(
          'provider-policy-uses-shared-capabilities',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        /modelServices\/modelLifecycleBootstrap/.test(specifier) &&
        !/^src\/services\/(modelServices|adapters)\//.test(fileName) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (/^(?:load|unload|eject|force)\w*Models?$/.test(importedName)) {
            report(
              'deprecated-residency-api-outside-model-port',
              fileName,
              source,
              element,
              `import:${importedName}`,
            );
          }
        }
      }
      if (
        fileName === 'src/services/imageGenerationService.ts' &&
        /(remoteServerStore|localDreamGenerator|imagePromptEnhancement|residencyIntents|sharedImageGeneration)/.test(
          specifier,
        )
      ) {
        report(
          'mobile-image-lifecycle-is-shared',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        fileName !== 'src/services/modelServices/toolPorts.ts' &&
        /(?:litertToolSelector|toolEmbeddingRouter|toolCapabilityPreflight|llmToolGeneration)/.test(
          specifier,
        )
      ) {
        report(
          'mobile-tool-routing-is-shared',
          fileName,
          source,
          node,
          `import:${specifier}`,
        );
      }
      if (
        fileName !==
          'src/services/modelServices/imageGenerationApplication.ts' &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          const importedName = (element.propertyName ?? element.name).text;
          if (
            /^(?:imageRuntimeNeedsReload|isFirstImageRuntimeRun|imageApplicationFailure|imageProgressStatus|resolveImageGenerationSettings)$/.test(
              importedName,
            )
          ) {
            report(
              'mobile-image-lifecycle-is-shared',
              fileName,
              source,
              element,
              `import:${importedName}`,
            );
          }
        }
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /modelServices\/modelLifecycleBootstrap/.test(
        node.moduleSpecifier.text,
      ) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const element of node.exportClause.elements) {
        if (/^(?:load|unload|eject|force)\w*Models?$/.test(element.name.text)) {
          report(
            'deprecated-residency-api-outside-model-port',
            fileName,
            source,
            element,
            `export:${element.name.text}`,
          );
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const call = nodeText(source, node.expression);
      const rawName = call.split('.').at(-1);
      if (
        canonicalSelectionReadSurface &&
        /^(?:useAppStore|useRemoteServerStore)$/.test(call) &&
        [...selectionProjectionKeys].some(key =>
          new RegExp(`\\.${key}\\b`).test(nodeText(source, node)),
        )
      ) {
        report(
          'ui-reads-shared-selection-snapshot',
          fileName,
          source,
          node,
          `selector:${nodeText(source, node)}`,
        );
      }
      if (
        /^(setActiveModelId|setActiveImageModelId|setActiveServerId|setActiveRemoteTextModelId|setActiveRemoteImageModelId|setActiveRemoteMediaServerId)$/.test(
          rawName,
        ) &&
        fileName !== 'src/services/modelServices/modelSelectionProjection.ts'
      ) {
        report(
          'active-model-writes-use-canonical-selection-port',
          fileName,
          source,
          node,
          `call:${rawName}`,
        );
      }
      if (
        fileName !== 'src/services/modelServices/modelSelectionProjection.ts'
      ) {
        const assignedKeys = node.arguments.flatMap(assignedSelectionKeys);
        if (/\.setState$/.test(call) && assignedKeys.length > 0) {
          report(
            'selection-projections-have-one-writer',
            fileName,
            source,
            node,
            `call:${call}:${assignedKeys.join(',')}`,
          );
        }
        if (
          /\.updateSettings$/.test(call) &&
          assignedKeys.includes('classifierModelId')
        ) {
          report(
            'selection-projections-have-one-writer',
            fileName,
            source,
            node,
            `call:${call}`,
          );
        }
      }
      if (
        /^(generateResponse|generateResponseWithTools|generateWithMaxTokens|generateToolSelection|generateForChatSession|completeText|completeTextWithTools|completeCappedText|dispatchGenerationFn|resolveTurnKind|regenerateResponseFn)$/.test(
          rawName,
        )
      ) {
        report(
          'generation-callers-use-shared-service',
          fileName,
          source,
          node,
          `call:${rawName}`,
        );
      }
      if (/^(chat|chatMessages|chatStream|streamChat)$/.test(rawName)) {
        report(
          'no-route-owning-llm-api',
          fileName,
          source,
          node,
          `call:${rawName}`,
        );
      }
      if (
        /^useDownloadStore\.getState\(\)\.(add|setStatus|setProcessing|retryEntry|remove)$/.test(
          call,
        ) &&
        !/^src\/services\/(adapters\/downloads\/|adapters\/models\/library\/|downloadEventProjection\.ts$)/.test(
          fileName,
        )
      ) {
        report(
          'apps-do-not-own-download-state-machines',
          fileName,
          source,
          node,
          `call:${call}`,
        );
      }
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(generateResponse|generateResponseWithTools|generateWithMaxTokens|generateToolSelection|generateForChatSession|completeText|completeTextWithTools|completeCappedText|chat|chatMessages|chatStream|streamChat)$/.test(
        node.name.getText(source),
      ) &&
      /^(src\/services\/(llm|litert)\.ts)$/.test(fileName)
    ) {
      report(
        'no-route-owning-llm-api',
        fileName,
        source,
        node.name,
        `declaration:${node.name.getText(source)}`,
      );
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:ensureImageModelLoaded|runGenerationAndSave|enhanceImageGenerationPrompt|resolveImageGenerationRoute|retryImageGeneration|forceLoadImageModel)$/.test(
        node.name.getText(source),
      )
    ) {
      report(
        'mobile-image-lifecycle-is-shared',
        fileName,
        source,
        node.name,
        `declaration:${node.name.getText(source)}`,
      );
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:generateWithToolsImpl|selectRelevantTools|selectToolsByEmbedding|remoteToolCapabilityIssue)$/.test(
        node.name.getText(source),
      )
    ) {
      report(
        'mobile-tool-routing-is-shared',
        fileName,
        source,
        node.name,
        `declaration:${node.name.getText(source)}`,
      );
    }

    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.name &&
      /^(?:computeFilteredResults|bestFitScore|matchesOrgFilter|isTextModel|defaultModelIds|fetchGatewayModelCatalogPolicy)$/.test(
        node.name.getText(source),
      )
    ) {
      report(
        'mobile-catalog-policy-is-shared',
        fileName,
        source,
        node.name,
        `declaration:${node.name.getText(source)}`,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(?:cancelRequested|remoteImageRequest|lastImageGenerationParams)$/.test(
        node.name.text,
      )
    ) {
      report(
        'mobile-image-lifecycle-is-shared',
        fileName,
        source,
        node.name,
        `declaration:${node.name.text}`,
      );
    }

    if (
      (ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node)) &&
      node.name &&
      /^(ProviderRegistry|LLMProvider)$/.test(node.name.text)
    ) {
      report(
        'no-parallel-provider-control-plane',
        fileName,
        source,
        node.name,
        `declaration:${node.name.text}`,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /^(providerRegistry|localProvider)$/.test(node.name.text)
    ) {
      report(
        'no-parallel-provider-control-plane',
        fileName,
        source,
        node.name,
        `declaration:${node.name.text}`,
      );
    }

    if (
      isAdapter &&
      (ts.isIfStatement(node) ||
        ts.isSwitchStatement(node) ||
        ts.isConditionalExpression(node))
    ) {
      const condition = ts.isIfStatement(node)
        ? node.expression
        : ts.isSwitchStatement(node)
        ? node.expression
        : node.condition;
      const expression = nodeText(source, condition);
      if (
        /(provider(Id)?\s*(===|!==)|\.provider(Id)?\s*(===|!==)|instanceof\s+\w*Provider|is(?:Ollama|OpenRouter|Gemini)|enableThinking|disableThinking|reasoningControl)/i.test(
          expression,
        )
      ) {
        report(
          'adapters-do-not-own-provider-or-reasoning-policy',
          fileName,
          source,
          condition,
          `branch:${expression}`,
        );
      }
    }

    if (
      isUi &&
      ts.isStringLiteralLike(node) &&
      node.text.includes('remote-vision:')
    ) {
      report(
        'internal-remote-vision-id-never-reaches-ui',
        fileName,
        source,
        node,
        `literal:${node.text}`,
      );
    }

    if (
      /^src\/screens\/ChatScreen\/(mobileChatSession|useChatGenerationActions)\.tsx?$/.test(
        fileName,
      ) &&
      ts.isImportSpecifier(node) &&
      /^(generationService|imageGenerationService|onnxImageGeneratorService)$/.test(
        node.name.text,
      )
    ) {
      report(
        'ui-uses-chat-projection-and-model-ports',
        fileName,
        source,
        node,
        `import:${node.name.text}`,
      );
    }

    if (
      ts.isClassDeclaration(node) &&
      node.name &&
      /(DownloadQueue|DownloadCoordinator|DownloadStateMachine|DownloadRegistry|WhisperModelDownloads)$/.test(
        node.name.text,
      )
    ) {
      report(
        'apps-do-not-own-download-state-machines',
        fileName,
        source,
        node.name,
        `class:${node.name.text}`,
      );
    }

    if (
      (ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isPropertySignature(node)) &&
      /^(whisperModel|ttsModel|activeWhisperModel|activeTtsModel|whisper_model|tts_model)$/.test(
        node.name &&
          (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))
          ? node.name.text
          : '',
      )
    ) {
      report(
        'no-legacy-whisper-or-tts-setting-key',
        fileName,
        source,
        node.name,
        `key:${node.name.text}`,
      );
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const file of testFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (/(?:jest|vi)\.mock\s*\(\s*['"]@offgrid\/models['"]/.test(text)) {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    report(
      'tests-do-not-mock-shared-models',
      relative(file),
      source,
      source,
      'mock:@offgrid/models',
    );
  }
}

const allowlist = new Map(
  temporaryModelArchitectureAllowlist.map(entry => [entry.key, entry]),
);
const used = new Set();
const violations = [];
for (const finding of findings) {
  const key = keyOf(finding);
  if (allowlist.has(key)) used.add(key);
  else violations.push(finding);
}
const stale = [...allowlist.values()].filter(entry => !used.has(entry.key));

for (const finding of findings.filter(candidate =>
  allowlist.has(keyOf(candidate)),
)) {
  const debt = allowlist.get(keyOf(finding));
  console.warn(
    `TEMPORARY ${finding.rule}: ${finding.file}:${finding.line} ${finding.detail}`,
  );
  console.warn(
    `  owner=${debt.owner}; reason=${debt.reason}; removeWhen=${debt.removeWhen}`,
  );
}
if (violations.length > 0 || stale.length > 0) {
  for (const finding of violations) {
    console.error(
      `VIOLATION ${finding.rule}: ${finding.file}:${finding.line} ${finding.detail}`,
    );
  }
  for (const entry of stale) console.error(`STALE ALLOWLIST: ${entry.key}`);
  process.exitCode = 1;
} else {
  console.log(
    `Mobile model architecture gate passed (${used.size} temporary item(s)).`,
  );
}
