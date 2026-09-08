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
      // A DOM event is the one thing in an Avenx application that genuinely
      // starts a causal chain, so it opens the outermost node. Everything the
      // handler goes on to do — the action, its writes, the watchers those
      // wake, the DOM patches those produce — hangs off this node.
      const token = tracer.on ? tracer.enter(TraceNodeType.EVENT, buildEventNode(source, event)) : -1;
      try {
        // The *source* is handed on, not a compiled function.
        //
        // This used to build `new Function("with(state){with(methods){...}}")`
        // for every handler and pass that down, which meant every inline
        // handler in every application took the legacy proxy sandbox and no
        // handler ever reached the AST evaluator. Two consequences, neither
        // intended: an application needed 'unsafe-eval' as soon as it had a
        // single @click, and the evaluator's guarantees — no reaching the
        // Function constructor, no `constructor` / `__proto__` / `prototype`
        // however the key is spelled — did not hold on the busiest path in the
        // framework.
        //
        // `executeStatement` already knows how to make this decision. Given
        // source it parses first and only falls back to `new Function` for
        // bodies that are real statements (`if`, `for`, `return`, a
        // declaration), which is what the deployment guide has always
        // described. Given a function it had no choice.
        return this.runHandler(source, event, slotScope);
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
  }
}
