/**
 * Logger Test - Verify react-native-logs configuration
 * 
 * Usage: Import and call testLogger() explicitly from your test runner or script:
 *   import { testLogger } from './utils/logger.test';
 *   testLogger();
 * 
 * DO NOT auto-run on import - tests should be explicit.
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
