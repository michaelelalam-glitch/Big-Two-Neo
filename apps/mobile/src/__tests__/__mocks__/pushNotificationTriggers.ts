/**
 * Mock for pushNotificationTriggers service
 * Prevents supabase initialization errors in tests
 */

export const triggerPlayerInvitedNotification = jest.fn(() => Promise.resolve());
export const triggerGameStartNotification = jest.fn(() => Promise.resolve());
export const triggerYourTurnNotification = jest.fn(() => Promise.resolve());
export const triggerGameEndNotification = jest.fn(() => Promise.resolve());
export const triggerRoomClosedNotification = jest.fn(() => Promise.resolve());

export default {
  triggerPlayerInvitedNotification,
  triggerGameStartNotification,
  triggerYourTurnNotification,
  triggerGameEndNotification,
  triggerRoomClosedNotification,
};
