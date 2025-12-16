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

/**
 * Options for confirmation dialog
 */
export interface ConfirmOptions {
  /** Title of the dialog */
  title: string;
  /** Message to display */
  message: string;
  /** Callback when confirm is pressed */
  onConfirm?: () => void;
  /** Callback when cancel is pressed */
  onCancel?: () => void;
  /** Text for the confirm button (defaults to 'Confirm') */
  confirmText?: string;
  /** Text for the cancel button (defaults to 'Cancel', pass empty string to hide) */
  cancelText?: string;
  /** If true, confirm button is styled as destructive (red on iOS, defaults to false) */
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
export const showInfo = (message: string, title: string = 'Info'): void => {
  Alert.alert(
    title,
    message,
    [{ text: 'OK', style: 'default' }],
    { cancelable: true }
  );
};

/**
 * Show a confirmation dialog with custom actions.
 *
 * By default, displays two buttons: 'Cancel' (left/bottom) and 'Confirm' (right/top).
 * To create a single-button dialog, pass an empty string for `cancelText`.
 * The `destructive` parameter applies red styling to the confirm button on iOS.
 *
 * @param options Confirmation dialog options:
 *   - title: Title of the dialog.
 *   - message: Message to display.
 *   - onConfirm: Callback when confirm is pressed.
 *   - onCancel: Callback when cancel is pressed.
 *   - confirmText: Text for the confirm button (default: 'Confirm').
 *   - cancelText: Text for the cancel button (default: 'Cancel'). Pass an empty string to hide.
 *   - destructive: If true, confirm button is styled as destructive (red on iOS, default: false).
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
