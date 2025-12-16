/**
 * Alert Utility
 * 
 * Centralized alert system for consistent user feedback across the app.
 * Provides standardized alert structure and behavior.
 * 
 * Usage:
 * - showError(message) - For error messages
 * - showSuccess(message) - For success messages
 * - showInfo(message) - For informational messages
 * - showConfirm(options) - For confirmation dialogs with custom buttons
 */

import { Alert, AlertButton } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

/**
 * Show an error alert
 * @param message Error message to display
 * @param title Optional title (defaults to 'Error')
 */
export const showError = (message: string, title: string = 'Error'): void => {
  Alert.alert(
    title,
    message,
    [{ text: 'OK', style: 'default' }],
    { cancelable: true }
  );
};

/**
 * Show a success alert
 * @param message Success message to display
 * @param title Optional title (defaults to 'Success')
 */
export const showSuccess = (message: string, title: string = 'Success'): void => {
  Alert.alert(
    title,
    message,
    [{ text: 'OK', style: 'default' }],
    { cancelable: true }
  );
};

/**
 * Show an informational alert
 * @param message Info message to display
 * @param title Optional title (defaults to 'Info')
 */
export const showInfo = (message: string, title?: string): void => {
  Alert.alert(
    title || 'Info',
    message,
    [{ text: 'OK', style: 'default' }],
    { cancelable: true }
  );
};

/**
 * Show a confirmation dialog with custom actions
 * @param options Confirmation dialog options
 */
export const showConfirm = (options: ConfirmOptions): void => {
  const {
    title,
    message,
    onConfirm,
    onCancel,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    destructive = false,
  } = options;

  const buttons: AlertButton[] = [];
  if (cancelText) {
    buttons.push({
      text: cancelText,
      style: 'cancel',
      onPress: onCancel,
    });
  }
  buttons.push({
    text: confirmText,
    style: destructive ? 'destructive' : 'default',
    onPress: onConfirm,
  });

  Alert.alert(title, message, buttons, { cancelable: true });
};

/**
 * Show a simple alert with just a message (no title)
 * @param message Message to display
 */
export const showAlert = (message: string): void => {
  Alert.alert('', message, [{ text: 'OK', style: 'default' }], { cancelable: true });
};
