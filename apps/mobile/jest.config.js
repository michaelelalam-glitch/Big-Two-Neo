module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Deterministic cache path so GitHub Actions can persist the ts-jest transform
  // cache between runs. Without this, Jest uses a temp directory that is lost on
  // every CI run, causing a 10-15 minute cold-start recompilation of all .ts/.tsx files.
  cacheDirectory: '<rootDir>/.jest-cache',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // Use v8 coverage provider — significantly faster than the default babel provider,
  // which avoids CI hangs caused by slow coverage serialization on resource-constrained runners.
  coverageProvider: 'v8',
  // Prevent OOM on CI runners by recycling workers that exceed 512MB.
  workerIdleMemoryLimit: '512MB',
  // Modern ts-jest config (globals.ts-jest is deprecated in ts-jest 29+).
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
          // Skip type-checking during transforms — tsc --noEmit already enforces
          // type safety in a separate CI step. Without this, ts-jest uses
          // ts.createProgram (full program analysis) instead of ts.transpileModule
          // (per-file compilation), causing 12+ minute cold-start on 2-vCPU CI runners.
          // Must be in this inline tsconfig (not project tsconfig.json) because
          // ts-jest uses object configs directly without extending the project file.
          isolatedModules: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/game/**/*.ts',
    'src/components/scoreboard/**/*.{ts,tsx}',
    'src/contexts/ScoreboardContext.tsx',
    '!src/game/**/*.test.ts',
    '!src/game/**/index.ts',
    '!src/components/scoreboard/**/*.test.{ts,tsx}',
    '!src/components/scoreboard/**/index.ts',
    '!src/components/scoreboard/styles/**',
  ],
  // Coverage thresholds ratcheted to actuals (Feb 2026 CI audit).
  // Actual: Stmts 78.64 | Branch 80.87 | Funcs 79.43 | Lines 78.64
  // Thresholds set ~3 pts below actuals as a safety margin.
  // Target: all categories ≥ 80 — almost there!
  coverageThreshold: {
    global: {
      branches: 78,
      functions: 76,
      lines: 76,
      statements: 76,
    },
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|react-native-gesture-handler|react-native-worklets|react-native-safe-area-context|expo|expo-av|expo-screen-orientation|@expo|@react-navigation)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/game/__tests__/__mocks__/async-storage.ts',
    '^react-native$': '<rootDir>/src/game/__tests__/__mocks__/react-native.ts',
    '^react-native-safe-area-context$': '<rootDir>/src/game/__tests__/__mocks__/safe-area-context.ts',
    '^expo-haptics$': '<rootDir>/src/game/__tests__/__mocks__/expo-haptics.ts',
    '^expo-av$': '<rootDir>/src/__tests__/__mocks__/expo-av.ts',
    '^expo-screen-orientation$': '<rootDir>/src/__tests__/__mocks__/expo-screen-orientation.ts',
    '^../../services/supabase$': '<rootDir>/src/__tests__/__mocks__/supabase.ts',
    '^../services/supabase$': '<rootDir>/src/__tests__/__mocks__/supabase.ts',
    '^../../services/pushNotificationTriggers$': '<rootDir>/src/__tests__/__mocks__/pushNotificationTriggers.ts',
    '^../services/pushNotificationTriggers$': '<rootDir>/src/__tests__/__mocks__/pushNotificationTriggers.ts',
  },
};
