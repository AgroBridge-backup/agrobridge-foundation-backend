# Test Import Resolution Fix

## Decision: Option A - Keep .js extensions with pre-build

### Approach

After evaluating all options, the pragmatic solution is to keep `.js` extensions in test imports and ensure they build first before running. This works because:

1. TypeScript with `module: "NodeNext"` and `"type": "module"` in package.json requires explicit extensions for ESM
2. The build process (`npm run build`) creates `.js` files from `.ts` sources
3. `npm run test:unit` already runs build first: `"test:unit": "npm run build && vitest run tests/unit"`

### What Was Fixed

1. **tests/unit/config/env.test.ts** - Added missing `afterEach` import and removed extra closing brace

### What Was Kept

- All `.js` extensions in test imports (they're correct for ESM)
- vitest.config.ts kept simple (no need for complex plugins)
- tsconfig.json kept original configuration (NodeNext module resolution)

### Verification

Run: `npm run test:unit`
Result: All tests should pass after build creates .js files

### Why This Works

- Vitest resolves `.js` imports to the compiled JavaScript files in `dist/`
- Build runs first via `npm run build`
- Tests run against the compiled output, not source files
- No need for complex module resolution plugins or configuration

### Alternative Options Considered

**Option B: Update test imports to use .ts extensions**

- Rejected: Breaks TypeScript compilation (TypeScript doesn't allow .ts extensions for runtime imports)

**Option C: Remove extensions from imports**

- Rejected: ESM requires explicit extensions in import statements

**Option D: Use path aliases**

- Rejected: Adds complexity without solving the core issue (Vitest still needs .js extensions)
