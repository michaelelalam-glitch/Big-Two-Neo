/**
 * Logger Test - Verify react-native-logs configuration
 * Run this to test logger before deploying
 */

import log, { gameLogger, authLogger, statsLogger, notificationLogger, uiLogger, networkLogger, roomLogger } from './logger';

export function testLogger() {
  console.log('=== Logger Test Started ===\n');

  // Test base logger
  console.log('Testing base logger:');
  log.debug('Debug message');
  log.info('Info message');
  log.warn('Warning message');
  log.error('Error message');

  console.log('\nTesting namespaced loggers:');

  // Test all namespaced loggers
  gameLogger.debug('Game debug');
  gameLogger.info('Game info');
  
  authLogger.info('Auth info');
  authLogger.error('Auth error');
  
  statsLogger.info('Stats info');
  statsLogger.warn('Stats warning');
  
  notificationLogger.info('Notification info');
  notificationLogger.error('Notification error');
  
  uiLogger.info('UI info');
  uiLogger.warn('UI warning');
  
  networkLogger.info('Network info');
  networkLogger.error('Network error');
  
  roomLogger.info('Room info');
  roomLogger.debug('Room debug');

  console.log('\n=== Logger Test Complete ===');
  console.log('✅ If you see colored/formatted logs above, logger is working!');
  console.log('✅ In production, logs will be written to file instead of console');
}

// Auto-run test when imported in development
if (__DEV__) {
  testLogger();
}
