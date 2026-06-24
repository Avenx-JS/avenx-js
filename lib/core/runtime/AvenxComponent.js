import { ComputedRegistry } from '../reactive/createComputed.js';
import { StateFactory } from '../reactive/createState.js';
import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { EventBinder } from '../events/bindEvents.js';
import { EventExecutor } from '../events/eventExecutor.js';
import { DynamicEvaluator } from '../security/evaluator.js';
import { LifecycleManager } from './lifecycle.js';
import { ListManager } from '../renderer/listManager.js';
import { AvenxErrorCodes, formatMessage } from './AvenxError.js';

/**
 * Base class for all Avenx components.
 * Manages state, reactivity, rendering, and lifecycle.
 */
export class AvenxComponent {
    /** @type {Element|null} @private */
    #element = null;
    /** @type {string} @private */
    #template = '';
    /** @type {Object} @private */
    #methods = {};
    /** @type {Object} @private */
    #bridges = {};
    /** @type {ComputedRegistry} @private */
    #computed;
    /** @type {TemplateRenderer} @private */
    #renderer;
    /** @type {DomPatcher} @private */
    #patcher;
    /** @type {ListManager} @private */
    #listManager;
    /** @type {EventBinder} @private */
    #eventBinder;
    /** @type {EventExecutor} @private */
    #eventExecutor;
    /** @type {DynamicEvaluator} @private */
    #evaluator;
    /** @type {LifecycleManager} @private */
    #lifecycle;
    /** @type {boolean} @private */
    #isMounted = false;
    /** @type {Set<string>} @private */
    #evaluating = new Set();
    /** @type {Object|null} @private */
    #transcludedGroups = null;

    /**
     * @param {Object} [initialState={}] - The initial state of the component.
     * @param {Object} [computed={}] - Computed properties definitions.
     * @param {Object} [bridges={}] - External bridges accessible to the component.
     * @param {string} [template=''] - The HTML template string.
     * @param {Object} [methods={}] - Component methods.
     */
    constructor(initialState = {}, computed = {}, bridges = {}, template = '', methods = {}, props = {}) {
        this.#template = template;
        this.#bridges = bridges;
        this.#computed = new ComputedRegistry(computed);
        this.#renderer = new TemplateRenderer();
        this.#patcher = new DomPatcher();
        this.#eventBinder = new EventBinder();
        this.#evaluator = new DynamicEvaluator();
        this.#lifecycle = new LifecycleManager();
        this.#listManager = new ListManager(this.#evaluator, this.#renderer);

        /**
         * The reactive state of the component.
         * @type {Proxy}
         */
        this.state = new StateFactory().create(initialState, {
            computedKeys: this.#computed.keys(),
            onChange: () => this.update(),
            getComputedValue: key => this.#evaluateComputed(key)
        });

        /**
         * The reactive props of the component.
         * @type {Proxy}
         */
        this.props = new StateFactory().create(props, {
            onChange: () => this.update()
        });

        this.#methods = this.#evaluator.createMethodMap(
            methods,
            executableMethods => this.#createScope(executableMethods),
            () => this.state
        );
        this.#eventExecutor = new EventExecutor((source, event) => this.#runEventHandler(source, event));
    }

    /**
     * Creates a scope object for expression evaluation.
     * @param {Object} [methods=this.#methods] - Methods to include in the scope.
     * @param {Object} [extras={}] - Additional variables to include.
     * @returns {Object} The combined scope.
     * @private
     */
    #createScope(methods = this.#methods, extras = {}) {
        return { ...this.state, ...methods, ...this.#bridges, props: this.props, ...extras };
    }

    /**
     * Evaluates a computed property.
     * @param {string} key - The key of the computed property.
     * @returns {any} The evaluated value.
     * @private
     */
    #evaluateComputed(key) {
        if (this.#evaluating.has(key)) {
            console.warn(formatMessage(AvenxErrorCodes.COMPUTED_CIRCULAR_DEPENDENCY, key));
            return undefined;
        }
        this.#evaluating.add(key);
        const expression = this.#computed.get(key);
        try {
            return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
        } catch (error) {
            console.warn(formatMessage(AvenxErrorCodes.COMPUTED_EVALUTION_FAILED, key, expression, error));
            return undefined;
        } finally {
            this.#evaluating.delete(key);
        }
    }

    /**
     * Resolves an expression within the template.
     * @param {string} expression - The expression to evaluate.
     * @returns {any} The result of the evaluation.
     * @private
     */
    #resolveTemplateExpression(expression) {
        return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
    }

    /**
     * Runs an event handler.
     * @param {string} source - The source code of the handler.
     * @param {Event} event - The event object.
     * @returns {any} The result of the execution.
     * @private
     */
    #runEventHandler(source, event) {
        try {
            return this.#evaluator.executeStatement(source, this.#createScope(this.#methods, { event }), this.state);
        } catch (error) {
            console.error(formatMessage(AvenxErrorCodes.EVENT_HANDLER_ERROR, source, error));
            return undefined;
        }
    }

    /**
     * Renders the component template with current state.
     * @returns {string} The rendered HTML string.
     */
    render() {
        return this.#renderer.render(this.#template, expression => this.#resolveTemplateExpression(expression));
    }

    update() {
        if (!this.#element) return;
        this.#patcher.patch(this.#element, this.render());

        // Fill slots with transcluded content
        this.#fillSlots();

        this.#listManager.process(this.#element, this.#createScope(), this.state);
        this.#eventBinder.bind(this.#element, this.#eventExecutor);

        if (this.#isMounted && this.#element?.dispatchEvent) {
            this.#element.dispatchEvent(
                new CustomEvent('avenx:update')
            );
        }

        if (this.#isMounted && this.#methods.onUpdate) {
            this.#methods.onUpdate();
        }
    }

    /**
     * Internal method to set the mount target.
     * @param {Element} target - The target element.
     * @private
     */
    __setMountTarget(target) {
        this.#element = target;
        if (target) {
            target.__avenx_comp_instance = this;

            // Extract transcluded children
            const children = Array.from(target.childNodes);
            this.#transcludedGroups = {
                default: [],
                named: {}
            };
            children.forEach(child => {
                if (child.nodeType === 1 && child.hasAttribute('slot')) {
                    const name = child.getAttribute('slot');
                    if (!this.#transcludedGroups.named[name]) {
                        this.#transcludedGroups.named[name] = [];
                    }
                    this.#transcludedGroups.named[name].push(child);
                } else {
                    this.#transcludedGroups.default.push(child);
                }
            });
            // Clear the mount target's inner content
            target.innerHTML = '';
        }
    }

    /**
     * Fills <slot> elements with transcluded child nodes.
     * @private
     */
    #fillSlots() {
        if (!this.#element || !this.#transcludedGroups) return;
        const slots = this.#getOwnSlots();
        slots.forEach(slotEl => {
            const name = slotEl.getAttribute('name');
            const nodes = name ? (this.#transcludedGroups.named[name] || []) : (this.#transcludedGroups.default || []);
            const hasContent = nodes.some(node => {
                if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
                if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
                return false;
            });
            if (hasContent) {
                // Clear default content of the slot
                slotEl.innerHTML = '';
                // Append the nodes
                nodes.forEach(node => {
                    slotEl.appendChild(node);
                });
                slotEl.setAttribute('data-avenx-transcluded', 'true');
            } else {
                slotEl.removeAttribute('data-avenx-transcluded');
            }
        });
    }

    /**
     * Retrieves slot elements belonging to this component (not nested inside child components).
     * @returns {Element[]}
     * @private
     */
    #getOwnSlots() {
        if (!this.#element) return [];
        const slots = this.#element.querySelectorAll('slot');
        const root = this.#element;
        return Array.from(slots).filter(slot => {
            let parent = slot.parentNode;
            while (parent && parent !== root) {
                if (parent.hasAttribute && parent.hasAttribute('data-avenx-comp')) {
                    return false;
                }
                parent = parent.parentNode;
            }
            return true;
        });
    }

    /**
     * Updates the transcluded content when the parent template updates.
     * @param {NodeList|Array} virtualChildNodes - The new virtual transcluded nodes from parent.
     * @private
     */
    __updateTranscludedContent(virtualChildNodes) {
        const grouped = {
            default: [],
            named: {}
        };
        Array.from(virtualChildNodes || []).forEach(node => {
            if (node.nodeType === 1 && node.hasAttribute('slot')) {
                const name = node.getAttribute('slot');
                if (!grouped.named[name]) {
                    grouped.named[name] = [];
                }
                grouped.named[name].push(node);
            } else {
                grouped.default.push(node);
            }
        });

        this.#transcludedGroups = grouped;

        // Patch the slots in the DOM recursively with new virtual transcluded children
        if (this.#element) {
            const slots = this.#getOwnSlots();
            slots.forEach(slotEl => {
                const name = slotEl.getAttribute('name');
                const newChildren = name ? (grouped.named[name] || []) : (grouped.default || []);

                const newSlotWrapper = slotEl.cloneNode(false);
                newChildren.forEach(child => {
                    newSlotWrapper.appendChild(child.cloneNode(true));
                });

                const hasContent = newChildren.some(node => {
                    if (node.nodeType === 1 && node.nodeName !== '!--' && node.nodeName !== '#comment') return true;
                    if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
                    return false;
                });

                if (hasContent) {
                    newSlotWrapper.setAttribute('data-avenx-transcluded', 'true');
                } else {
                    newSlotWrapper.removeAttribute('data-avenx-transcluded');
                    // Restore default content from the template
                    try {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(this.render(), 'text/html');
                        const rootDoc = doc.body || doc;
                        const defaultSlot = Array.from(rootDoc.querySelectorAll('slot')).find(s => {
                            const sName = s.getAttribute('name');
                            return name ? (sName === name) : !sName;
                        });
                        if (defaultSlot) {
                            Array.from(defaultSlot.childNodes).forEach(child => {
                                newSlotWrapper.appendChild(child.cloneNode(true));
                            });
                        }
                    } catch (e) {
                        console.warn('[AvenxComponent] Failed to restore default slot content', e);
                    }
                }

                // Patch the slot element in-place
                this.#patcher.patchElement(slotEl, newSlotWrapper);
            });
        }
    }

    /**
     * Internal method called after the component is mounted to the DOM.
     * @private
     */
    __afterMount() {
        this.#isMounted = true;

        if (this.#element?.dispatchEvent) {
            this.#element.dispatchEvent(
                new CustomEvent('avenx:mount')
            );
        }

        if (this.#methods.onMount) {
            this.#methods.onMount();
        }
    }

    /**
     * Unmounts the component and triggers cleanup.
     */
    unmount() {
        this.#eventBinder.unbind(this.#element);
        if (this.#element?.dispatchEvent) {
            this.#element.dispatchEvent(
                new CustomEvent('avenx:unmount')
            );
        }

        if (this.#methods.onUnmount) {
            this.#methods.onUnmount();
        }

        if (this.#element) {
            this.#element.innerHTML = '';
        }

        this.#isMounted = false;
    }

    /**
     * Updates the component's props and triggers an update if they changed.
     * @param {Object} newProps - The new props to apply.
     */
    setProps(newProps) {
        let changed = false;
        const currentProps = this.props;
        
        for (const key of Object.keys(newProps)) {
            if (currentProps[key] !== newProps[key]) {
                currentProps[key] = newProps[key];
                changed = true;
            }
        }
        
        for (const key of Object.keys(currentProps)) {
            if (!(key in newProps)) {
                delete currentProps[key];
                changed = true;
            }
        }
    }

    /**
     * Evaluates an expression in the component's scope.
     * @param {string} expression - The expression to evaluate.
     * @param {Object} [extraScope={}] - Additional scope variables.
     * @returns {any} The result of the evaluation.
     * @protected
     */
    _evaluate(expression, extraScope = {}) {
        return this.#evaluator.evaluateExpression(expression, this.#createScope(this.#methods, extraScope), this.state);
    }

    /**
     * @returns {Element|null} The component's root element.
     * @protected
     */
    _getElement() {
        return this.#element;
    }

    /**
     * @returns {Object} The bridges accessible to the component.
     * @protected
     */
    _getBridges() {
        return this.#bridges;
    }

    /**
     * Mounts the component to a target element.
     * @param {Element|string} target - The target element or selector.
     */
    mount(target) {
        this.#lifecycle.mount(this, target);
    }
}
