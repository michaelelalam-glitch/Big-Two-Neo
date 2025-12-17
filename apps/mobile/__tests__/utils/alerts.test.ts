/**
 * Tests for alert utilities
 */

import { Alert } from 'react-native';
import { showError, showSuccess, showInfo, showConfirm, showAlert } from '../../src/utils/alerts';

// Mock Alert.alert
jest.mock('react-native/Libraries/Alert/Alert', () => ({
  alert: jest.fn(),
}));

describe('Alert Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('showError', () => {
    it('calls Alert.alert with correct parameters using default title', () => {
      showError('Something went wrong');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Something went wrong',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });

    it('calls Alert.alert with custom title', () => {
      showError('Database error', 'Critical Error');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Critical Error',
        'Database error',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });
  });

  describe('showSuccess', () => {
    it('calls Alert.alert with correct parameters using default title', () => {
      showSuccess('Operation completed');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Success',
        'Operation completed',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });

    it('calls Alert.alert with custom title', () => {
      showSuccess('Profile updated', 'Done');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Done',
        'Profile updated',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });
  });

  describe('showInfo', () => {
    it('calls Alert.alert with correct parameters using default title', () => {
      showInfo('Did you know?');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Info',
        'Did you know?',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });

    it('calls Alert.alert with custom title', () => {
      showInfo('Maintenance scheduled', 'Announcement');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Announcement',
        'Maintenance scheduled',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });
  });

  describe('showConfirm', () => {
    it('creates 2-button dialog with default texts', () => {
      const onConfirm = jest.fn();
      const onCancel = jest.fn();
      
      showConfirm({
        title: 'Delete Item',
        message: 'Are you sure?',
        onConfirm,
        onCancel,
      });
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Item',
        'Are you sure?',
        [
          { text: 'Cancel', style: 'cancel', onPress: onCancel },
          { text: 'Confirm', style: 'default', onPress: onConfirm },
        ],
        { cancelable: true }
      );
    });

    it('creates dialog with custom button texts', () => {
      const onConfirm = jest.fn();
      
      showConfirm({
        title: 'Leave Room',
        message: 'Exit current room?',
        confirmText: 'Leave',
        cancelText: 'Stay',
        onConfirm,
      });
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Leave Room',
        'Exit current room?',
        [
          { text: 'Stay', style: 'cancel', onPress: undefined },
          { text: 'Leave', style: 'default', onPress: onConfirm },
        ],
        { cancelable: true }
      );
    });

    it('creates single-button dialog when cancelText is empty string', () => {
      const onConfirm = jest.fn();
      
      showConfirm({
        title: 'Game Over',
        message: 'You won!',
        confirmText: 'OK',
        cancelText: '',
        onConfirm,
      });
      
      // Should only have confirm button (no cancel button)
      expect(Alert.alert).toHaveBeenCalledWith(
        'Game Over',
        'You won!',
        [{ text: 'OK', style: 'default', onPress: onConfirm }],
        { cancelable: true }
      );
    });

    it('applies destructive styling to confirm button', () => {
      const onConfirm = jest.fn();
      
      showConfirm({
        title: 'Delete Account',
        message: 'This cannot be undone',
        confirmText: 'Delete',
        destructive: true,
        onConfirm,
      });
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Account',
        'This cannot be undone',
        [
          { text: 'Cancel', style: 'cancel', onPress: undefined },
          { text: 'Delete', style: 'destructive', onPress: onConfirm },
        ],
        { cancelable: true }
      );
    });

    it('respects cancelable=false option', () => {
      showConfirm({
        title: 'Required Action',
        message: 'Must acknowledge',
        confirmText: 'OK',
        cancelText: '',
        cancelable: false,
      });
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Required Action',
        'Must acknowledge',
        [{ text: 'OK', style: 'default', onPress: undefined }],
        { cancelable: false }
      );
    });

    it('handles missing optional callbacks', () => {
      showConfirm({
        title: 'Information',
        message: 'Just FYI',
      });
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Information',
        'Just FYI',
        [
          { text: 'Cancel', style: 'cancel', onPress: undefined },
          { text: 'Confirm', style: 'default', onPress: undefined },
        ],
        { cancelable: true }
      );
    });
  });

  describe('showAlert', () => {
    it('calls Alert.alert with empty title and message', () => {
      showAlert('Simple message');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        '',
        'Simple message',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });
  });

  describe('Edge Cases', () => {
    it('showConfirm with only required fields', () => {
      showConfirm({
        title: 'Title',
        message: 'Message',
      });
      
      expect(Alert.alert).toHaveBeenCalled();
    });

    it('showInfo with undefined title uses default', () => {
      showInfo('Test message');
      
      expect(Alert.alert).toHaveBeenCalledWith(
        'Info',
        'Test message',
        [{ text: 'OK', style: 'default' }],
        { cancelable: true }
      );
    });
  });
});
