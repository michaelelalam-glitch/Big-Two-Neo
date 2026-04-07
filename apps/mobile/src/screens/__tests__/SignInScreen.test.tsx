/**
 * Screen Smoke Tests — H16 Audit Fix
 *
 * Verifies priority screens render without crashing.
 * These are shallow render tests that mock heavy dependencies
 * and only assert that the screen component mounts successfully
 * with expected testIDs present.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ── Mock heavy dependencies ──────────────────────────────────────────────────

jest.mock('../../components/auth/AppleSignInButton', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="apple-sign-in-mock" /> };
});

jest.mock('../../components/auth/GoogleSignInButton', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="google-sign-in-mock" /> };
});

jest.mock('../../i18n', () => ({
  i18n: { t: (key: string) => key },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

import SignInScreen from '../SignInScreen';

describe('SignInScreen', () => {
  it('renders without crashing', () => {
    const { getByTestId } = render(<SignInScreen />);
    expect(getByTestId('sign-in-screen')).toBeTruthy();
  });

  it('shows title and subtitle', () => {
    const { getByTestId } = render(<SignInScreen />);
    expect(getByTestId('sign-in-title')).toBeTruthy();
    expect(getByTestId('sign-in-subtitle')).toBeTruthy();
  });

  it('shows footer text', () => {
    const { getByTestId } = render(<SignInScreen />);
    expect(getByTestId('sign-in-footer')).toBeTruthy();
  });

  it('renders Google sign-in button', () => {
    const { getByTestId } = render(<SignInScreen />);
    expect(getByTestId('google-sign-in-mock')).toBeTruthy();
  });
});
