import { ComputedRegistry } from '../reactive/createComputed.js';
import { StateFactory } from '../reactive/createState.js';
import { TemplateRenderer } from '../renderer/renderTemplate.js';
import { DomPatcher } from '../renderer/domPatch.js';
import { EventBinder } from '../events/bindEvents.js';
import { EventExecutor } from '../events/eventExecutor.js';
import { DynamicEvaluator } from '../security/evaluator.js';
import { LifecycleManager } from './lifecycle.js';
import { ListManager } from '../renderer/listManager.js';

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

    /**
     * @param {Object} [initialState={}] - The initial state of the component.
     * @param {Object} [computed={}] - Computed properties definitions.
     * @param {Object} [bridges={}] - External bridges accessible to the component.
     * @param {string} [template=''] - The HTML template string.
     * @param {Object} [methods={}] - Component methods.
     */
    constructor(initialState = {}, computed = {}, bridges = {}, template = '', methods = {}) {
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
        return { ...this.state, ...methods, ...this.#bridges, ...extras };
    }

    /**
     * Evaluates a computed property.
     * @param {string} key - The key of the computed property.
     * @returns {any} The evaluated value.
     * @private
     */
    #evaluateComputed(key) {
        const expression = this.#computed.get(key);
        try {
            return this.#evaluator.evaluateExpression(expression, this.#createScope(), this.state);
        } catch (error) {
            console.warn("Avenx Computed Error:", error, "Expression:", expression);
            return undefined;
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
            console.error("Avenx Exec Error:", error);
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

    /**
     * Updates the component in the DOM by re-rendering and patching.
     */
    update() {
        if (!this.#element) return;
        this.#patcher.patch(this.#element, this.render());
        this.#listManager.process(this.#element, this.#createScope(), this.state);
        this.#eventBinder.bind(this.#element, this.#eventExecutor);

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
    }

    /**
     * Internal method called after the component is mounted to the DOM.
     * @private
     */
    __afterMount() {
        this.#isMounted = true;
        if (this.#methods.onMount) {
            this.#methods.onMount();
        }
    }

    /**
     * Unmounts the component and triggers cleanup.
     */
    unmount() {
        if (this.#methods.onUnmount) {
            this.#methods.onUnmount();
        }
        if (this.#element) {
            this.#element.innerHTML = '';
        }
        this.#isMounted = false;
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
