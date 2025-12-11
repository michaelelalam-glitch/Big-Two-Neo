/**
 * Logger Test - Verify react-native-logs configuration
 * Run this to test logger before deploying
 */

import log, { gameLogger, authLogger, statsLogger, notificationLogger, uiLogger, networkLogger, roomLogger } from './logger';

export function testLogger() {
  log.info('=== Logger Test Started ===');

  // Test base logger
  log.info('Testing base logger:');
  log.debug('Debug message');
  log.info('Info message');
  log.warn('Warning message');
  log.error('Error message');

  log.info('Testing namespaced loggers:');

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

  log.info('=== Logger Test Complete ===');
  log.info('✅ If you see colored/formatted logs above, logger is working!');
  log.info('✅ In production, logs will be written to file instead of console');
}

/**
 * How to run this test:
 * 
 * Option 1: Import and call in your app temporarily
 *   import { testLogger } from './src/utils/logger-manual-test';
 *   testLogger(); // Call once to see logger output
 * 
 * Option 2: Run directly with ts-node (if available)
 *   npx ts-node apps/mobile/src/utils/logger-manual-test.ts
 * 
 * Option 3: Invoke from React Native debugger console
 *   import('./src/utils/logger-manual-test').then(m => m.testLogger())
 */
