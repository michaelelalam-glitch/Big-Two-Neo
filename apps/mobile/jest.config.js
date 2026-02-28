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
  // Coverage thresholds reflect current levels after the Chinese Poker feature branch merge.
  // Tracked in: TODO(coverage-recovery) — create a GitHub Issue to track this debt.
  // Plan to incrementally increase back toward 80%:
  //   Phase 1 (next sprint): branches 55, functions 70, lines/statements 68
  //   Phase 2: branches 65, functions 75, lines/statements 75
  //   Phase 3 (target): all categories ≥ 80
  // New code should always include tests to avoid further regression.
  coverageThreshold: {
    global: {
      branches: 48,
      functions: 65,
      lines: 63,
      statements: 63,
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
