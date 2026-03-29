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
  // Thresholds ratcheted +2% per sprint toward 80%+ target (Task #617, Mar 2026).
  // Sprint 1 bump: branches 78→80, functions 76→78, lines 76→78, statements 76→78
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 78,
      lines: 78,
      statements: 78,
    },
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|react-native-reanimated|react-native-gesture-handler|react-native-worklets|react-native-safe-area-context|expo|expo-av|expo-audio|expo-screen-orientation|@expo|@react-navigation|@sentry)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  moduleNameMapper: {
    '\\.(m4a|mp3|wav|ogg|aac)$': '<rootDir>/src/__tests__/__mocks__/audioFile.ts',
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/game/__tests__/__mocks__/async-storage.ts',
    '^react-native$': '<rootDir>/src/game/__tests__/__mocks__/react-native.ts',
    '^react-native-safe-area-context$': '<rootDir>/src/game/__tests__/__mocks__/safe-area-context.ts',
    '^react-native-svg$': '<rootDir>/src/__tests__/__mocks__/react-native-svg.ts',
    '^expo-haptics$': '<rootDir>/src/game/__tests__/__mocks__/expo-haptics.ts',
    '^expo-av$': '<rootDir>/src/__tests__/__mocks__/expo-av.ts',
    '^expo-audio$': '<rootDir>/src/__tests__/__mocks__/expo-audio.ts',
    '^expo-screen-orientation$': '<rootDir>/src/__tests__/__mocks__/expo-screen-orientation.ts',
    '^expo-clipboard$': '<rootDir>/src/__tests__/__mocks__/expo-clipboard.ts',
    '^expo-camera$': '<rootDir>/src/__tests__/__mocks__/expo-camera.ts',
    '^@livekit/react-native-webrtc$': '<rootDir>/src/__tests__/__mocks__/livekit-react-native-webrtc.ts',
    // @sentry/react-native uses native modules — mock entirely in tests
    '^@sentry/react-native$': '<rootDir>/src/__tests__/__mocks__/sentry-react-native.ts',
    // expo-constants accesses native config — use lightweight mock
    '^expo-constants$': '<rootDir>/src/__tests__/__mocks__/expo-constants.ts',
    // expo-file-system uses ESM `export *` syntax which breaks Jest's CJS require().
    // The logger.ts try/catch gracefully degrades when it's absent; this mock
    // prevents Jest from attempting to load the real module in CI (pnpm hoists it
    // to a nested path not covered by transformIgnorePatterns).
    '^expo-file-system$': '<rootDir>/src/__tests__/__mocks__/expo-file-system.ts',
    '^../../services/supabase$': '<rootDir>/src/__tests__/__mocks__/supabase.ts',
    '^../services/supabase$': '<rootDir>/src/__tests__/__mocks__/supabase.ts',
    '^../../services/pushNotificationTriggers$': '<rootDir>/src/__tests__/__mocks__/pushNotificationTriggers.ts',
    '^../services/pushNotificationTriggers$': '<rootDir>/src/__tests__/__mocks__/pushNotificationTriggers.ts',
  },
};
