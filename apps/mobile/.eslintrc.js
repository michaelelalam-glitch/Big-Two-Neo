module.exports = {
  root: true,
  extends: [
    'expo',
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks', 'import'],
  rules: {
    // React rules
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    
    // TypeScript rules
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'warn', // Gradually address; strict typing is a separate initiative
    '@typescript-eslint/no-require-imports': 'error', // Prefer static imports; callsites using require() for graceful-degradation have inline disables
    
    // React Hooks rules
    'react-hooks/exhaustive-deps': 'warn', // Warn on missing deps; intentional exclusions use eslint-disable-next-line
    
    // Console rules — app uses structured logger; console is acceptable in dev/debug paths
    'no-console': 'off',
    
    // Import rules
    'import/order': 'off',
    'import/no-duplicates': 'warn',
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
  overrides: [
    {
      // Jest test files use require() extensively for jest.mock() and jest.requireActual() patterns
      files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', 'src/__tests__/setup.ts'],
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
      },
    },
  ],
};
