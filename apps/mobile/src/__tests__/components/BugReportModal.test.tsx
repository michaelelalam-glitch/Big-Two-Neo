/**
 * Unit tests for BugReportModal
 *
 * Covers:
 * - Empty description validation
 * - Sentry unavailable / permission-denied path
 * - submitBugReportWithOptions called with correct payload on submit
 * - trackEvent called with expected metadata on submit
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Mocks ────────────────────────────────────────────────────────────────── //

jest.mock('../../services/sentry', () => ({
  isSentryEnabled: jest.fn().mockReturnValue(true),
  submitBugReportWithOptions: jest.fn(),
}));

jest.mock('../../services/analytics', () => ({
  trackEvent: jest.fn(),
  trackScreenView: jest.fn(),
}));

jest.mock('../../utils', () => ({
  showSuccess: jest.fn(),
  showError: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  getTodayLogFileName: jest.fn().mockReturnValue('app_logs_2026-03-31.log'),
  uiLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// expo-file-system mock (also mapped via jest.config.js)
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/documents/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
  readAsStringAsync: jest.fn().mockResolvedValue('mock log content'),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

jest.mock('../../i18n', () => ({
  i18n: {
    t: (key: string) => key,
  },
}));

import { isSentryEnabled, submitBugReportWithOptions } from '../../services/sentry';
import { trackEvent } from '../../services/analytics';
import { showError, showSuccess } from '../../utils';
import BugReportModal from '../../components/BugReportModal';

// ─── Helpers ──────────────────────────────────────────────────────────────── //

const defaultProps = {
  visible: true,
  onClose: jest.fn(),
  userEmail: 'test@example.com',
  userName: 'Test User',
};

function renderModal(overrides = {}) {
  return render(<BugReportModal {...defaultProps} {...overrides} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────── //

beforeEach(() => {
  jest.clearAllMocks();
  (isSentryEnabled as jest.Mock).mockReturnValue(true);
});

describe('BugReportModal — validation', () => {
  it('shows error and does not submit when description is empty', async () => {
    const { getByTestId } = renderModal();
    // Submit without typing anything
    fireEvent.press(getByTestId('bug-report-submit'));
    await waitFor(() => {
      expect(showError).toHaveBeenCalledTimes(1);
      expect(submitBugReportWithOptions).not.toHaveBeenCalled();
    });
  });
});

describe('BugReportModal — Sentry unavailable', () => {
  it('shows error and does not submit when Sentry is disabled', async () => {
    (isSentryEnabled as jest.Mock).mockReturnValue(false);
    const { getByTestId, getByPlaceholderText } = renderModal();
    // Type a description
    fireEvent.changeText(
      getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
      'Something crashed'
    );
    fireEvent.press(getByTestId('bug-report-submit'));
    await waitFor(() => {
      expect(showError).toHaveBeenCalledTimes(1);
      expect(submitBugReportWithOptions).not.toHaveBeenCalled();
    });
  });
});

describe('BugReportModal — successful submission', () => {
  it('calls submitBugReportWithOptions with description and default category', async () => {
    const { getByTestId, getByPlaceholderText } = renderModal();
    fireEvent.changeText(
      getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
      'The app crashed when I played a flush.'
    );
    fireEvent.press(getByTestId('bug-report-submit'));
    await waitFor(() => {
      expect(submitBugReportWithOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'The app crashed when I played a flush.',
          category: 'Bug',
          email: 'test@example.com',
          name: 'Test User',
        })
      );
    });
  });

  it('calls trackEvent with bug_report_submitted and correct metadata', async () => {
    const { getByTestId, getByPlaceholderText } = renderModal();
    fireEvent.changeText(
      getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
      'Performance is slow.'
    );
    fireEvent.press(getByTestId('bug-report-submit'));
    await waitFor(() => {
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

  it('shows success toast after submission', async () => {
    const { getByTestId, getByPlaceholderText } = renderModal();
    fireEvent.changeText(
      getByPlaceholderText('bugReportModal.descriptionPlaceholder'),
      'Reproducible crash.'
    );
    fireEvent.press(getByTestId('bug-report-submit'));
    await waitFor(() => {
      expect(showSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
