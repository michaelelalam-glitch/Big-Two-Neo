module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  setupFiles: ['./node_modules/react-native-reanimated/src/reanimated2/jestUtils.js'],
  collectCoverageFrom: [
    'src/game/**/*.ts',
    '!src/game/**/*.test.ts',
    '!src/game/**/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@react-native-async-storage/async-storage$': '<rootDir>/src/game/__tests__/__mocks__/async-storage.ts',
  },
};
