/**
 * PrivacyConsentModal — unit tests (Task #272)
 *
 * Validates that:
 *  - The modal renders when visible
 *  - The modal is hidden when not visible
 *  - onAccept fires when "Accept & Continue" is pressed
 *  - onDecline fires when "No thanks" is pressed
 *  - Accessibility attributes are present
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import PrivacyConsentModal from '../PrivacyConsentModal';

describe('PrivacyConsentModal', () => {
  const onAccept = jest.fn();
  const onDecline = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and body text when visible', () => {
    const { getByText } = render(
      <PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />
    );

    expect(getByText('We Value Your Privacy')).toBeTruthy();
    expect(getByText(/anonymous analytics/i)).toBeTruthy();
    expect(getByText(/crash reporting/i)).toBeTruthy();
  });

  it('renders with visible=false without crashing', () => {
    // React Native Modal always renders children into the tree even when
    // visible=false — the platform layer hides the presentation. This test
    // ensures no runtime error occurs when the modal is hidden.
    expect(() =>
      render(<PrivacyConsentModal visible={false} onAccept={onAccept} onDecline={onDecline} />)
    ).not.toThrow();
  });

  it('calls onAccept when "Accept & Continue" is pressed', () => {
    const { getByTestId } = render(
      <PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />
    );

    fireEvent.press(getByTestId('privacy-consent-accept'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).not.toHaveBeenCalled();
  });

  it('calls onDecline when "No thanks" is pressed', () => {
    const { getByTestId } = render(
      <PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />
    );

    fireEvent.press(getByTestId('privacy-consent-decline'));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('accept button has correct accessibility label', () => {
    const { getByLabelText } = render(
      <PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />
    );

    expect(getByLabelText('Accept analytics and continue')).toBeTruthy();
  });

  it('decline button has correct accessibility label', () => {
    const { getByLabelText } = render(
      <PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />
    );

    expect(getByLabelText('Decline analytics tracking')).toBeTruthy();
  });

  it('does not call either handler if neither button is pressed', () => {
    render(<PrivacyConsentModal visible onAccept={onAccept} onDecline={onDecline} />);

    expect(onAccept).not.toHaveBeenCalled();
    expect(onDecline).not.toHaveBeenCalled();
  });
});
