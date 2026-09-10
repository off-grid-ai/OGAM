/**
 * dependency-cruiser — the STANDING GATE for the architectural boundaries we keep
 * re-establishing by hand in review (layering, engine DIP, dead code, cycles, dep hygiene).
 *
 * AGGRESSIVE by design: rules are strict and at `error`. It sees the IMPORT GRAPH, not values —
 * so it enforces "a screen may not import a concrete engine service" (the SO2/SO4 class, at the
 * bad import) and "utils/services may not import UI" (the DR1 backward-layering class), but it
 * does NOT catch the `engine === 'litert'` VALUE branch (an ESLint no-restricted-syntax rule
 * guards that) or DRY drift / logic bugs. Complements the hygiene standard; does not replace it.
 *
 * The tree is CLEAN — zero violations, no baseline file. Every rule is fully enforced; any new
 * violation fails `npm run depcruise` (CI + pre-push). The one static-analysis boundary is
 * `applicationFacade.ts`: it is a late-bound composition locator whose deferred `require` prevents
 * a runtime initialization cycle. Dependency Cruiser treats it as a leaf so it does not expand one
 * intentional locator edge into every possible path through the composed application graph.
 * If you ever must adopt
 * a new strict rule onto legacy debt, baseline it (`depcruise --output-type baseline >
 * .dependency-cruiser-known-violations.json` + run the gate with `--ignore-known`) and burn it
 * down — never regenerate a baseline to hide a fresh violation.
 */
module.exports = {
  forbidden: [
    // ── Architecture: layering + DIP ──────────────────────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Import cycles make load order undefined and desync-prone. Break the cycle (import the concrete module, not the barrel; extract shared state down a layer).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-backward-layering-core',
      severity: 'error',
      comment: 'Core (utils/services/stores/types/constants/config) must not import UI (screens/components/navigation). If a screen owns logic the core needs, move the logic DOWN (see DR1: parseModelOutput → utils).',
      from: { path: '^src/(utils|services|stores|types|constants|config)/' },
      to: { path: '^src/(screens|components|navigation)/' },
    },
    {
      name: 'utils-stay-pure',
      severity: 'error',
      comment: 'src/utils is the zero-IO pure layer — it must not depend on services or stores. Pure logic here is unit-testable without mocking I/O (hygiene §A).',
      from: { path: '^src/utils/' },
      to: { path: '^src/(services|stores)/', pathNot: '^src/utils/' },
    },
    {
      name: 'engine-dip-no-concrete-in-ui',
      severity: 'error',
      comment: 'UI (screens/components) must depend on the engine ABSTRACTION (services/engines), never a concrete engine service (services/litert, services/llm). Branching on a concrete engine in a caller is the DIP violation we keep fixing (SO2/SO4). Route through services/engines.',
      from: { path: '^src/(screens|components)/' },
      to: { path: '^src/services/(litert|llm)(/|\\.|$)' },
    },
    {
      name: 'components-are-leaf-ui',
      severity: 'error',
      comment: 'Reusable components must not import screens or navigation — a leaf UI piece depending on a whole screen inverts the dependency and creates cycles. Lift shared bits into components/ or pass them in as props.',
      from: { path: '^src/components/' },
      to: { path: '^src/(screens|navigation)/' },
    },
    // ── Dead code ─────────────────────────────────────────────────────────────
    // ── Application facade boundary ──
    {
      name: 'presentation-not-to-raw-rag-use-or-speech',
      severity: 'error',
      comment: 'Presentation reads RAG, Use, and Speech through @offgrid/application facades. Shared domain packages are composition and platform-adapter dependencies, not UI or store dependencies.',
      from: { path: '^(src/(screens|components|hooks|stores)/|pro/ui/)' },
      to: { path: '^\\.\\./shared/packages/(rag|use|speech)/' },
    },
    {
      name: 'presentation-not-to-raw-models',
      severity: 'error',
      comment: 'Presentation reads Models through @offgrid/application. Raw Models imports are limited to explicit composition and platform-adapter paths.',
      from: {
        path: '^(src/(screens|components|hooks|stores)/|pro/ui/)',
        pathNot: '^src/services/(adapters|composition)/',
      },
      to: {
        path: '^(node_modules/@offgrid/models/|\\.\\./shared/packages/models/)',
      },
    },
    {
      name: 'presentation-not-to-raw-sync',
      severity: 'error',
      comment: 'Presentation reads Sync through @offgrid/application. Raw Sync imports stay in explicit composition and platform-adapter seams, which are outside this presentation scope.',
      from: { path: '^(src/(screens|components|hooks|stores)/|pro/ui/)' },
      to: {
        path: '^(node_modules/@offgrid/sync/|@offgrid/sync(?:/|$)|\\.\\./shared/packages/sync/)',
      },
    },
    {
      name: 'presentation-not-to-raw-automation',
      severity: 'error',
      comment: 'Presentation reads Automation through @offgrid/application. Raw Automation imports stay in explicit composition and platform-adapter seams, which are outside this presentation scope.',
      from: { path: '^(src/(screens|components|hooks|stores)/|pro/ui/)' },
      to: {
        path: '^(node_modules/@offgrid/automation/|@offgrid/automation(?:/|$)|\\.\\./shared/packages/automation/)',
      },
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment: 'Orphan module (no importers, imports nothing relevant) — dead code. Confirm with grep, then delete (the standing dead-code gate that retires the manual recon).',
      from: {
        orphan: true,
        pathNot: [
          '\\.(d\\.ts)$',
          '(^|/)index\\.(ts|tsx)$', // barrel/entry files
          '^src/types/', // type barrels are legitimately import-only
          '^src/(bootstrap|shims|config)/', // wiring/shim/config shells reached outside the graph
          // Core utilities whose only importers are in the private pro/ submodule. The cruiser scans src
          // alone, so a module used exclusively by pro reads as an orphan even though deleting it would
          // break the build - coalesce is imported by pro/sync/fileTransferService and
          // pro/sync/ambientShareService; lazy is the public proxy used by Pro composition services.
          // Same reasoning as the @offgrid/pro exception below: not real debt, so excluded rather than
          // baselined. Confirm with grep in pro/ before adding to this list.
          '^src/utils/coalesce\\.ts$',
          '^src/services/composition/lazy\\.ts$',
        ],
      },
      to: {},
    },
    // ── Test / build hygiene ──────────────────────────────────────────────────
    {
      name: 'not-to-test-from-prod',
      severity: 'error',
      comment: 'Production code (src) must not import test files or test utilities — that ships test-only code (and its mocks) into the app bundle.',
      from: { path: '^src/', pathNot: '\\.(test|spec)\\.[jt]sx?$' },
      to: { path: '(\\.(test|spec)\\.[jt]sx?$|^(__tests__|__mocks__)/)' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment: 'Production code (src) must not import a devDependency — it will be missing in the release bundle. Move the package to dependencies, or the import out of src.',
      from: { path: '^src/', pathNot: '\\.(test|spec)\\.[jt]sx?$' },
      to: { dependencyTypes: ['npm-dev'], pathNot: '(@types/|typescript$)' },
    },
    {
      name: 'no-phantom-deps',
      severity: 'error',
      comment: 'Imports a package that is not declared in package.json (a phantom/transitive dependency) — it breaks the moment the transitive graph changes. Declare it explicitly.',
      from: {},
      to: {
        dependencyTypes: ['unknown', 'undetermined', 'npm-no-pkg', 'npm-unknown'],
        // Known non-resolvable-by-cruiser but LEGITIMATE: whisper.rn IS declared (^0.5.5) but the
        // `.rn` name defeats cruiser's resolver; @offgrid/pro is the private open-core submodule
        // wired via metro haste through the ONE bootstrap loader (loadProFeatures) — intentional,
        // not a phantom dep. Neither is real debt, so exclude rather than baseline.
        pathNot: '(^whisper\\.rn(/|$)|^@offgrid/pro(/|$))',
      },
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment: 'Depends on a deprecated Node core module (e.g. punycode) — will break on a future runtime. Replace it.',
      from: {},
      to: { dependencyTypes: ['core'], path: '^(punycode|domain|constants|sys|_linklist|_stream_wrap)$' },
    },
  ],
  options: {
    // Keep file-linked workspace packages under node_modules so dependency-cruiser can
    // classify them from this package.json instead of treating their real paths as
    // undeclared source files outside the mobile project.
    preserveSymlinks: true,
    doNotFollow: {
      path: '^(node_modules|src/services/applicationFacade\\.ts$)',
    },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
