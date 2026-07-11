/**
 * @file AvenxLogger.js
 * @description Centralized logging module for the Avenx-JS framework.
 * Supports trace, debug, info, warn, error, fatal log levels, alias log -> info,
 * global silent/off option, custom formatters, and custom transports.
 */

export const LogLevels = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
  off: 6,
  silent: 6,
};

/**
 * Default formatter for browser runtime.
 * Prefixes messages with [Avenx level].
 * Preserves interactive object logs by prepending to string or prepending as separate arg.
 * @param {string} level - Log level name.
 * @param {any[]} args - Array of raw arguments.
 * @returns {any[]} Array of formatted arguments.
 */
export function defaultFormatter(level, args) {
  const prefix = `[Avenx ${level}]`;
  if (args.length > 0) {
    if (typeof args[0] === 'string') {
      return [`${prefix} ${args[0]}`, ...args.slice(1)];
    }
    if (args[0] instanceof Error) {
      return args;
    }
  }
  return [prefix, ...args];
}

/**
 * Default console transport.
 * Dispatches messages to console methods dynamically.
 */
export const consoleTransport = {
  log(level, formattedArgs) {
    const method = level === 'fatal' ? 'error' : level === 'trace' ? 'debug' : console[level] ? level : 'log';
    if (typeof console !== 'undefined' && console[method]) {
      console[method](...formattedArgs);
    }
  },
};

/**
 * @typedef {Object} LoggingConfig
 * @property {('trace'|'debug'|'info'|'warn'|'error'|'fatal')} [level='info'] - The minimum severity level to output.
 * @property {boolean} [silent=false] - Global silence setting. If true, suppresses all logging.
 * @property {Function} [formatter=defaultFormatter] - Custom formatting callback function. Receives (level, args).
 * @property {Array<Object|Function>} [transports=[consoleTransport]] - Collection of transport targets.
 */

/**
 * Central logger class for Avenx-JS framework.
 * @example
 * // 1. Basic initialization during application setup:
 * const app = new AvenxApp({
 *   logging: {
 *     level: 'debug',
 *     silent: false
 *   }
 * });
 * @example
 * // 2. Usage inside component methods:
 * import { logger } from 'avenx-core/runtime';
 *
 * export default {
 *   name: 'TargetSyncComponent',
 *   methods: {
 *     async syncDatabase(targets) {
 *       logger.info('Starting celestial synchronization...', { count: targets.length });
 *       try {
 *         if (!targets || targets.length === 0) {
 *           logger.warn('Sync skipped: list is empty.');
 *           return;
 *         }
 *         logger.debug('Processing batch.', { sampleId: targets[0].id });
 *       } catch (error) {
 *         logger.error('Database sync failed.', { error: error.message });
 *       }
 *     }
 *   }
 * };
 * @example
 * // 3. Registering a Custom Formatter:
 * const customFormatter = (level, args) => {
 *   return [`[MY-APP] [${level.toUpperCase()}]:`, ...args];
 * };
 * const loggerWithFormatter = new AvenxLogger({ formatter: customFormatter });
 * @example
 * // 4. Registering a Custom Transport:
 * const fileTransport = {
 *   log(level, formattedArgs, rawArgs) {
 *     // Append custom streaming/file logic here
 *     fs.appendFileSync('./app.log', formattedArgs.join(' ') + '\n');
 *   }
 * };
 * const loggerWithTransport = new AvenxLogger({ transports: [fileTransport] });
 */
export class AvenxLogger {
  /**
   * Creates an instance of AvenxLogger.
   * @param {object} [config] - Application logger configuration options.
   */
  constructor(config = {}) {
    this.config = {
      level: 'info',
      silent: false,
      formatter: defaultFormatter,
      transports: [consoleTransport],
    };
    this.configure(config);
  }

  /**
   * Configures the logger instance options.
   * @param {object} config - Configuration options.
   */
  configure(config) {
    if (!config) return;
    this.config = {
      ...this.config,
      ...config,
    };
    // Ensure lowercase for level
    if (typeof this.config.level === 'string') {
      this.config.level = this.config.level.toLowerCase();
    }
  }

  /**
   * Helper to check if a specific level should be logged.
   * @param {string} level - Log level to test.
   * @returns {boolean} True if logger should log the given level.
   */
  shouldLog(level) {
    if (this.config.silent || this.config.level === 'silent' || this.config.level === 'off') {
      return false;
    }
    const currentPriority = LogLevels[this.config.level] !== undefined ? LogLevels[this.config.level] : LogLevels.info;
    const targetPriority = LogLevels[level] !== undefined ? LogLevels[level] : LogLevels.info;
    return targetPriority >= currentPriority;
  }

  /**
   * Writes the log statement through configured formatter and transports.
   * @param {string} level - Log level name.
   * @param {...any} args - Arguments to log.
   */
  write(level, ...args) {
    if (!this.shouldLog(level)) {
      return;
    }
    const formatted = this.config.formatter ? this.config.formatter(level, args) : args;

    const transports = Array.isArray(this.config.transports) ? this.config.transports : [consoleTransport];
    for (const transport of transports) {
      if (typeof transport === 'function') {
        transport(level, formatted, args);
      } else if (transport && typeof transport.log === 'function') {
        transport.log(level, formatted, args);
      }
    }
  }

  /**
   * Logs a message with trace level.
   * @param {...any} args - Arguments to log.
   */
  trace(...args) {
    this.write('trace', ...args);
  }

  /**
   * Logs a message with debug level.
   * @param {...any} args - Arguments to log.
   */
  debug(...args) {
    this.write('debug', ...args);
  }

  /**
   * Logs a message with info level.
   * @param {...any} args - Arguments to log.
   */
  info(...args) {
    this.write('info', ...args);
  }

  /**
   * Alias for info level logging.
   * @param {...any} args - Arguments to log.
   */
  log(...args) {
    this.write('info', ...args);
  }

  /**
   * Logs a message with warn level.
   * @param {...any} args - Arguments to log.
   */
  warn(...args) {
    this.write('warn', ...args);
  }

  /**
   * Logs a message with error level.
   * @param {...any} args - Arguments to log.
   */
  error(...args) {
    this.write('error', ...args);
  }

  /**
   * Logs a message with fatal level.
   * @param {...any} args - Arguments to log.
   */
  fatal(...args) {
    this.write('fatal', ...args);
  }
}

export const logger = new AvenxLogger();
