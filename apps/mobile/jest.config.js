module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.{ts,tsx}'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  globals: {
    'ts-jest': {
      tsconfig: {
        jsx: 'react',
      },
    },
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
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-reanimated|react-native-gesture-handler|react-native-worklets|react-native-safe-area-context|expo(-.*)?|@expo(-.*)?)/)',
  ],
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/game/__tests__/__mocks__/async-storage.ts',
    '^react-native$': '<rootDir>/src/game/__tests__/__mocks__/react-native.ts',
    '^react-native-safe-area-context$': '<rootDir>/src/game/__tests__/__mocks__/safe-area-context.ts',
    '^expo-haptics$': '<rootDir>/src/game/__tests__/__mocks__/expo-haptics.ts',
  },
};
