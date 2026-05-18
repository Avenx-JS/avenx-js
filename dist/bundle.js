// src/runtime.js
/**
 * Base class for Avenx components.
 * Handles reactivity, rendering, and event binding.
 */
class AvenxComponent {
    #element = null;
    #template = '';
    #methods = {};
    #bridges = {};

    /**
     * Creates an instance of AvenxComponent.
     * @param {Object} [initialState={}] - The initial local state of the component.
     * @param {Object} [bridges={}] - Shared reactive states (bridges) accessible to the component.
     * @param {string} [template=''] - The HTML template for the component.
     * @param {Object} [methods={}] - Component methods.
     */
    constructor(initialState = {}, bridges = {}, template = '', methods = {}) {
        this.#template = template;
        this.#methods = methods;
        this.#bridges = bridges;
        const self = this;

        // Reaktivität: Proxy triggert Re-Render bei Änderungen
        this.state = new Proxy(initialState, {
            set(target, key, value) {
                target[key] = value;
                self.update();
                return true;
            },
            get(target, key) {
                return target[key];
            }
        });
    }

    /**
     * Executes a string of JavaScript code in the context of the component.
     * Used for inline event handlers (e.g., @click="count++").
     * @param {string} code - The code to execute.
     * @param {Event|null} [event=null] - The event object if triggered by an event.
     * @private
     */
    #execute(code, event = null) {
        const context = { ...this.state, ...this.#methods, ...this.#bridges, event };
        try {
            const fn = new Function(...Object.keys(context), `with(this) { ${code} }`);
            fn.call(this.state, ...Object.values(context));
        } catch (e) { console.error("Avenx Exec Error:", e); }
    }

    /**
     * Renders the component's template by interpolating expressions.
     * @returns {string} The rendered HTML string.
     */
    render() {
        let html = this.#template;
        // Einfache {{ var }} Interpolation
        return html.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
            const context = { ...this.state, ...this.#bridges };
            try {
                return new Function(...Object.keys(context), `return ${expr}`).call(this.state, ...Object.values(context));
            } catch (e) { 
                console.warn("Avenx Render Warning:", e, "Expression:", expr);
                return ''; 
            }
        });
    }

    /**
     * Updates the component's DOM element with the rendered template and re-binds events.
     */
    update() {
        if (!this.#element) return;
        this.#element.innerHTML = this.render();
        this.#bindEvents();
    }

    /**
     * Scans the component's DOM for attributes starting with '@' and binds them as event listeners.
     * @private
     */
    #bindEvents() {
        this.#element.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('@')) {
                    const eventName = attr.name.substring(1);
                    el.addEventListener(eventName, (e) => {
                        // e.preventDefault(); // Sometimes we want default behavior (like input)
                        this.#execute(attr.value, e);
                    });
                }
            });
        });
    }

    /**
     * Mounts the component to a target DOM element.
     * @param {HTMLElement} target - The DOM element where the component should be mounted.
     */
    mount(target) {
        this.#element = target;
        this.update();
    }
}

/**
 * Main application class for Avenx.
 * Manages component registration, bridges, and application mounting.
 */
class AvenxApp {
    #activeComponents = [];

    /**
     * Creates an instance of AvenxApp.
     * @param {Object} config - The application configuration.
     * @param {string} config.target - The selector for the main application target element.
     */
    constructor(config) {
        this.target = document.querySelector(config.target);
        this.components = new Map();
        this.bridges = {};
    }

    /**
     * Registers a component class with a given name.
     * @param {string} name - The name of the component.
     * @param {AvenxComponent} compClass - The component class (constructor) to register.
     */
    register(name, compClass) { this.components.set(name, compClass); }
    
    /**
     * Registers a shared reactive state (bridge).
     * @param {string} name - The name of the bridge.
     * @param {Object} initialState - The initial state of the bridge.
     */
    registerBridge(name, initialState) {
        const self = this;
        const reactiveState = new Proxy(initialState, {
            set(target, key, value) {
                target[key] = value;
                self.updateAll();
                return true;
            },
            get(target, key) {
                return target[key];
            }
        });
        this.bridges[name] = reactiveState;
    }

    /**
     * Triggers an update (re-render) for all active component instances.
     */
    updateAll() {
        this.#activeComponents.forEach(comp => comp.update());
    }

    /**
     * Mounts a registered component to a target element.
     * @param {string} name - The name of the registered component.
     * @param {string|null} [targetSelector=null] - The selector for the target element. If null, uses the app's default target.
     */
    mount(name, targetSelector = null) {
        const Comp = this.components.get(name);
        const target = targetSelector ? document.querySelector(targetSelector) : this.target;
        if (Comp && target) {
            const compInstance = new Comp(this.bridges);
            compInstance.mount(target);
            this.#activeComponents.push(compInstance);
        }
    }
}

class Counter extends AvenxComponent {
    constructor(bridges) {
        super({"count":0,"step":1}, bridges, `<div class="avenx-e287f5e0">
    <h1 @click="count = 0" class="avenx-9337e1c1">
        Avenx-JS @css PoC
    </h1>
    <div class="avenx-fce01bb2">
        {{ count }}
    </div>
    <button @click="count += step; log()" class="avenx-ab40aff8">
        Erhöhen (+{{ step }})
    </button>
</div>`, { log: function() { console.log("Neuer Stand:", count); } });
    }
}
class Display extends AvenxComponent {
    constructor(bridges) {
        super({}, bridges, `<div class="avenx-74e33e8e">
    <div class="avenx-63f81c08">
        Globaler Brücken-Zähler
    </div>
    <div class="avenx-1053fd5c">
        {{ CounterBridge.count }}
    </div>
</div>`, {  });
    }
}
class Source extends AvenxComponent {
    constructor(bridges) {
        super({}, bridges, `<div class="avenx-5ea87827">
    <div class="avenx-11ab6060">
        Brücken-Steuerung
    </div>
    <button @click="CounterBridge.count++" class="avenx-1f9e7009">
        Zähler erhöhen
    </button>
</div>`, {  });
    }
}
(function(){




const app = new AvenxApp({ target: '#app' });
app.registerBridge('CounterBridge', {
    count: 0
});


app.register('Source', Source);
app.register('Display', Display);

app.mount('Source', '#source');
app.mount('Display', '#display');

})();