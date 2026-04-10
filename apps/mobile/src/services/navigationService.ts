/**
 * navigationService — minimal singleton navigation ref for use outside React components.
 *
 * Usage:
 *  1. Call `setNavigator(ref)` once after the NavigationContainer mounts (in AppNavigator.tsx).
 *  2. Call `navigate(name, params)` from non-component code (e.g. notificationService).
 */
import type { NavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';

let _navigator: NavigationContainerRef<RootStackParamList> | null = null;

/** Register the navigator ref. Called once from AppNavigator after the container mounts. */
export function setNavigator(ref: NavigationContainerRef<RootStackParamList> | null) {
  _navigator = ref;
}

/** Navigate to a screen from outside a React component. No-op when navigator is not ready. */
export function navigate<RouteName extends keyof RootStackParamList>(
  ...args: RootStackParamList[RouteName] extends undefined
    ? [screen: RouteName]
    : [screen: RouteName, params: RootStackParamList[RouteName]]
): void {
  if (!_navigator?.isReady()) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_navigator.navigate as any)(...args);
}
