import { AvenxComponent } from './AvenxComponent.js';
import { logger } from './AvenxLogger.js';
import { AvenxErrorCodes, formatMessage } from './AvenxError.js';
import { queueFlushCallback } from '../reactive/scheduler.js';

/**
 * AvenxPage is a specialized component that can host child components.
 * It automatically mounts child components defined in its template via [data-avenx-comp].
 */
export class AvenxPage extends AvenxComponent {
  /** @type {Map<string, Function>} */
  #componentRegistry;
  /** @type {Map<Element, AvenxComponent>} */
  #childComponents = new Map();

  /**
   * Set while a child-prop reconciliation is already queued for this flush.
   * @type {boolean}
   */
  #childPropsQueued = false;

  /**
   * @param {object} initialState - Initial state.
   * @param {object} computed - Computed properties.
   * @param {object} bridges - Shared bridges.
   * @param {string} template - HTML template.
   * @param {object} methods - Component methods.
   * @param {Map<string, Function>} componentRegistry - Registry of available components.
   * @param {object} props - Component properties.
   * @param {object} styles - Component CSS variables.
   * @param {object} [resources] - Reactive resources.
   * @param {object} [options] - Component options and compiler contracts.
   */
  constructor(
    initialState = {},
    computed = {},
    bridges = {},
    template = '',
    methods = {},
    componentRegistry = new Map(),
    props = {},
    styles = {},
    resources = {},
    options = {},
  ) {
    super(initialState, computed, bridges, template, methods, props, styles, resources, options);
    this.#componentRegistry = componentRegistry;
  }

  /**
   * Updates the page and then mounts/updates child components.
   *
   * The child pass runs inside {@link AvenxPage#runUpdate}, not here, so that
   * the state a `data-props-*` expression reads is collected by the page's
   * render watcher. Mounting children after `super.update()` returned put
   * those reads outside the watcher, leaving the page with no dependency on
   * the state it passes down -- which only worked while every write scheduled
   * a re-render regardless of what read it.
   */
  update() {
    super.update();
    this.#mountChildComponents();
  }

  /**
   * Renders the page, and registers the state its children's props depend on.
   *
   * Mounting children stays outside the render watcher, in {@link
   * AvenxPage#update}: it *writes* to each child's props, and doing that inside
   * the watcher made the page depend on its children's props, so a child
   * setting its own prop re-ran the parent and overwrote the value.
   *
   * The reads still have to be inside the watcher, though, or the page has no
   * dependency on the state it passes down. `data-props-*` expressions are
   * therefore evaluated here for their dependencies and the results discarded.
   * That only mattered once unobserved writes stopped scheduling a render;
   * before, every write re-rendered every component regardless.
   * @override
   */
  runUpdate() {
    super.runUpdate();
    this.#trackChildPropDependencies();
  }

  /**
   * Evaluates child `data-props-*` expressions so the page's render watcher
   * records what they read. Results are discarded.
   * @private
   */
  #trackChildPropDependencies() {
    const root = this.$element;
    if (!root || typeof root.querySelectorAll !== 'function') {
      return;
    }

    // Queried separately rather than with a comma selector: this runs against
    // whatever DOM the host provides, and a selector list is one of the first
    // things a minimal implementation leaves out.
    const elements = [
      ...Array.from(root.querySelectorAll('[data-avenx-comp]')),
      ...Array.from(root.querySelectorAll('[data-avenx-comp-dynamic]')),
    ];
    if (root.hasAttribute && (root.hasAttribute('data-avenx-comp') || root.hasAttribute('data-avenx-comp-dynamic'))) {
      elements.unshift(root);
    }

    for (const el of elements) {
      if (!el.attributes) continue;
      // A compiled mount point has no prop attributes left to read, and needs
      // none: each prop is already a tracked effect of its own, which is a
      // strictly finer dependency than the page-wide one this pass records.
      if (el.__axProps) continue;
      for (const attr of el.attributes) {
        if (!attr.name.startsWith('data-props-') && attr.name !== 'data-avenx-comp-dynamic') {
          continue;
        }
        try {
          this._evaluate(attr.value);
        } catch {
          // A prop expression that throws is reported when it is used for
          // real, in #mountChildComponents. This pass exists only to collect
          // dependencies and must never change what the page reports.
        }
      }
    }
  }

  /**
   * Pushes changed compiled props into already-mounted children.
   *
   * On the compiled path each `data-props-*` expression is its own reactive
   * effect, so a prop that changed says so directly instead of the page
   * re-evaluating every prop of every child whenever anything changed.
   *
   * Coalesced to once per flush: several props of several children can change
   * in one tick, and the mount pass reconciles all of them in one go.
   * @override
   */
  __onChildPropsChanged() {
    if (this.#childPropsQueued) return;
    this.#childPropsQueued = true;
    queueFlushCallback(() => {
      this.#childPropsQueued = false;
      if (this.$isUnmounted) return;
      this.#mountChildComponents();
    });
  }

  /**
   * Unmounts the page and all child components.
   */
  unmount() {
    const promises = [];
    for (const compInstance of this.#childComponents.values()) {
      if (typeof compInstance.unmount === 'function') {
        const res = compInstance.unmount();
        if (res instanceof Promise) {
          promises.push(res);
        }
      }
    }
    this.#childComponents.clear();
    const superRes = super.unmount();
    if (superRes instanceof Promise) {
      promises.push(superRes);
    }
    if (promises.length > 0) {
      return Promise.all(promises).then(() => {});
    }
  }

  /**
   * Finds all mount points for child components and initializes or updates them.
   * @private
   */
  #mountChildComponents() {
    const root = this._getElement();
    if (!root) return;

    const mountPoints = [
      ...Array.from(root.querySelectorAll('[data-avenx-comp]')),
      ...Array.from(root.querySelectorAll('[data-avenx-comp-dynamic]')),
    ];
    const currentElements = new Set(mountPoints);

    // 1. Clean up/unmount child components whose elements are no longer in the DOM/page
    for (const [el, compInstance] of this.#childComponents.entries()) {
      if (!currentElements.has(el) || !root.contains(el)) {
        if (typeof compInstance.unmount === 'function') {
          compInstance.unmount();
        }
        this.#childComponents.delete(el);
      }
    }

    // 2. Instantiate new components or update existing ones
    const registry = this.#getRegistry();
    mountPoints.forEach((el) => {
      let CompClass = null;
      let compName = null;

      if (el.hasAttribute('data-avenx-comp')) {
        compName = el.getAttribute('data-avenx-comp');
        CompClass = registry.get(compName);
      } else if (el.hasAttribute('data-avenx-comp-dynamic')) {
        const dynamicExpr = el.getAttribute('data-avenx-comp-dynamic');
        try {
          let resolvedVal = this._evaluate(dynamicExpr);
          if (resolvedVal && resolvedVal[Symbol.for('rawTarget')]) {
            resolvedVal = resolvedVal[Symbol.for('rawTarget')];
          }
          if (typeof resolvedVal === 'string') {
            compName = resolvedVal;
            CompClass = registry.get(resolvedVal);
          } else if (typeof resolvedVal === 'function') {
            CompClass = resolvedVal;
            compName = resolvedVal.name;
          }
        } catch (e) {
          logger.warn(
            formatMessage(AvenxErrorCodes.PAGE_PROP_EVALUATION_FAILED, dynamicExpr, e.message || e)
          );
        }
      }

      if (CompClass) {
        // Props come from whichever mechanism owns them.
        //
        // On the compiled path the parent's program evaluated each
        // `data-props-*` expression as its own reactive effect and left the
        // result on the element, so the attributes are gone and re-evaluating
        // them here would find nothing. On the string path they are still
        // attributes holding expression source, evaluated per render.
        //
        // Checked per element rather than per page: a page can carry a program
        // while a child mount point added by other means does not.
        const props = el.__axProps ? { ...el.__axProps } : {};
        if (!el.__axProps) {
          for (const attr of el.attributes) {
            if (attr.name.startsWith('data-props-')) {
              const propName = attr.name.slice('data-props-'.length);
              try {
                props[propName] = this._evaluate(attr.value);
              } catch (e) {
                logger.warn(
                  formatMessage(AvenxErrorCodes.PAGE_PROP_EVALUATION_FAILED, attr.value, e.message || e)
                );
              }
            }
          }
        }

        if (this.#childComponents.has(el)) {
          const compInstance = this.#childComponents.get(el);
          if (compInstance.constructor === CompClass) {
            if (typeof compInstance.setProps === 'function') {
              compInstance.setProps(props);
            } else if (typeof compInstance.update === 'function') {
              compInstance.update();
            }
          } else {
            // Component class changed! Unmount the old one and mount the new one
            if (typeof compInstance.unmount === 'function') {
              compInstance.unmount();
            }
            // Clear content of el before mounting new one to avoid merge issues
            el.innerHTML = '';
            const newInstance = new CompClass(this._getBridges(), props);
            newInstance.$parent = this;
            newInstance.mount(el);
            this.#childComponents.set(el, newInstance);
          }
        } else {
          const compInstance = new CompClass(this._getBridges(), props);
          compInstance.$parent = this;
          compInstance.mount(el);
          this.#childComponents.set(el, compInstance);
        }
      } else {
        // If it was dynamic and is now null/undefined/unresolved, we should unmount any existing component
        if (this.#childComponents.has(el)) {
          const compInstance = this.#childComponents.get(el);
          if (typeof compInstance.unmount === 'function') {
            compInstance.unmount();
          }
          this.#childComponents.delete(el);
          el.innerHTML = '';
        }
        if (compName) {
          logger.warn(formatMessage(AvenxErrorCodes.PAGE_COMPONENT_NOT_REGISTERED, compName));
        }
      }
    });
  }

  /**
   * Retrieves the component registry.
   * @returns {Map<string, Function>}
   * @protected
   */
  _getComponentRegistry() {
    return this.#componentRegistry;
  }

  /**
   * Resolves the component registry dynamically by traversing parent page instances.
   * @returns {Map<string, Function>}
   * @private
   */
  #getRegistry() {
    if (this.#componentRegistry instanceof Map) {
      return this.#componentRegistry;
    }
    const root = this._getElement();
    if (root) {
      let parentEl = root.parentNode;
      while (parentEl) {
        if (
          parentEl.__avenx_comp_instance &&
          typeof parentEl.__avenx_comp_instance._getComponentRegistry === 'function'
        ) {
          const reg = parentEl.__avenx_comp_instance._getComponentRegistry();
          if (reg instanceof Map) {
            return reg;
          }
        }
        parentEl = parentEl.parentNode;
      }
    }
    return new Map();
  }
}
