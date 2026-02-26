module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  // Modern ts-jest config (globals.ts-jest is deprecated in ts-jest 29+).
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react',
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
