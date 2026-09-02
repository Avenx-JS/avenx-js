import { bridge } from 'avenx-core/runtime';

/* global AvenxPersistence -- loaded from a <script> tag; see index.html. */

/**
 * The to-do list.
 *
 * An ordinary Avenx bridge: state, getters, and actions that are the only
 * place state changes. The only thing persistence adds is the setup() hook at
 * the bottom — the plugin is reached through the `AvenxPersistence` global
 * this app loads in index.html, because a bridge module compiled by the Avenx
 * CLI may only import the runtime and other bridges.
 */
export default bridge({
  state: {
    items: [],
    filter: 'all',
    draft: '',
  },

  /**
   * @returns {Array<object>} The items the current filter admits.
   */
  get visible() {
    if (this.filter === 'active') {
      return this.items.filter((item) => !item.done);
    }
    if (this.filter === 'done') {
      return this.items.filter((item) => item.done);
    }
    return this.items;
  },

  /**
   * @returns {number} How many items are still open.
   */
  get remaining() {
    return this.items.filter((item) => !item.done).length;
  },

  /**
   * Records what the user is typing.
   * @param {string} text - The current input value.
   */
  setDraft(text) {
    this.draft = text;
  },

  /**
   * Adds the current draft as a new item.
   */
  add() {
    const text = this.draft.trim();
    if (text === '') {
      return;
    }
    this.items.push({ id: `${Date.now()}-${this.items.length}`, text, done: false });
    this.draft = '';
  },

  /**
   * Flips one item between open and done.
   * @param {string} id - The item to toggle.
   */
  toggle(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (item) {
      item.done = !item.done;
    }
  },

  /**
   * Removes every completed item.
   */
  clearDone() {
    this.items = this.items.filter((item) => !item.done);
  },

  /**
   * Changes which items are shown.
   * @param {string} filter - One of 'all', 'active' or 'done'.
   */
  setFilter(filter) {
    this.filter = filter;
  },

  /**
   * Runs once, the first time anything reads this bridge.
   *
   * `this` here is the bridge's own write-capable facade, so restoring is a
   * write from inside the bridge like any other. Returning the plugin's
   * cleanup means persistence stops when the bridge is disposed.
   * @returns {Function} The cleanup for this hook.
   */
  setup() {
    return AvenxPersistence.persist(this, {
      key: 'todos',
      version: 2,

      // `draft` is what the user is part-way through typing. Restoring it a
      // day later would be a surprise rather than a convenience, so it stays
      // out of storage. `visible` and `remaining` are getters, so they are
      // never persisted — they recompute from the restored items.
      exclude: ['draft'],

      // Version 1 of this app stored `{ todos: [{ label, complete }] }`.
      // Rather than throw that away, rename the fields on the way in.
      migrate: (state, fromVersion) => {
        if (fromVersion !== 1 || !Array.isArray(state.todos)) {
          return null;
        }
        return {
          filter: 'all',
          items: state.todos.map((todo, index) => ({
            id: `migrated-${index}`,
            text: todo.label,
            done: Boolean(todo.complete),
          })),
        };
      },
    });
  },
});
