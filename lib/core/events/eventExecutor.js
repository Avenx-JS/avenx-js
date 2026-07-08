/**
 * Handles the execution of event handlers.
 */
export class EventExecutor {
  /**
   * @param {function(string, Event|null): any} runHandler - Function that executes the event logic.
   */
  constructor(runHandler) {
    /**
     * @type {function(string, Event|null): any}
     */
    this.runHandler = runHandler;
  }

  /**
   * Executes the event handler for a given source.
   * @param {string} source - The source code or identifier for the event handler.
   * @param {Event|null} [event] - The event object, if any.
   * @returns {any} The result of the event handler execution.
   */
  execute(source, event = null) {
    return this.runHandler(source, event);
  }
}
