/**
 * Mock for @sentry/react-native — Jest test environment.
 *
 * Prevents native module resolution errors in Jest while keeping
 * test assertions on Sentry's API surface functional.
 */

const Scope = class {
  setTag = jest.fn().mockReturnThis();
  setExtra = jest.fn().mockReturnThis();
  setLevel = jest.fn().mockReturnThis();
};

const mockSentry = {
  init: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  setUser: jest.fn(),
  withErrorBoundary: (component: unknown) => component,
  reactNativeTracingIntegration: jest.fn(() => ({})),
  Scope,
};

module.exports = {
  ...mockSentry,
  default: mockSentry,
};
