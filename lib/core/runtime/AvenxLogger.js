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
 * Formats component context metadata (componentName, fileName) into a diagnostic tag.
 * @param {object} context - Context object or component instance.
 * @returns {string} Formatted context tag string or empty string.
 */
export function formatContextTag(context) {
  if (!context || typeof context !== 'object' || context instanceof Error) {
    return '';
  }

  let compName = context.componentName;
  if (!compName && context.component) {
    const comp = context.component;
    compName = comp.componentName || comp.name || (comp.constructor && comp.constructor.name !== 'Object' && comp.constructor.name !== 'Function' ? comp.constructor.name : null);
  }
  if (!compName && context.name && context.name !== 'Error' && !context.name.endsWith('Error')) {
    compName = context.name;
  }
  if (!compName && context.constructor && context.constructor.name !== 'Object' && context.constructor.name !== 'Function' && context.constructor.name !== 'Error' && !context.constructor.name.endsWith('Error')) {
    compName = context.constructor.name;
  }

  let file = context.fileName || context.__filename || context.file;
  if (!file && context.component) {
    const comp = context.component;
    file = comp.fileName || comp.__filename || comp.file;
  }

  if (compName && file) {
    return `[${compName} <${file}>]`;
  }
  if (compName) {
    return `[${compName}]`;
  }
  if (file) {
    return `[<${file}>]`;
  }
  return '';
}

/**
 * Default formatter for browser runtime.
 * Prefixes messages with [Avenx level] and formats component context metadata if present.
 * Preserves interactive object logs by prepending to string or prepending as separate arg.
 * @param {string} level - Log level name.
 * @param {any[]} args - Array of raw arguments.
 * @returns {any[]} Array of formatted arguments.
 */
export function defaultFormatter(level, args) {
  const prefix = `[Avenx ${level}]`;
  if (!args || args.length === 0) {
    return [prefix];
  }

  let contextTag = '';
  const cleanArgs = [...args];

  const lastArg = cleanArgs[cleanArgs.length - 1];
  if (
    lastArg &&
    typeof lastArg === 'object' &&
    !(lastArg instanceof Error) &&
    !Array.isArray(lastArg)
  ) {
    const isExplicitContext = Boolean(
      lastArg.componentName ||
        lastArg.fileName ||
        lastArg.__filename ||
        lastArg.component ||
        lastArg.$logContext ||
        lastArg.__isAvenxComponent
    );
    if (isExplicitContext) {
      const tag = formatContextTag(lastArg);
      if (tag) {
        contextTag = tag;
        cleanArgs.pop();
      }
    }
  }

  if (cleanArgs.length > 0) {
    if (typeof cleanArgs[0] === 'string') {
      const firstStr = contextTag ? `${prefix} ${contextTag} ${cleanArgs[0]}` : `${prefix} ${cleanArgs[0]}`;
      return [firstStr, ...cleanArgs.slice(1)];
    }
    if (cleanArgs[0] instanceof Error) {
      return contextTag ? [`${prefix} ${contextTag}`, ...cleanArgs] : cleanArgs;
    }
  }

  return contextTag ? [`${prefix} ${contextTag}`, ...cleanArgs] : [prefix, ...cleanArgs];
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
 * // Import the shared logger from the runtime entry point — component
 * // instances do not expose `this.logger`.
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
    this.bindings = {};
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
    // Validate level against known LogLevels; fall back to 'info' on mismatch
    if (LogLevels[this.config.level] === undefined) {
      this.write('warn', `Invalid log level "${this.config.level}" — falling back to "info"`);
      this.config.level = 'info';
    }
  }

  /**
   * Sets the minimum log severity level programmatically.
   * @param {string} level - Log level name ('trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off', 'silent').
   */
  setLevel(level) {
    this.configure({ level });
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
    if (level === 'warn' && typeof this.config.warnHandler === 'function') {
      const message = Array.isArray(formatted) ? formatted.map(String).join(' ') : String(formatted);
      const context = [...args].reverse().find(arg => arg && typeof arg === 'object' && !(arg instanceof Error));
      this.config.warnHandler(message, context);
    }
  }

  /**
   * Creates a child logger instance that inherits the parent's log level, transports, and formatter.
   * Supports a string shorthand for prefix-only binding, or an object with prefix and/or componentName.
   * Parent bindings are merged with the new bindings (child overrides parent on conflict).
   * @param {string|object} [bindings] - Bindings configuration for the child logger.
   * @param {string} [bindings.prefix] - A prefix string prepended to every formatted log message.
   * @param {string} [bindings.componentName] - Component name injected as context metadata, formatted as [ComponentName] by defaultFormatter.
   * @returns {AvenxLogger} A new logger instance with inherited configuration and merged bindings.
   * @example
   * // String shorthand
   * const authLogger = logger.child('[AuthBridge]');
   * authLogger.info('User logged in');
   * // Output: [AuthBridge] [Avenx info] User logged in
   * @example
   * // Object bindings with context
   * const dbLogger = logger.child({ prefix: '[DB]', componentName: 'DatabaseBridge' });
   * dbLogger.warn('Connection slow');
   * // Output: [DB] [Avenx warn] [DatabaseBridge] Connection slow
   * @example
   * // Nested child loggers
   * const child = logger.child('[Parent]').child('[Child]');
   */
  child(bindings = {}) {
    const normBindings = typeof bindings === 'string' ? { prefix: bindings } : bindings;
    const childLogger = new AvenxLogger(this.config);
    childLogger.bindings = { ...this.bindings, ...normBindings };

    const parentFormatter = this.config.formatter || defaultFormatter;
    childLogger.config.formatter = (level, args) => {
      const injectArgs = [...args];

      if (childLogger.bindings.componentName) {
        const lastArg = injectArgs[injectArgs.length - 1];
        const hasContext =
          lastArg &&
          typeof lastArg === 'object' &&
          !Array.isArray(lastArg) &&
          !(lastArg instanceof Error) &&
          (lastArg.componentName ||
            lastArg.fileName ||
            lastArg.__filename ||
            lastArg.component ||
            lastArg.$logContext ||
            lastArg.__isAvenxComponent);
        if (!hasContext) {
          injectArgs.push({ componentName: childLogger.bindings.componentName });
        }
      }

      const formatted = parentFormatter(level, injectArgs);

      const prefix = childLogger.bindings.prefix || '';
      if (prefix && formatted.length > 0) {
        if (typeof formatted[0] === 'string') {
          formatted[0] = `${prefix} ${formatted[0]}`;
        } else {
          formatted.unshift(prefix);
        }
      }

      return formatted;
    };

    return childLogger;
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
