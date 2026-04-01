/**
 * Tests for BugReportModal component
 *
 * Covers:
 * - Empty description validation
 * - Photo-permission-denied path
 * - submitBugReportWithOptions and trackEvent called with correct payloads on submit
 */

import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import BugReportModal from '../BugReportModal';

// ─── Module mocks ──────────────────────────────────────────────────────────── //

jest.mock('../../services/sentry', () => ({
  submitBugReportWithOptions: jest.fn(),
  isSentryEnabled: jest.fn(() => true),
}));

jest.mock('../../services/analytics', () => ({
  trackEvent: jest.fn(),
  trackScreenView: jest.fn(),
  screenTimeStart: jest.fn(),
  screenTimeEnd: jest.fn(),
}));

jest.mock('../../utils', () => ({
  showSuccess: jest.fn(),
  showError: jest.fn(),
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock-doc-dir/',
  getInfoAsync: jest.fn(() => ({ exists: false })),
  readAsStringAsync: jest.fn(() => ''),
  EncodingType: { UTF8: 'utf8' },
}));

jest.mock('../../i18n', () => ({
  i18n: { t: (key: string) => key },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────── //

const { submitBugReportWithOptions } = require('../../services/sentry');
const { trackEvent } = require('../../services/analytics');
const { showError } = require('../../utils');
const ImagePicker = require('expo-image-picker');

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  userEmail: 'test@example.com',
  userName: 'TestUser',
};

// ─── Tests ─────────────────────────────────────────────────────────────────── //

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BugReportModal - validation', () => {
  it('shows error and does not submit when description is empty', async () => {
    const { getByText } = render(<BugReportModal {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('common.submit'));
    });

    expect(showError).toHaveBeenCalledWith('bugReportModal.descriptionRequired');
    expect(submitBugReportWithOptions).not.toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('BugReportModal - photo permission denied', () => {
  it('shows permission error when photo library access is denied', async () => {
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ status: 'denied' });

    const { getByText } = render(<BugReportModal {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('bugReportModal.attachScreenshot'));
    });

    await waitFor(() => {
      expect(showError).toHaveBeenCalledWith('bugReportModal.photoPermissionDenied');
    });
    expect(submitBugReportWithOptions).not.toHaveBeenCalled();
  });
});

describe('BugReportModal - successful submission', () => {
  it('calls submitBugReportWithOptions and trackEvent with correct payloads', async () => {
    const { getByText, getByPlaceholderText } = render(<BugReportModal {...defaultProps} />);

    // Enter description
    await act(async () => {
      fireEvent.changeText(
        getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
        'App crashes on startup'
      );
    });

    await act(async () => {
      fireEvent.press(getByText('common.submit'));
    });

    await waitFor(() => {
      expect(submitBugReportWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'App crashes on startup',
          category: 'Bug',
          email: 'test@example.com',
          name: 'TestUser',
        })
      );
      expect(trackEvent).toHaveBeenCalledWith(
        'bug_report_submitted',
        expect.objectContaining({
          category: 'Bug',
          has_screenshot: 'no',
          has_log: 'no',
        })
      );
    });
  });

  it('passes selected category in the submission payload', async () => {
    const { getByText, getByPlaceholderText } = render(<BugReportModal {...defaultProps} />);

    await act(async () => {
      fireEvent.press(getByText('bugReportModal.categorySuggestion'));
      fireEvent.changeText(
        getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
        'Would love dark mode'
      );
    });

    await act(async () => {
      fireEvent.press(getByText('common.submit'));
    });

    await waitFor(() => {
      expect(submitBugReportWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Suggestion' })
      );
    });
  });
});

describe('BugReportModal - screen time tracking', () => {
  const { screenTimeStart, screenTimeEnd, trackScreenView } = require('../../services/analytics');

  it('calls screenTimeStart and trackScreenView when modal becomes visible', async () => {
    render(<BugReportModal {...defaultProps} visible={true} />);
    await act(async () => {});
    expect(trackScreenView).toHaveBeenCalledWith('BugReportModal');
    expect(screenTimeStart).toHaveBeenCalledWith('BugReportModal');
  });

  it('calls screenTimeEnd when modal closes (visible changes to false)', async () => {
    const { rerender } = render(<BugReportModal {...defaultProps} visible={true} />);
    await act(async () => {
      rerender(<BugReportModal {...defaultProps} visible={false} />);
    });
    expect(screenTimeEnd).toHaveBeenCalledWith('BugReportModal');
  });

  it('calls screenTimeEnd on unmount while visible', async () => {
    const { unmount } = render(<BugReportModal {...defaultProps} visible={true} />);
    await act(async () => {
      unmount();
    });
    expect(screenTimeEnd).toHaveBeenCalledWith('BugReportModal');
  });
});
