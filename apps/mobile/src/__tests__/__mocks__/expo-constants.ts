/**
 * Mock for expo-constants — Jest test environment.
 */
module.exports = {
  __esModule: true,
  default: {
    expoConfig: {
      version: '1.0.0',
      name: 'Stephanos',
      slug: 'big2-mobile',
      extra: {
        eas: {
          // Deterministic test-friendly project ID used in places like push-token setup
          projectId: '00000000-0000-0000-0000-000000000000',
        },
      },
    },
    appOwnership: null,
    // Provide a deterministic execution environment for tests
    executionEnvironment: 'standalone',
    manifest: null,
  },
};
