// Type definitions for Avenx-JS core runtime
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * Base class for all route guards in Avenx.
 */
export class AvenxGuard {
    /**
     * Determines whether the route can be activated.
     * Can return a boolean, a redirect string, or a Promise resolving to either.
     * @param to Target route information.
     * @param from Current route information.
     */
    canActivate(
        to: { hash: string; page: string; params: Record<string, any> },
        from: { hash: string; page: string; params: Record<string, any> } | null
    ): boolean | string | Promise<boolean | string>;
}

/**
 * Base class for all Avenx components.
 * Manages state, reactivity, rendering, and lifecycle.
 */
export class AvenxComponent {
    /**
     * The reactive state proxy of the component.
     */
    state: Record<string, any>;

    /**
     * The reactive props of the component.
     */
    props: Record<string, any>;

    /**
     * @param initialState Initial component state variables.
     * @param computed Map of computed properties to their expression strings.
     * @param bridges Global reactive bridges injected into this component.
     * @param template Compiled HTML template string.
     * @param methods Component action methods.
     * @param props Input properties passed down from parent.
     */
    constructor(
        initialState?: Record<string, any>,
        computed?: Record<string, string>,
        bridges?: Record<string, any>,
        template?: string,
        methods?: Record<string, string | Function>,
        props?: Record<string, any>
    );

    /**
     * Renders the component HTML template using current state.
     */
    render(): string;

    /**
     * Patches the DOM to update the component UI.
     */
    update(): void;

    /**
     * Mounts the component to a target DOM node or selector.
     * @param target Target element or selector string.
     */
    mount(target: Element | string): void;

    /**
     * Unmounts the component from the DOM and runs lifecycle cleanup.
     */
    unmount(): void;

    /**
     * Updates the component's props and triggers an update if they changed.
     * @param newProps The new props to apply.
     */
    setProps(newProps: Record<string, any>): void;

    /**
     * Component mount lifecycle hook (action).
     */
    onMount?(): void;

    /**
     * Component update lifecycle hook (action).
     */
    onUpdate?(): void;

    /**
     * Component unmount lifecycle hook (action).
     */
    onUnmount?(): void;

    /**
     * Internal method to set mount target element.
     * @param target
     * @private
     */
    __setMountTarget(target: Element): void;

    /**
     * Internal lifecycle callback after mount is completed.
     * @private
     */
    __afterMount(): void;

    /**
     * Retrieves the component root element.
     * @protected
     */
    _getElement(): Element | null;

    /**
     * Retrieves bridges available to the component.
     * @protected
     */
    _getBridges(): Record<string, any>;
}

/**
 * AvenxPage is a specialized component that can host child components.
 * It automatically mounts child components defined in its template via [data-avenx-comp].
 */
export class AvenxPage extends AvenxComponent {
    /**
     * @param initialState Initial page state.
     * @param computed Page computed properties.
     * @param bridges Page shared bridges.
     * @param template Page HTML template.
     * @param methods Page methods / lifecycle actions.
     * @param componentRegistry Component class registry map.
     */
    constructor(
        initialState?: Record<string, any>,
        computed?: Record<string, string>,
        bridges?: Record<string, any>,
        template?: string,
        methods?: Record<string, string | Function>,
        componentRegistry?: Map<string, typeof AvenxComponent>,
        props?: Record<string, any>
    );
}

/**
 * Configuration options for the AvenxRouter.
 */
export interface AvenxRouterOptions {
    /**
     * Optional path prefix for all routes (e.g. 'app').
     */
    prefix?: string;

    /**
     * The time in milliseconds to wait before a route guard execution times out (default is 5000ms).
     */
    guardTimeout?: number;

    /**
     * The target hash path to redirect to if a route guard times out (e.g. '#/').
     */
    guardTimeoutRedirect?: string;
}

/**
 * AvenxRouter handles hash-based routing for the application.
 * It maps URL hashes to specific Page components.
 */
export class AvenxRouter {
    /**
     * The main application instance.
     */
    app: AvenxApp;

    /**
     * Map of route pattern strings to Page names or route config definitions.
     */
    routes: Record<string, string | { page: string; guards?: Array<typeof AvenxGuard | AvenxGuard> }>;

    /**
     * Info about the currently loaded route.
     */
    currentRoute: { hash: string; page: string; params: Record<string, any> } | null;

    /**
     * @param app AvenxApp instance.
     * @param routes Mapped routes.
     * @param options Router options.
     */
    constructor(
        app: AvenxApp,
        routes?: Record<string, string | { page: string; guards?: Array<typeof AvenxGuard | AvenxGuard> }>,
        options?: AvenxRouterOptions
    );

    /**
     * Starts listening to hash changes and processes the initial route.
     */
    start(): void;

    /**
     * Triggers a manual router navigation.
     * @param hash Target path hash (e.g. `#/profile/123`).
     */
    navigate(hash: string): void;

    /**
     * Destroys the router and cleans up event listeners.
     */
    destroy(): void;
}

/**
 * The main application class for Avenx.
 * Manages component registration, bridge registration, and mounting.
 */
export class AvenxApp {
    /**
     * Registered page classes map.
     */
    pages: Map<string, typeof AvenxPage>;

    /**
     * Registered component classes map.
     */
    components: Map<string, typeof AvenxComponent>;

    /**
     * Shared reactive bridges dictionary.
     */
    bridges: Record<string, any>;

    /**
     * Active router instance.
     */
    router: AvenxRouter | null;

    /**
     * @param config Main app configurations.
     */
    constructor(config: { target: string });

    /**
     * Registers a reusable component class.
     * @param name Component identifier (PascalCase).
     * @param compClass Component class extension.
     */
    register(name: string, compClass: typeof AvenxComponent): void;

    /**
     * Registers a routing page component class.
     * @param name Page name identifier.
     * @param pageClass Page class extension.
     */
    registerPage(name: string, pageClass: typeof AvenxPage): void;

    /**
     * Registers a shared state bridge.
     * @param name Bridge global identifier (e.g. `AuthBridge`).
     * @param bridgeData Raw object schema or instance.
     */
    registerBridge(name: string, bridgeData: Record<string, any> | Function): void;

    /**
     * Forces updates on all active component nodes.
     */
    updateAll(): void;

    /**
     * Mounts page by routing name.
     * @param name Page component name.
     * @param params Dynamic parsed path variables.
     */
    mountPage(name: string, params?: Record<string, any>): void;

    /**
     * Mounts a standalone component.
     * @param name Component registered name.
     * @param targetSelector Target DOM element query selector.
     */
    mount(name: string, targetSelector?: string | null): void;

    /**
     * Scaffolds hash-change router listeners.
     * @param routes Map of URL hashes.
     * @param options Router options.
     */
    initRouter(
        routes: Record<string, string | { page: string; guards?: Array<typeof AvenxGuard | AvenxGuard> }>,
        options?: AvenxRouterOptions
    ): AvenxRouter;
}

/**
 * Base class for global reactive bridges.
 */
export class AvenxBridge {
    constructor();
}

/**
 * Factory for creating reactive state proxies.
 */
export class StateFactory {
    constructor(handlerFactoryClass?: typeof ProxyHandlerFactory);
    create(initialState?: Record<string, any>, options?: Record<string, any>): Record<string, any>;
}

/**
 * Factory for creating state proxy traps.
 */
export class ProxyHandlerFactory {
    constructor(options?: {
        computedKeys?: string[];
        onChange?: () => void;
        getComputedValue?: (key: string, target: any) => any;
    });
    create(): ProxyHandler<any>;
}

/**
 * Handles virtual DOM recursive diffing and attribute syncs.
 */
export class DomPatcher {
    patch(target: Element, html: string): void;
}

/**
 * Manages keyed template iteration for lists.
 */
export class ListManager {
    constructor(evaluator: DynamicEvaluator, renderer: TemplateRenderer);
    process(root: Element, scope: Record<string, any>, state: Record<string, any>): void;
}

/**
 * Provides static HTML diff string algorithms.
 */
export class HtmlDiff {
    diff(oldHtml: string, newHtml: string): string;
}

/**
 * Binds event listeners recursively on elements.
 */
export class EventBinder {
    bind(root: Element | DocumentFragment, dispatcher: EventExecutor): void;
}

/**
 * Event wrapper to invoke custom methods.
 */
export class EventExecutor {
    constructor(runHandler: (source: string, event: Event | null) => any);
    execute(source: string, event?: Event | null): any;
}

/**
 * Safe expression evaluation context binder.
 */
export class DynamicEvaluator {
    evaluateExpression(expression: string, scope?: Record<string, any>, thisArg?: any): any;
    executeStatement(source: string, scope?: Record<string, any>, thisArg?: any): any;
    createMethodMap(
        methods: Record<string, string | Function>,
        getScope: (methods: any) => Record<string, any>,
        getThisArg: () => any
    ): Record<string, Function>;
}

/**
 * Evaluates template bracket expressions.
 */
export class TemplateRenderer {
    render(template: string, resolver: (expr: string) => any): string;
}

/**
 * Triggers initial mounting states.
 */
export class LifecycleManager {
    mount(component: AvenxComponent, target: Element | string): void;
}

export class ComputedRegistry {
    constructor(computed?: Record<string, string>);
    keys(): string[];
    get(key: string): string;
}

export class HtmlEscaper {
    escape(str: string): string;
}

export class SafeHtml {
    value: string;
    constructor(value: any);
    toString(): string;
}

export function html(strings: string | TemplateStringsArray, ...values: any[]): SafeHtml;

export class Sanitizer {
    sanitize(html: string): string;
}

export interface AvenxLoggerOptions {
    level?: string;
    silent?: boolean;
    formatter?: (level: string, args: any[]) => any[];
    transports?: Array<any | ((level: string, formattedArgs: any[], rawArgs: any[]) => void)>;
}

export class AvenxLogger {
    config: {
        level: string;
        silent: boolean;
        formatter: (level: string, args: any[]) => any[];
        transports: any[];
    };
    constructor(config?: AvenxLoggerOptions);
    configure(config: AvenxLoggerOptions): void;
    shouldLog(level: string): boolean;
    write(level: string, ...args: any[]): void;
    trace(...args: any[]): void;
    debug(...args: any[]): void;
    info(...args: any[]): void;
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    fatal(...args: any[]): void;
}

export const logger: AvenxLogger;

export const LogLevels: Record<string, number>;

export function defaultFormatter(level: string, args: any[]): any[];

export const consoleTransport: {
    log(level: string, formattedArgs: any[]): void;
};

