import { logger, consoleTransport, fileAsyncTransport } from 'react-native-logs';

/**
 * Production-ready logger configuration
 * 
 * Features:
 * - Development: Colored console output with all levels
 * - Production: File logging with error+ levels only  
 * - Supports namespaces for different modules
 * - Async for better performance
 */

// Note: Conditional import causes type issues, so we conditionally configure instead
let FileSystem: any;
try {
  FileSystem = require('expo-file-system');
} catch (e) {
  // FileSystem not available, will use console transport only
}

// Define log levels
const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

// Separate configurations for dev and production
const devConfig = {
  levels,
  severity: 'debug' as const,
  transport: consoleTransport,
  transportOptions: {
    colors: {
      debug: 'blueBright' as const,
      info: 'greenBright' as const,
      warn: 'yellowBright' as const,
      error: 'redBright' as const,
    },
  },
  async: true,
  dateFormat: 'time' as const,
  printLevel: true,
  printDate: true,
  enabled: true,
};

const prodConfig = {
  levels,
  severity: 'error' as const,
  transport: FileSystem ? fileAsyncTransport : consoleTransport,
  transportOptions: FileSystem ? {
    FS: FileSystem,
    fileName: `app_logs_{date-today}.log`,
  } : {},
  async: true,
  dateFormat: 'time' as const,
  printLevel: true,
  printDate: true,
  enabled: true,
};

// Create the base logger with environment-specific config
// @ts-expect-error - The config object type (devConfig/prodConfig) does not strictly match the expected type for logger.createLogger due to conditional transport and transportOptions properties.
const log = logger.createLogger(__DEV__ ? devConfig : prodConfig);

// Export namespaced loggers for different modules
export const authLogger = log.extend('AUTH');
export const gameLogger = log.extend('GAME');
export const networkLogger = log.extend('NETWORK');
export const notificationLogger = log.extend('NOTIFY');
export const uiLogger = log.extend('UI');
export const statsLogger = log.extend('STATS');
export const roomLogger = log.extend('ROOM');

// Export the base logger as default
export default log;
