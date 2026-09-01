import { AvenxSandbox } from '../security/sandbox.js';
import { logger } from '../runtime/AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from '../runtime/AvenxError.js';
import { tracer } from '../trace/tracer.js';
import { TraceNodeType } from '../trace/schema.js';
import { describeNode } from '../trace/dom.js';

/**
 * Builds the trace node for a dispatched event.
 *
 * The handler source is recorded verbatim. Avenx keeps template expressions as
 * source text right through to evaluation, so the trace can name the exact code
 * that ran rather than a compiled closure with no identity.
 * @param {string} source - The handler source from the template.
 * @param {Event|null} event - The dispatched event.
 * @returns {object} The event node fields.
 */
function buildEventNode(source, event) {
  const target = event && event.target;
  const node = {
    eventType: (event && event.type) || 'unknown',
    handler: source,
  };

  const ref = describeNode(target);
  if (ref) {
    node.target = { selector: ref.selector, nth: ref.nth };
    if (ref.component) {
      node.component = ref.component;
      node.uid = ref.uid;
    }
  }

  // Input values are what replay has to reproduce for a form interaction, so a
  // typed value is part of the event rather than an observation of it.
  if (target && typeof target.value === 'string' && target.value !== '') {
    node.value = target.value;
  }
  if (target && typeof target.checked === 'boolean') {
    node.checked = target.checked;
  }
  if (event && typeof event.key === 'string') {
    node.key = event.key;
  }

  return node;
}

/**
 * Handles the execution of event handlers.
 */
export class EventExecutor {
  /**
   * @type {Map<string, Function>}
   * @private
   */
  #compiledHandlerCache = new Map();

  /**
   * @param {Function} runHandler - Function that executes the event logic.
   */
  constructor(runHandler) {
    /**
     * @type {Function}
     */
    this.runHandler = runHandler;
  }

  /**
   * Executes the event handler for a given source.
   * @param {string} source - The source code or identifier for the event handler.
   * @param {Event|null} [event] - The event object, if any.
   * @param {object|null} [slotScope] - The slot scope context, if any.
   * @returns {any} The result of the event handler execution.
   */
  execute(source, event = null, slotScope = null) {
    if (!this.runHandler) {
      throw new TypeError('Handler is not configured or has been torn down.');
    }

    try {
      let fn = this.#compiledHandlerCache.get(source);
      if (!fn) {
        AvenxSandbox.validateSource(source);
        const originalFn = new Function('state', 'methods', 'event', 'args', `with(state) { with(methods) { ${source} } }`);
        
        fn = function(state, methods, evt, args) {
          try {
            return originalFn(state, methods, evt, args);
          } catch (err) {
            const elTag = evt?.target?.tagName || 'UNKNOWN';
            const eType = evt?.type || 'unknown';
            /**
             * Error wrapper for event execution failures.
             * @private
             */
            class AvenxEventExecutionError extends Error {
              /**
               * @param {Error} originalError - The original error thrown during execution
               * @param {string} elTag - The element tag name
               * @param {string} eType - The event type
               */
              constructor(originalError, elTag, eType) {
                super(originalError.message || String(originalError));
                this.name = originalError.name || 'Error';
                this.cause = originalError;
                this.stack = originalError.stack;
                this.elTag = elTag;
                this.eType = eType;
              }
              /**
               * Returns a formatted error message with context
               * @returns {string} Formatted error string
               */
              toString() {
                return `${this.name}: ${this.message} \n[Context] Element: <${this.elTag}>, Event: '${this.eType}'`;
              }
            }

            throw new AvenxEventExecutionError(err, elTag, eType);
          }
        };
        
        fn.source = source;
        this.#compiledHandlerCache.set(source, fn);
      }

      // A DOM event is the one thing in an Avenx application that genuinely
      // starts a causal chain, so it opens the outermost node. Everything the
      // handler goes on to do — the action, its writes, the watchers those
      // wake, the DOM patches those produce — hangs off this node.
      const token = tracer.on ? tracer.enter(TraceNodeType.EVENT, buildEventNode(source, event)) : -1;
      try {
        return this.runHandler(fn, event, slotScope);
      } finally {
        if (token >= 0) {
          tracer.leave(token);
        }
      }
    } catch (error) {
      const compContext = event?.target?.__avenx_comp_instance?.$logContext || {};
      const elTag = event?.target?.tagName || 'UNKNOWN';
      const eType = event?.type || 'unknown';
      const msg = formatMessage(AvenxErrorCodes.EVENT_HANDLER_ERROR, source, error);
      const extendedMsg = `${msg} \n[Context] Element: <${elTag}>, Event: '${eType}'`;
      logger.error(extendedMsg, compContext);
      throw error;
    }
  }

  /**
   * Cleans up the run handler closure reference to prevent parent scope memory retention.
   */
  teardown() {
    this.runHandler = null;
    this.#compiledHandlerCache.clear();
  }
}
