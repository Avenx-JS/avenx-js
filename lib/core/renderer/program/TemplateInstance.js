/**
 * @file TemplateInstance.js
 * @description One mounted copy of a render program, and the effects that keep
 * it in step with state.
 *
 * ## What replaces the update cycle
 *
 * The string renderer had a single reactive unit per component. Any dependency
 * of any binding woke it, and waking it meant re-rendering, re-parsing and
 * re-diffing the whole template. Change one cell in a table and the framework
 * did work proportional to the table.
 *
 * Here each op is its own reactive unit. A binding's effect reads exactly the
 * state its expression names, so a write wakes only the bindings that read it
 * and each of those writes to exactly one node. Changing one cell costs one
 * expression evaluation and one DOM write, whatever else the template contains.
 *
 * ## Why the effects are lazy with a queueing callback
 *
 * The obvious construction -- a plain effect that re-applies on every write --
 * would update the DOM synchronously inside the assignment. That is faster to
 * write and changes observable behaviour: `$nextTick` would resolve after the
 * DOM had already been touched, and an action making three writes to one value
 * would produce three DOM writes.
 *
 * So each binding uses the same shape the component's render watcher used: a
 * lazy watcher whose callback queues a job. Writes still coalesce into one
 * microtask flush, `$nextTick` still means "after the DOM has settled", and the
 * only thing that changed is how much work the flush does.
 *
 * ## Errors and suspension
 *
 * A binding that throws does not take its siblings with it -- the rest of the
 * template still updates, and the failure is reported once with the expression
 * that caused it. A binding that throws a `Promise` is a resource read under
 * Suspense, which is not an error: it is handed to the owner so the component
 * can suspend as it did before.
 * @module lib/core/renderer/program/TemplateInstance
 */

import { AvenxWatcher } from '../../reactive/watcher.js';
import { queueJob } from '../../reactive/scheduler.js';
import { OpKind } from '../../../compiler/render/program.js';
import { getCompiledTemplate } from './CompiledTemplate.js';
import {
  applyAttribute,
  applyAttributeParts,
  applyBoolean,
  applyClass,
  applyHtml,
  applyProp,
  applyRaw,
  applyShow,
  applyText,
  reportBindingError,
} from './bindings.js';

/**
 * A mounted render program.
 */
export class TemplateInstance {
  /**
   * @param {object} program - The render program to instantiate.
   * @param {object} host - The owner.
   * @param {function(string): any} host.evaluate - Evaluates an expression.
   * @param {function(Promise): void} [host.onSuspend] - Called when a binding
   *   throws a Promise, so the owner can suspend.
   * @param {number} [host.jobId] - Orders this instance's jobs against other
   *   components in a flush, so a parent still updates before its children.
   * @param {function(): void} [host.onRendered] - Called when a binding has
   *   re-applied, so the owner can fire its once-per-flush lifecycle hooks.
   * @param {function(): void} [host.onChildProps] - Called when a prop for a
   *   child component changed value.
   * @param {function(): void} [host.onBeforeRender] - Called before the first
   *   binding of a flush applies, so the owner can fire `onBeforeUpdate`.
   */
  constructor(program, host) {
    /** @type {object} */
    this.program = program;
    /** @type {object} */
    this.host = host;

    /** @type {CompiledTemplate} */
    this.compiled = getCompiledTemplate(program);

    /** @type {Element[]} */
    this.elements = [];
    /** @type {Text[]} */
    this.texts = [];

    /**
     * One entry per op, holding its watcher, its job and whatever state that
     * op kind needs to remember between runs.
     * @type {object[]}
     */
    this.bindings = [];

    /** @type {boolean} */
    this.disposed = false;

    /** @type {DocumentFragment|null} */
    this.fragment = null;
  }

  /**
   * Whether the program could be prepared for this host environment.
   * @returns {boolean} True when this instance can be mounted.
   */
  get usable() {
    return !this.compiled.failed;
  }

  /**
   * Clones the skeleton and runs every binding once.
   *
   * The bindings run while the tree is still detached, so the first paint sees
   * finished markup rather than a skeleton that fills in.
   * @returns {DocumentFragment|null} The populated fragment, ready to insert.
   */
  create() {
    const instance = this.compiled.instantiate();
    if (!instance) {
      return null;
    }

    this.fragment = instance.fragment;
    this.elements = instance.elements;
    this.texts = instance.texts;

    for (const op of this.program.ops) {
      this.#createBinding(op);
    }

    return this.fragment;
  }

  /**
   * Creates one binding's state, effect and job.
   * @param {object} op - The op to bind.
   * @private
   */
  #createBinding(op) {
    const binding = { op, watcher: null, job: null };
    this.bindings.push(binding);

    const run = () => {
      if (this.disposed) return undefined;
      try {
        this.#apply(op, binding);
      } catch (error) {
        if (error instanceof Promise) {
          // A resource read under Suspense. Not a failure: the owner decides
          // what to show while it settles.
          if (this.host.onSuspend) {
            this.host.onSuspend(error);
          }
          return undefined;
        }
        reportBindingError(op, error);
      }
      return undefined;
    };

    const job = () => {
      if (this.disposed) return;
      // Announced before the first binding of the flush applies, not after:
      // `onBeforeUpdate` means "the DOM is about to change", and a hook that
      // fires once the first write has landed is telling the truth about the
      // second write and lying about the first. The owner coalesces it.
      if (this.host.onBeforeRender) {
        this.host.onBeforeRender();
      }
      binding.watcher.evaluate();
      // Tells the owner that *something* changed this flush. It coalesces the
      // notification itself; from here every binding reports and the owner
      // decides that means one update.
      if (this.host.onRendered) {
        this.host.onRendered();
      }
    };
    job.id = this.host.jobId || 0;
    // `name` is a read-only own property of a function expression, so the
    // scheduler's diagnostic label has to be defined rather than assigned.
    Object.defineProperty(job, 'name', { value: `binding:${op.k}`, configurable: true });
    binding.job = job;

    binding.watcher = new AvenxWatcher(run, () => queueJob(job), {
      lazy: true,
      name: `${op.k}:${op.x || op.a || ''}`,
    });

    // The first run both paints the value and registers the dependencies that
    // will wake it. Nothing is tracked until an expression has actually been
    // evaluated, which is why this cannot be deferred to the first update.
    binding.watcher.evaluate();
  }

  /**
   * Evaluates one op and writes its result.
   * @param {object} op - The op.
   * @param {object} binding - Its per-binding state.
   * @private
   */
  #apply(op, binding) {
    const evaluate = this.host.evaluate;

    switch (op.k) {
      case OpKind.TEXT:
        applyText(this.texts[op.t], evaluate(op.x), binding);
        return;

      case OpKind.RAW:
        applyRaw(this.texts[op.t], evaluate(op.x), binding);
        return;

      case OpKind.ATTR:
        applyAttribute(this.elements[op.e], op.a, evaluate(op.x));
        return;

      case OpKind.ATTR_PARTS: {
        let value = '';
        for (const part of op.p) {
          if (typeof part === 'string') {
            value += part;
          } else {
            const resolved = evaluate(part.x);
            value += resolved === null || resolved === undefined ? '' : String(resolved);
          }
        }
        applyAttributeParts(this.elements[op.e], op.a, value);
        return;
      }

      case OpKind.BOOL:
        applyBoolean(this.elements[op.e], op.a, evaluate(op.x));
        return;

      case OpKind.SHOW:
        applyShow(this.elements[op.e], evaluate(op.x), binding);
        return;

      case OpKind.CLASS:
        applyClass(this.elements[op.e], evaluate(op.x), binding);
        return;

      case OpKind.HTML:
        applyHtml(this.elements[op.e], evaluate(op.x));
        return;

      case OpKind.PROP:
        if (applyProp(this.elements[op.e], op.n, evaluate(op.x)) && this.host.onChildProps) {
          // Only when the value actually changed. A prop re-evaluated to the
          // same value must not schedule a child-mount pass, or a parent with
          // several children would do that pass once per prop per flush.
          this.host.onChildProps();
        }
        return;

      default:
        // The compiler and the runtime ship in the same bundle, so an unknown
        // op means a program from a different build. Reporting beats guessing.
        reportBindingError(op, new Error(`Unknown render op "${op.k}"`));
    }
  }

  /**
   * Re-runs every binding, whatever its dependencies say.
   *
   * Needed when something outside the reactive graph changes what an expression
   * would return -- new props, a swapped bridge, a resource that settled. The
   * fine-grained path handles state; this handles everything else.
   */
  refresh() {
    if (this.disposed) return;
    for (const binding of this.bindings) {
      binding.watcher.dirty = true;
      binding.watcher.evaluate();
    }
  }

  /**
   * Releases every effect and forgets every node reference.
   *
   * Called on unmount. Without it each binding's watcher stays in the
   * dependency sets of the state it read, which keeps the component, its DOM
   * and its scope alive for as long as that state exists.
   */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    for (const binding of this.bindings) {
      if (binding.watcher) {
        binding.watcher.teardown();
      }
      binding.rawNodes = null;
    }

    this.bindings = [];
    this.elements = [];
    this.texts = [];
    this.fragment = null;
  }
}
