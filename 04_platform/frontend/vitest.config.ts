import { defineConfig } from 'vitest/config';

// Vitest auto-loads vite.config.ts when no vitest.config.* exists — and that config
// sets `root` to src/apps/driver, which would move test discovery inside the driver app
// and orphan the existing src/lib/sbg suites ("No test files found", exit 1).
// This file wins over vite.config.ts, so the test run stays byte-for-byte what it was:
// node environment, src/**/*.test.ts, no build plugins in the test path.
export default defineConfig({
  // JSX support for future .tsx component tests, via esbuild (no Babel in the test path).
  // A no-op for the plain .ts suites that exist today.
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Component tests that need a DOM should opt in per file with
    // `// @vitest-environment jsdom` (and jsdom must be installed first).
    environment: 'node',
  },
});
