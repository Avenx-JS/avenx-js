// src/runtime.js
class TTHComponent {
    constructor(initialState = {}, bridges = {}) {
        this.element = null;
        this._template = '';
        this.methods = {};
        this.bridges = bridges;
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

    // Führt Inline-Code (@click) im Kontext der Komponente aus
    _execute(code, event = null) {
        const context = { ...this.state, ...this.methods, ...this.bridges, event };
        try {
            const fn = new Function(...Object.keys(context), `with(this) { ${code} }`);
            fn.call(this.state, ...Object.values(context));
        } catch (e) { console.error("TTH Exec Error:", e); }
    }

    render() {
        let html = this._template;
        // Einfache {{ var }} Interpolation
        return html.replace(/\{\{\s*(.*?)\s*\}\}/g, (_, expr) => {
            const context = { ...this.state, ...this.bridges };
            try {
                return new Function(...Object.keys(context), `return ${expr}`).call(this.state, ...Object.values(context));
            } catch (e) { 
                console.warn("TTH Render Warning:", e, "Expression:", expr);
                return ''; 
            }
        });
    }

    update() {
        if (!this.element) return;
        this.element.innerHTML = this.render();
        this._bindEvents();
    }

    _bindEvents() {
        this.element.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('@')) {
                    const eventName = attr.name.substring(1);
                    el.addEventListener(eventName, (e) => {
                        // e.preventDefault(); // Sometimes we want default behavior (like input)
                        this._execute(attr.value, e);
                    });
                }
            });
        });
    }

    mount(target) {
        this.element = target;
        this.update();
    }
}

class HoeApp {
    constructor(config) {
        this.target = document.querySelector(config.target);
        this.components = new Map();
        this.bridges = {};
        this.activeComponents = [];
    }
    register(name, compClass) { this.components.set(name, compClass); }
    
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

    updateAll() {
        this.activeComponents.forEach(comp => comp.update());
    }

    mount(name, targetSelector = null) {
        const Comp = this.components.get(name);
        const target = targetSelector ? document.querySelector(targetSelector) : this.target;
        if (Comp && target) {
            const compInstance = new Comp(this.bridges);
            compInstance.mount(target);
            this.activeComponents.push(compInstance);
        }
    }
}

class Counter extends TTHComponent {
    constructor(bridges) {
        super({"count":0,"step":1}, bridges);
        this._template = `<div class="hoe-ad441ce7">
    

    <h1 @click="count = 0" class="hoe-be13fe90">
        
        Hoe-JS @css PoC
    </h1>
    
    <div class="hoe-1a055ca6">
        
        {{ count }}
    </div>

    <button @click="count += step; log()" class="hoe-07aa498a">
        
        Erhöhen (+{{ step }})
    </button>
</div>`;
        this.methods = { log: function() { console.log("Neuer Stand:", count); } };
    }
}
class Display extends TTHComponent {
    constructor(bridges) {
        super({}, bridges);
        this._template = `<div>
    <h3>Display Component</h3>
    <p>Bridge Count: {{ CounterBridge.count }}</p>
</div>`;
        this.methods = {  };
    }
}
class Source extends TTHComponent {
    constructor(bridges) {
        super({}, bridges);
        this._template = `<div>
    <h3>Source Component</h3>
    <button @click="CounterBridge.count++">Increment Bridge</button>
</div>`;
        this.methods = {  };
    }
}
(function(){




const app = new HoeApp({ target: '#app' });
app.registerBridge('CounterBridge', {
    count: 0
});


app.register('Source', Source);
app.register('Display', Display);

app.mount('Source', '#source');
app.mount('Display', '#display');

})();