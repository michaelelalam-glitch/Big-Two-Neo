import { logger, consoleTransport, fileAsyncTransport } from 'react-native-logs';

/**
 * Production-ready logger configuration
 * 
 * Features:
 * - Development: Colored console output with all levels
 * - Production: File logging with error+ levels only  
 * - Supports namespaces for different modules
 * - Async for better performance
 * 
 * Note: expo-file-system is optional - if not available, falls back to console in production
 */

// Dynamically import expo-file-system if available (graceful degradation)
// Using require() with try-catch allows optional peer dependencies without build failures
// This is standard practice for React Native optional dependencies
let FileSystem: any;
try {
  FileSystem = require('expo-file-system');
} catch (e) {
  // FileSystem not available - will use console transport even in production
  // This is acceptable for environments where file system access is not available
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
// Using 'as any' here because react-native-logs has complex conditional types that conflict
// with our runtime conditional logic (dev vs prod, with/without FileSystem).
// The library's type system expects static config but we're providing dynamic conditional config.
// This is safe because we're following the library's documented API patterns.
const log = logger.createLogger(__DEV__ ? devConfig : prodConfig as any);

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
