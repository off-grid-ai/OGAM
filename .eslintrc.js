module.exports = {
  root: true,
  extends: [
    '@react-native',
    // SonarJS: Sonar-grade bug/smell detection in normal lint — free, local, and it covers
    // PRO too (pro has no cloud Sonar project; a private cloud project is paid-by-LOC). Most
    // rules stay at `error` (recommended default) as a forward guard; the handful already
    // tripped on legacy code are `warn` below with a logged burn-down (GAPS_BACKLOG).
    'plugin:sonarjs/recommended-legacy',
  ],
  plugins: [
    'react-native',
    'react',
    'react-hooks',
    'sonarjs',
  ],
  env: {
    jest: true,
    browser: true,
    node: true,
    es6: true,
  },
  rules: {
    // TypeScript
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',

    // Hexagonal boundary (warn ratchet, see shared/docs/MODEL_FACADE_PLAN.md): compose the model
    // layer from `@offgrid/models/workspace` (+ constants from `@offgrid/models/catalog`). Value
    // imports from the package root are the second pipeline being removed. Types stay free.
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@offgrid/models',
            // Constructing a shared service in app code is app-side composition of the pipeline.
            importNames: [
              'ArtifactVerificationService',
              'CaptureReadinessApplicationService',
              'ChatContextApplicationService',
              'ChatModelReadinessService',
              'ChatOperationApplicationService',
              'ChatSessionQueue',
              'ChatSessionService',
              'ClassifierExecutionService',
              'ClassifierProvisioningService',
              'ComputerUseSessionApplicationService',
              'ConnectorDistillApplicationService',
              'ConnectorReadApplicationService',
              'ContextCompactionService',
              'DownloadedModelRegistryService',
              'DownloadOperationRegistry',
              'GenerationCancellationCoordinator',
              'GenerationIntentService',
              'GenerationRecoveryCoordinator',
              'GenerationService',
              'GenerationTurnQueue',
              'ImageArchiveImportService',
              'ImageDownloadApplicationService',
              'ImageDownloadRecoveryService',
              'ImageDownloadWorkflowService',
              'ImageGenerationApplicationService',
              'ImageGenerationJobCoordinator',
              'ImagePromptEnhancementService',
              'LLMService',
              'LoadPolicyTransitionCoordinator',
              'LocalModelImportService',
              'McpConnectorApplicationService',
              'MobileNativeLoadService',
              'MobileTextLoadAdmissionService',
              'ModelActivationService',
              'ModelCommandApplicationService',
              'ModelControlApplicationService',
              'ModelDownloadApplicationService',
              'ModelDownloadCoordinator',
              'ModelDownloadProjectionController',
              'ModelDownloadQueue',
              'ModelDownloadRegistry',
              'ModelEjectionService',
              'ModelFileImportApplicationService',
              'ModelLibraryCommandService',
              'ModelLibraryRegistryService',
              'ModelLibraryRemovalService',
              'ModelLifecycleApplicationService',
              'ModelMemoryAdvisoryService',
              'ModelMetadataRepairCommandService',
              'ModelRepairCommandService',
              'ModelResidencyManager',
              'ModelSelectionApplicationService',
              'ModelSelectionAuthority',
              'ModelTransferRegistrationService',
              'ProactiveActionApplicationService',
              'ProactiveToolCatalogService',
              'RemoteCapabilityDiscoveryApplicationService',
              'RemoteLanDiscoveryApplicationService',
              'RemoteProviderDiscoveryApplicationService',
              'RemoteServerApplicationService',
              'TextEngineApplicationService',
              'ToolRegistry',
              'ToolRoutingService',
              'VisionRepairApplicationService',
              'VoiceApplicationService',
              'VoicePlaybackService',
              'decodeModelRouteId',
              'encodeModelRouteId',
              'parseRemoteVisionModelId',
              'remoteVisionModelId',
            ],
            message:
              'Compose shared services through @offgrid/models/workspace, not in app code. Business logic lives in shared; this app is a port.',
            allowTypeImports: true,
          },
        ],
        // Class 4, widened (HEXAGONAL_AUDIT_2026-09-03b M1, M10): a shared service class or a
        // `create*` factory imported as a value outside the roots is app-side composition, whatever
        // package it comes from; a deep entry of @offgrid/models is the second pipeline by another
        // door. Types stay free. `pro/**` keeps these at warn until its own composition root lands.
        patterns: [
          {
            group: ['@offgrid/models/*', '!@offgrid/models/workspace', '!@offgrid/models/catalog'],
            message:
              'Class 4: a deep entry of @offgrid/models bypasses the facade. Import from @offgrid/models, @offgrid/models/workspace, or @offgrid/models/catalog.',
            allowTypeImports: true,
          },
          {
            group: [
              '@offgrid/models',
              '@offgrid/sync',
              '@offgrid/use',
              '@offgrid/speech',
              '@offgrid/rag',
              '@offgrid/clipboard',
            ],
            importNamePattern:
              '^(create[A-Z]\\w*(Resolver|Session|Workspace|Service|Coordinator|Adapter|Engine|Ports?|Application|Runtime|Controller|Manager|Registry|Client|Bridge|Transport|Queue|Cache|Workflow)|[A-Z]\\w*(Service|Engine|Bridge|Transport|Timer|Coordinator|Orchestrator|Manager|Registry|Workflow|Cache|Queue|Controller|Authority|Client|Channel))$',
            message:
              'Class 4: a shared service class or create* factory is constructed only in src/services/composition/** (or workspace.ts). Import the composed instance instead.',
            allowTypeImports: true,
          },
        ],
      },
    ],
    // Code quality (built-in)
    'no-empty': 'error',
    'no-else-return': 'error',
    'prefer-template': 'error',
    // Dead-branch killers (the "AI leftover" class) — untyped, cheap, high signal, zero current hits.
    'no-unreachable': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-constant-binary-expression': 'error',
    complexity: ['error', 25],
    'max-lines-per-function': ['error', 350],
    'max-lines': ['error', 1000],
    'max-params': ['error', 5],
    // React hooks
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',

    // React Native
    'react-native/no-unused-styles': 'error',
    'react-native/no-inline-styles': 'error',
    'react-native/no-color-literals': 'error',
    'react-native/no-raw-text': 'error',
    'react-native/no-single-element-style-arrays': 'error',

    // SonarJS — every rule stays at the recommended `error` (a real forward guard on new code)
    // EXCEPT the two handled here:
    //  - no-duplicate-string OFF: it fights RN styling — 'space-between'/'center'/'row' and color
    //    literals repeat by design across StyleSheet objects; a constant per style value is noise,
    //    not clarity. The one low-value SonarJS rule for this codebase.
    //  - the rest are `warn` (already tripped on legacy core; burn-down in docs/GAPS_BACKLOG.md,
    //    ratchet each back to `error` as its count hits zero).
    'sonarjs/no-duplicate-string': 'off',
    'sonarjs/prefer-single-boolean-return': 'warn',
    'sonarjs/no-nested-template-literals': 'warn',
    'sonarjs/no-collapsible-if': 'warn',
    'sonarjs/prefer-immediate-return': 'warn',
    'sonarjs/no-duplicated-branches': 'warn',
  },
  overrides: [
    {
      // Pipeline decisions live in shared (MODEL_FACADE_PLAN.md "Defect classes"): request
      // parameters (1), route-id codecs (2), image MIME literals (3). Composition root and the
      // selection persistence ports are exempt.
      files: ['src/**/*.ts', 'src/**/*.tsx', 'pro/**/*.ts', 'pro/**/*.tsx'],
      excludedFiles: [
        '**/__tests__/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        'src/services/modelServices/workspace.ts',
        'src/services/composition/**',
        'pro/composition/**',
        'src/services/modelServices/mobileRoute.ts',
        'src/services/modelServices/selectionStore.ts',
        'src/services/modelServices/modelSelectionProjection.ts',
      ],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "Property[key.name=/^(maxTokens|temperature|topP|timeoutMs|allowFallback|partialOutputPolicy|steps|cfg|sampler|seed)$/][value.type='Literal'], Property[key.name='thinking'][value.type='Literal'][value.raw=/^(true|false)$/]",
            message:
              'Class 1: a generation parameter is a pipeline decision. Use a shared request builder or profile.',
          },
          {
            // A computed literal (`60 * 60_000`) or a default parameter (`timeoutMs = 120_000`) is the
            // same decision wearing a different node type.
            selector:
              "Property[key.name=/^(maxTokens|temperature|topP|timeoutMs)$/][value.type='BinaryExpression'], AssignmentPattern[left.name=/^(maxTokens|temperature|topP|timeoutMs)$/][right.type=/^(Literal|BinaryExpression)$/]",
            message:
              'Class 1: a generation parameter is a pipeline decision. Take it from a shared profile or policy; never compute or default it here.',
          },
          {
            selector: "Literal[value=/^image\\/(png|jpe?g|webp)$/]",
            message: 'Class 3: image MIME types are an artifact fact owned by shared.',
          },
          {
            selector: "Literal[value=/\\.(gguf|safetensors)$/i], Literal[regex.pattern=/\\\\.(gguf|safetensors)/]",
            message: 'Class 3: model file types are an artifact fact owned by shared (isGgufFile, MODEL_FILE_EXTENSION).',
          },
        ],
      },
    },
    {
      // The composition root is the ONE place shared services are constructed with this app's ports.
      files: [
        'src/services/modelServices/workspace.ts',
        'src/services/composition/**/*.ts',
        'pro/composition/**/*.ts',
        // Selection persistence ports: the ONE place mobile encodes and decodes its routes.
        'src/services/modelServices/mobileRoute.ts',
        'src/services/modelServices/selectionStore.ts',
        'src/services/modelServices/modelSelectionProjection.ts',
        // Tests are harnesses: they may compose shared services directly to prove the port.
        '__tests__/**/*.ts',
        '__tests__/**/*.tsx',
      ],
      rules: { '@typescript-eslint/no-restricted-imports': 'off' },
    },
    {
      // The ESM parser was scoped to `scripts/physical-sync/**` only, so `scripts/*.mjs` sat on
      // the default (non-module) parser where the first `import` is a syntax error - which meant
      // the ARCHITECTURE GATE ITSELF (`verify-model-architecture.mjs`) was the one file in this
      // repo that nothing linted. Widened to the top-level scripts, which is where the two gates
      // and the release notifier live, rather than duplicated into a second override.
      //
      // NOT widened to `scripts/**`: `scripts/e2e/**` and `scripts/ios/**` are also unparsed and
      // carry 5 real errors behind that, but they are test/harness infrastructure this seat may
      // not edit. Recorded in PROGRESS_B rather than silenced with an exclusion, because the
      // finding is real and belongs to whoever owns those scripts.
      files: ['scripts/*.mjs', 'scripts/physical-sync/**/*.mjs'],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      rules: {
        // Structural rules only, and for the same reason the test override below relaxes the same
        // four: a verification gate is one long flat list of INDEPENDENT rule checks, and
        // splitting it into modules scatters what has to be read together to know what is
        // enforced. Every correctness rule stays on - which is the point of linting this file at
        // all, and it immediately found a real shadowed binding in the allowlist loop.
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-params': 'off',
        complexity: 'off',
      },
    },
    {
      // Relax structural rules in test files — large test suites and helpers are acceptable
      files: [
        '__tests__/**/*',
        'scripts/physical-sync/__tests__/**/*.mjs',
        '*.test.ts',
        '*.test.tsx',
        'jest.setup.ts',
      ],
      rules: {
        'max-lines': 'off',
        'max-lines-per-function': 'off',
        'max-params': 'off',
        complexity: 'off',
        'react-native/no-inline-styles': 'off',
        'react-native/no-raw-text': 'off',
        'react-native/no-color-literals': 'off',
        // Duplicate test bodies (identical arrange/act across cases) are acceptable and clearer
        // than over-DRYing tests; the real-bug SonarJS rules (mischeck, unused-collection, etc.)
        // stay ON for tests — they caught a tautology assertion + a dead collection here.
        'sonarjs/no-identical-functions': 'off',
        'sonarjs/cognitive-complexity': 'off',
      },
    },
  ],
};
