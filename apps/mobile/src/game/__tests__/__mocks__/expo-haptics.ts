/**
 * Mock for expo-haptics
 * Used in Jest tests
 */

export enum ImpactFeedbackStyle {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
}

export enum NotificationFeedbackType {
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

export const impactAsync = jest.fn(async (_style: ImpactFeedbackStyle) => {
  return Promise.resolve();
});

export const notificationAsync = jest.fn(async (_type: NotificationFeedbackType) => {
  return Promise.resolve();
});

export const selectionAsync = jest.fn(async () => {
  return Promise.resolve();
});
