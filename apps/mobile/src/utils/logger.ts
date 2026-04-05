import { logger, consoleTransport, fileAsyncTransport } from 'react-native-logs';

/**
 * Production-ready logger configuration
 *
 * Features:
 * - Development: Colored console output with all levels
 * - Production: File logging with warn+ levels (errors AND warnings)
 * - Supports namespaces for different modules
 * - Async for better performance
 *
 * Security Notes:
 * - File logs use date-based rotation (one file per day) to prevent unbounded growth
 * - Production logs capture warn/error levels only to minimize sensitive data exposure
 * - Always sanitize error objects before logging (use error.message, not full error object)
 *
 * Note: expo-file-system is optional - if not available, falls back to console in production
 */

// Dynamically import expo-file-system if available (graceful degradation)
// Using require() with try-catch allows optional peer dependencies without build failures
// This is standard practice for React Native optional dependencies (static bundlers handle this)
let FileSystem: typeof import('expo-file-system') | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- graceful degradation: optional peer dep; static import would cause build failure when module is absent
  FileSystem = require('expo-file-system');
} catch (error) {
  // FileSystem not available - will use console transport even in production
  // This is acceptable for environments where file system access is not available
  FileSystem = undefined;
  if (__DEV__) {
    console.warn('[Logger] expo-file-system not available - using console transport', error);
  }
}

// Define log levels — declared BEFORE sentryTransport so the reference is safe
// even though JS hoisting would technically allow a forward reference.
const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

// Sentry breadcrumb transport — used in production when FileSystem is unavailable.
// Routes warn/error logs to Sentry breadcrumbs so they appear in crash reports.
const sentryTransport: typeof consoleTransport = props => {
  // Lazy import to avoid circular dependency with sentry.ts
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    const severity = props.level?.severity;
    const message = typeof props.msg === 'string' ? props.msg : String(props.msg);
    Sentry.addBreadcrumb({
      message,
      level: severity === levels.error ? 'error' : 'warning',
      category: 'logger',
    });
  } catch {
    // Sentry not available — fall back to console
    consoleTransport(props);
  }
};

// Separate configurations for dev and production
// Colors are enabled on all platforms. sentry.ts `beforeBreadcrumb` already
// strips ANSI escape codes from console breadcrumbs before they are serialised
// to JSON, so enabling colors on native is safe.
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
  severity: 'warn' as const, // Capture warn + error in production (important events)
  transport: FileSystem ? fileAsyncTransport : sentryTransport,
  transportOptions: FileSystem
    ? {
        FS: FileSystem,
        fileName: 'app_logs_{date-today}.log', // Date-based rotation (react-native-logs built-in placeholder syntax)
      }
    : {},
  async: true,
  dateFormat: 'time' as const,
  printLevel: true,
  printDate: true,
  enabled: true,
};

// Note: @ts-expect-error is necessary because:
// 1. react-native-logs has complex conditional types for transport/transportOptions
// 2. Our runtime dynamic config selection (__DEV__ ? devConfig : prodConfig) creates type conflicts
// 3. The library's types expect static config, but we provide conditional config
// 4. This is safe - we follow the library's documented API patterns exactly
// Alternative approaches (creating union types, separate createLogger calls) would duplicate code
// and reduce maintainability without improving type safety in this specific case.

// Create the base logger with environment-specific config
// @ts-expect-error - runtime dynamic config creates type conflicts with library's conditional types
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

/**
 * Returns the filename used by the production file transport for today's log.
 * Centralised here so the filename format stays in sync between the writer
 * (the transport's `{date-today}` placeholder, which react-native-logs
 * resolves to YYYY-MM-DD) and any reader (e.g. BugReportModal).
 */
export function getTodayLogFileName(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `app_logs_${yyyy}-${mm}-${dd}.log`;
}
