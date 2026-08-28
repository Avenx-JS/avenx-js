// Type definitions for Avenx-JS core runtime
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * Base class for all route guards in Avenx.
 */

export interface GuardControlObject {
    cancel?: boolean;
    silent?: boolean;
    redirect?: string;
    state?: Record<string, any>;
}

export type GuardResult =
    | boolean
    | string
    | GuardControlObject
    | Promise<boolean | string | GuardControlObject>;
export class AvenxGuard {
    /**
     * Determines whether the route can be activated.
     * Can return a boolean, a redirect string, control object,
     * or a Promise resolving to either.
     * @param to Target route information.
     * @param from Current route information.
     */
    canActivate(
        to: { hash: string; page: string; params: Record<string, any> },
        from: { hash: string; page: string; params: Record<string, any> } | null
    ): GuardResult;
    canDeactivate?(
        current: { hash: string; page: string; params: Record<string, any> },
        next: { hash: string; page: string; params: Record<string, any> }
    ): boolean | Promise<boolean>;
}

/**
 * Base class for all Avenx components.
 * Manages state, reactivity, rendering, and lifecycle.
 */
export class AvenxComponent<S extends Record<string, any> = Record<string, any>> {
    /**
     * The reactive state proxy of the component.
     * When a generic state shape `S` is provided, this property is fully typed.
     */
    state: S;

    /**
     * The reactive props of the component.
     */
    props: Record<string, any>;

    /**
     * The component instance that mounted this component, or null for root components.
     */
    readonly $parent: AvenxComponent<any> | null;

    /**
     * Template refs collected from `data-ax-ref` markers.
     * Resolves to a component instance when the host element has `__avenx_comp_instance`, otherwise the DOM element.
     */
    readonly $refs: Record<string, Element | AvenxComponent<any> | undefined>;

    /**
     * True while the component is mounted in the DOM.
     */
    readonly $isMounted: boolean;

    /**
     * True after the component has been unmounted.
     */
    readonly $isUnmounted: boolean;

    /**
     * Helpers for inspecting whether the parent provided slot content.
     */
    readonly $slots: {
        /**
         * Returns true when content was provided for the named slot (or the default slot).
         * @param slotName Named slot, or `default` / omitted for the default slot.
         */
        has(slotName?: string): boolean;
    };

    /**
     * Programmatically clear cached KeepAlive component instances.
     */
    readonly $keepAlive: {
        clear(componentName?: string): boolean;
    };

    /**
     * Helper method to clear cached KeepAlive component instances.
     * @param pageName Optional component or page name to clear from cache.
     */
    clearKeepAliveCache(pageName?: string): boolean;

    /**
     * The component's root DOM element, or null before mount / after unmount.
     */
    readonly $element: Element | null;

    /**
     * The application instance this component belongs to.
     */
    readonly $app?: AvenxApp;

    /**
     * Diagnostic context used when the component reports a warning or error.
     */
    readonly $logContext: {
        componentName: string;
        fileName: string | null;
        component: AvenxComponent<any>;
    };

    /**
     * Returns a diagnostic snapshot of the component for runtime debugging.
     * Props and state are sanitized clones; `element` is the live root element.
     * Computed properties are listed by key only, so inspecting never evaluates them.
     */
    $inspect(): {
        componentName: string;
        props: Record<string, any>;
        state: Record<string, any>;
        computed: string[];
        slots: string[];
        element: Element | null;
    };

    /**
     * Emits a custom DOM event from the component's root element.
     * @param eventName Name of the event to emit.
     * @param detail Event detail payload.
     * @param options Custom event options.
     */
    emit(eventName: string, detail?: any, options?: CustomEventInit): void;

    /**
     * Emits a composed custom event to parent components.
     * @param eventName Name of the event to emit.
     * @param detail Event detail payload.
     */
    $emit(eventName: string, detail?: any): void;

    /**
     * Schedules an asynchronous update in the next microtask flush.
     */
    scheduleUpdate(): void;

    /**
     * Performs the synchronous render and DOM patch for this component.
     */
    runUpdate(): void;

    /**
     * Unmounts the component and tears down watchers and resources.
     * Alias for {@link AvenxComponent#unmount}.
     */
    $destroy(): void | Promise<void>;

    /**
     * Trips a named `<@deadlock>` boundary in this component's DOM tree,
     * rendering its fallback template.
     * @param boundaryName Boundary name, or null for the first boundary.
     * @param error Error context passed to the fallback template.
     */
    $tripDeadlockBoundary(boundaryName?: string | null, error?: Error | object): void;

    /**
     * Resets a named `<@deadlock>` boundary in this component's DOM tree.
     * @param boundaryName Boundary name, or null for the first boundary.
     */
    $resetDeadlockBoundary(boundaryName?: string | null): void;

    /**
     * The active route details.
     */
    readonly $route: {
        hash: string;
        path: string;
        page: string;
        params: Record<string, any>;
        query: Record<string, string | boolean | number>;
    };

    /**
     * Runs after the current reactive DOM update flush completes.
     * With a callback, invokes it after the flush. Without a callback, returns a Promise.
     */
    $nextTick(callback: () => void): void;
    $nextTick(): Promise<void>;

    /**
     * Alias for {@link AvenxComponent#$nextTick}.
     */
    nextTick(callback: () => void): void;
    nextTick(): Promise<void>;

    /**
     * Keys or mappings to share reactively with descendant components.
     */
    provide?: Record<string, any> | (() => Record<string, any>) | string[];

    /**
     * Keys or mappings injected from ancestor components.
     * Object values may be provide-key strings or `{ from?, default }` configs.
     */
    inject?:
        | Record<string, string | { from?: string; default?: any }>
        | (() => Record<string, string | { from?: string; default?: any }>)
        | string[];

    /**
     * @param initialState Initial component state variables.
     * @param computed Map of computed properties to their expression strings.
     * @param bridges Global reactive bridges injected into this component.
     * @param template Compiled HTML template string.
     * @param methods Component action methods.
     * @param props Input properties passed down from parent.
     */
    constructor(
        initialState?: S,
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
    unmount(): void | Promise<void>;

    /**
     * Called before the component leaves the DOM. Can return a Promise to delay DOM removal.
     */
    onBeforeLeave?(): void | Promise<void>;

    /**
     * Called when the component is mounted and enters the DOM.
     */
    onEnter?(): void;

    /**
     * Called when the component leaves the DOM and unmounts.
     */
    onLeave?(): void;

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
     * Component before update lifecycle hook (action).
     */
    onBeforeUpdate?(): void;

    /**
     * Component unmount lifecycle hook (action).
     */
    onUnmount?(): void;

    /**
     * Component activated from keep-alive cache hook.
     */
    onActivate?(params?: Record<string, any>): void;

    /**
     * Component deactivated/cached hook.
     */
    onDeactivate?(): void;

    /**
     * Programmatically registers a watcher on a reactive expression/function.
     * @param getter Evaluation function returning value to watch.
     * @param callback Triggers when the value changes.
     * @param options Config options.
     */
    watch(
        getter: () => any,
        callback: (newValue: any, oldValue: any) => void,
        options?: { immediate?: boolean; lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number }
    ): AvenxWatcher;

    /**
     * Reactively listens to changes in specific state values or getters.
     * @param source State property key string, getter function, or array of sources.
     * @param callback Triggered when value changes.
     * @param options Config options.
     */
    $watch(
        source: string | (() => any) | Array<string | (() => any)>,
        callback: (newValue: any, oldValue: any) => void,
        options?: { immediate?: boolean; lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number }
    ): AvenxWatcher;

    /**
     * Reactively runs an immediate effect hook that automatically tracks dependencies and re-runs on state mutation.
     * Automatically registers watcher in _watchers and tears it down on unmount.
     * @param effect Effect function to run immediately and track.
     * @param options Config options.
     * @returns Stop handle function.
     */
    $watchEffect(
        effect: () => void,
        options?: { lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number; name?: string }
    ): () => void;

    /**
     * Evaluates validation rules for an element and updates state.$validation.
     * @param el Element to validate.
     */
    $validateElement(el: Element): string[];

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

    /**
     * Retrieves the transcluded groups for this component.
     * @protected
     */
    _getTranscludedGroups(): Record<string, any>;

    /**
     * Helper method to programmatically create component subclasses without ES class boilerplate.
     * @param options Component definition options.
     * @returns A new component subclass.
     */
    static extend<
        S extends Record<string, any> = Record<string, any>,
        M extends Record<string, Function> = Record<string, Function>,
        C extends Record<string, any> = Record<string, any>,
        P extends Record<string, any> = Record<string, any>
    >(
        options?: ComponentExtendOptions<S, M, C, P>
    ): typeof AvenxComponent & (new (bridges?: Record<string, any>, props?: P) => AvenxComponent<S> & M & C);

    /**
     * Registers a global mixin.
     * @param mixin The mixin definition.
     */
    static mixin(mixin: Record<string, any>): void;

    /**
     * Resets/clears the global mixins list.
     */
    static clearMixins(): void;
}

/**
 * Options accepted by {@link AvenxComponent.extend}.
 */
export interface ComponentExtendOptions<
    S extends Record<string, any> = Record<string, any>,
    M extends Record<string, Function> = Record<string, Function>,
    C extends Record<string, any> = Record<string, any>,
    P extends Record<string, any> = Record<string, any>
> {
    name?: string;
    state?: S | (() => S);
    data?: S | (() => S);
    computed?: C;
    methods?: M;
    template?: string;
    props?: P;
    styles?: Record<string, string>;
    resources?: Record<string, any>;
    watch?: Record<
        string,
        | ((newVal: any, oldVal: any) => void)
        | { handler: (newVal: any, oldVal: any) => void; immediate?: boolean; deep?: boolean }
    >;
    provide?: Record<string, any> | (() => Record<string, any>) | string[];
    inject?:
        | Record<string, string | { from?: string; default?: any }>
        | (() => Record<string, string | { from?: string; default?: any }>)
        | string[];
    contracts?: string[] | Set<string>;
    options?: Record<string, any>;
    onBeforeMount?(): void;
    onMount?(): void;
    onBeforeUpdate?(): void;
    onUpdate?(): void;
    onUnmount?(): void;
    onActivate?(params?: Record<string, any>): void;
    onDeactivate?(): void;
    onErrorCaptured?(error: Error): boolean | void;
    onEnter?(): void;
    onLeave?(): void;
    onBeforeLeave?(): void | Promise<void>;
    [key: string]: any;
}

/**
 * AvenxPage is a specialized component that can host child components.
 * It automatically mounts child components defined in its template via [data-avenx-comp].
 */
export class AvenxPage<S extends Record<string, any> = Record<string, any>> extends AvenxComponent<S> {
    /**
     * @param initialState Initial page state.
     * @param computed Page computed properties.
     * @param bridges Page shared bridges.
     * @param template Page HTML template.
     * @param methods Page methods / lifecycle actions.
     * @param componentRegistry Component class registry map.
     */
    constructor(
        initialState?: S,
        computed?: Record<string, string>,
        bridges?: Record<string, any>,
        template?: string,
        methods?: Record<string, string | Function>,
        componentRegistry?: Map<string, typeof AvenxComponent>,
        props?: Record<string, any>
    );
}

/**
 * Built-in component for high-performance virtualized list rendering.
 */
export class VirtualList extends AvenxComponent<any> {
    constructor(
        bridges?: Record<string, any>,
        props?: Record<string, any>
    );
    currentPage: number;
    goToPage(targetPage: number): void;
    nextPage(): void;
    prevPage(): void;
}

export interface RouterA11yOptions {
    /**
     * Whether to shift focus to the new page or target after navigation (default is true).
     */
    focusOnNavigate?: boolean;

    /**
     * Whether to announce the route title change to screen readers via a live region (default is true).
     */
    announceRouteChanges?: boolean;

    /**
     * Optional CSS selector to target for focus (default is '[data-ax-page-heading]').
     */
    focusTarget?: string;
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
     * Optional custom navigation delegate.
     */
    delegate?: NavigationDelegate;

    /**
     * Navigation mode ('hash' | 'memory').
     */
    mode?: 'hash' | 'memory' | string;

    /**
     * Initial hash string for memory navigation delegate.
     */
    initialHash?: string;

    /**
     * The time in milliseconds to wait before a route guard execution times out (default is 5000ms).
     */
    guardTimeout?: number;

    /**
     * The target hash path to redirect to if a route guard times out (e.g. '#/').
     */
    guardTimeoutRedirect?: string;

    /**
     * A string prepended to every resolved route title.
     */
    titlePrefix?: string;

    /**
     * A string appended to every resolved route title (e.g. ' — MyApp').
     */
    titleSuffix?: string;

    /**
     * Controls scroll position after successful navigation.
     * - `'top'` (default): scroll to (0, 0)
     * - `'auto'`: restore the last saved position for the target hash, otherwise scroll to top
     * - `'manual'`: do not change scroll position
     */
    scrollRestoration?: 'top' | 'auto' | 'manual';
    
    /**
     * Accessibility options for focus management and route announcements.
     */
    a11y?: RouterA11yOptions;
}

/**
 * Definition object for a single route entry.
 */
export interface AvenxRouteDefinition {
    /**
     * The registered page name to mount for this route.
     */
    page: string;

    /**
     * Optional guards to evaluate before activating this route.
     */
    guards?: Array<typeof AvenxGuard | AvenxGuard>;

    /**
     * Optional page title. Can be a static string or a function receiving
     * the parsed route params and returning a string.
     */
    title?: string | ((params: Record<string, any>) => string);

    /**
     * Optional transition name for page enter/leave animations.
     */
    transition?: string;
}

/**
 * Base abstract class defining the navigation delegate interface.
 */
export class NavigationDelegate {
    getHash(): string;
    setHash(hash: string, options?: { replace?: boolean }): void;
    back(): void;
    forward(): void;
    go(delta: number): void;
    onHashChange(callback: (hash: string) => void): () => void;
    onLinkClick(callback: (route: string) => void): () => void;
    setTitle(title: string): void;
    registerRouter(router: any): void;
    unregisterRouter(router: any): void;
    getActiveRouters(): Set<any>;
    destroy(): void;
}

/**
 * Browser navigation delegate interacting with window, location, and history.
 */
export class BrowserNavigationDelegate extends NavigationDelegate {
    hashListeners: Set<(hash: string) => void>;
    linkClickListeners: Set<(route: string) => void>;
    onWindowHashChange: () => void;
    onWindowClick: (e: any) => void;
}

/**
 * In-memory navigation delegate for Node.js / SSR / headless environments.
 */
export class MemoryNavigationDelegate extends NavigationDelegate {
    history: string[];
    cursorIndex: number;
    currentHash: string;
    title: string;
    hashListeners: Set<(hash: string) => void>;
    linkClickListeners: Set<(route: string) => void>;
    activeRouters: Set<any>;
    constructor(initialHash?: string);
}

/**
 * Factory function creating a navigation delegate based on options.
 */
export function createNavigationDelegate(options?: AvenxRouterOptions): NavigationDelegate;

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
    routes: Record<string, string | AvenxRouteDefinition>;

    /**
     * Returns the registered routes as pattern/definition pairs.
     */
    getRoutes(): Array<{ pattern: string; definition: string | AvenxRouteDefinition }>;

    /**
     * Info about the currently loaded route.
     */
    currentRoute: { hash: string; page: string; params: Record<string, any> } | null;

    /**
     * Active navigation delegate.
     */
    delegate: NavigationDelegate;

    /**
     * @param app AvenxApp instance.
     * @param routes Mapped routes.
     * @param options Router options.
     */
    constructor(
        app: AvenxApp,
        routes?: Record<string, string | AvenxRouteDefinition>,
        options?: AvenxRouterOptions
    );

    /**
     * Registers a global guard callback that executes before route guards on navigation transitions.
     * @param callback The guard callback or guard instance/class.
     * @returns Unregister function.
     */
    beforeEach(
        callback: (
            to: { hash: string; page: string; params: Record<string, any> },
            from: { hash: string; page: string; params: Record<string, any> } | null
        ) => boolean | string | object | void | Promise<boolean | string | object | void> | typeof AvenxGuard | AvenxGuard
    ): () => void;

    /**
     * Registers a global after hook callback that executes after successful route navigation.
     * @param callback The callback to execute after navigation.
     * @returns Unregister function.
     */
    afterEach(
        callback: (
            to: { hash: string; page: string; params: Record<string, any> },
            from: { hash: string; page: string; params: Record<string, any> } | null
        ) => void
    ): () => void;

    /**
     * Starts listening to hash changes and processes the initial route.
     */
    start(): void;

    /**
     * Triggers a manual router navigation.
     * @param hash Target path hash (e.g. `#/profile/123`).
     * @param options Navigation options.
     */
    navigate(hash: string, options?: { replace?: boolean }): void;

    /**
     * Steps backward in navigation history.
     */
    back(): void;

    /**
     * Steps forward in navigation history.
     */
    forward(): void;

    /**
     * Moves to a specific history position relative to current position.
     * @param delta Relative step count in history (e.g. -1 for back, 1 for forward).
     */
    go(delta: number): void;

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
     * Registered custom directives.
     */
    directives: Map<string, any>;

    /**
     * Active router instance.
     */
    router: AvenxRouter | null;

    /**
     * The currently active page component instance, or null when none is mounted.
     */
    readonly activePage: AvenxComponent<any> | null;

    /**
     * Returns the names of all registered components.
     */
    getRegisteredComponents(): string[];

    /**
     * Returns the names of all registered pages.
     */
    getRegisteredPages(): string[];

    /**
     * @param config Main app configurations.
     */
    constructor(config: { target: string; logging?: any; enableProfiling?: boolean });

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
    registerBridge(name: string, bridgeData: Record<string, any>): void;

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
     * Programmatically clears cached KeepAlive component instances.
     * @param componentName Optional component or page name to purge.
     * @returns boolean True if cache entries were evicted.
     */
    clearKeepAliveCache(componentName?: string): boolean;

    /**
     * Scaffolds hash-change router listeners.
     * @param routes Map of URL hashes.
     * @param options Router options.
     */
    initRouter(
        routes: Record<string, string | AvenxRouteDefinition>,
        options?: AvenxRouterOptions
    ): AvenxRouter;

    /**
     * Registers an application-wide error handler callback.
     * @param callback Callback triggered when an unhandled lifecycle or event handler error occurs.
     */
    onError(callback: (error: Error, component: AvenxComponent, origin: string) => void): this;

    /**
     * Registers an application-wide warning handler callback.
     * @param callback Callback triggered when a framework warning is reported.
     */
    onWarn(callback: (warningMessage: string, component?: AvenxComponent, code?: string) => void): this;

    /**
     * Registers a plugin with the application. Supports synchronous plugins, async installer functions, dynamic import loaders, or Promises.
     * @param plugin The plugin object, installer function, async loader function, or Promise.
     * @param options Optional configurations for the plugin.
     * @returns The app instance or a Promise resolving to the app instance.
     */
    use(
        plugin:
            | ((app: AvenxApp, options?: Record<string, any>) => any)
            | { install(app: AvenxApp, options?: Record<string, any>): any }
            | (() => Promise<any>)
            | Promise<any>,
        options?: Record<string, any>
    ): this | Promise<this>;

    /**
     * Registers a custom directive.
     * @param name Directive name.
     * @param definition Directive lifecycle definition.
     */
    directive(name: string, definition: {
        mounted?(el: any, binding: { value: any; expression: string }): void;
        updated?(el: any, binding: { value: any; oldValue: any; expression: string }): void;
        unmounted?(el: any, binding: { value: any; oldValue: any; expression: string }): void;
    }): this;
}

/** Releases a bridge subscription. Safe to call more than once. */
export type BridgeUnsubscribe = () => void;

/** Keys of a bridge definition that name an action. */
type BridgeActionKeys<D> = {
    [K in keyof D]: K extends 'state' | 'setup' ? never : D[K] extends (...args: any[]) => any ? K : never;
}[keyof D];

/** Keys of a bridge definition that name a derived (getter) value. */
type BridgeDerivedKeys<D> = {
    [K in keyof D]: K extends 'state' | 'setup' ? never : D[K] extends (...args: any[]) => any ? never : K;
}[keyof D];

/** The shared state object declared by a bridge definition. */
type BridgeStateOf<D> = D extends { state: infer S } ? S : Record<never, never>;

/** The actions declared by a bridge definition. */
type BridgeActionsOf<D> = Pick<D, BridgeActionKeys<D>>;

/** The derived values declared by a bridge definition. */
type BridgeDerivedOf<D> = Pick<D, BridgeDerivedKeys<D>>;

/**
 * The value bound to `this` inside actions, getters and `setup()`.
 * State is writable here and `emit` is available; both are withheld from
 * consumers so that every mutation and every event has one origin.
 */
export type BridgeSelf<D> = BridgeStateOf<D> &
    Readonly<BridgeDerivedOf<D>> &
    BridgeActionsOf<D> & {
        /** Broadcasts an event to every subscriber. */
        emit(event: string, payload?: unknown): void;
    };

/**
 * The bridge instance a module exports and components import.
 * State and derived values are read-only; mutation goes through actions.
 */
export type Bridge<D> = Readonly<BridgeStateOf<D>> &
    Readonly<BridgeDerivedOf<D>> &
    BridgeActionsOf<D> & {
        /**
         * Subscribes to an event emitted by this bridge.
         * Called from a component lifecycle hook or event handler, the
         * subscription is released automatically when that component unmounts.
         * @returns A function that unsubscribes early.
         */
        on<P = any>(event: string, handler: (payload: P) => void): BridgeUnsubscribe;
        /** Runs the cleanup from `setup()`, drops listeners and restores initial state. */
        $dispose(): void;
        /** Diagnostic name, derived from the file name by the compiler. */
        readonly $name: string;
    };

/**
 * Creates a Bridge: a reactive unit of shared state and behaviour that
 * components consume by importing it.
 * @example
 * export default bridge({
 *   state: { user: null as User | null },
 *   get isLoggedIn() { return this.user !== null; },
 *   login(user: User) { this.user = user; this.emit('login', user); },
 * });
 */
export function bridge<D extends object>(definition: D & ThisType<BridgeSelf<D>>): Bridge<D>;

/** Reports whether a value is a bridge instance created by `bridge()`. */
export function isBridge(value: unknown): boolean;

/** Assigns a bridge its diagnostic name. Emitted by the compiler. */
export function defineBridgeName<T>(name: string, instance: T): T;

/**
 * Collects teardown callbacks and releases them together. Components own one
 * and dispose it on unmount, which is how bridge subscriptions are released.
 */
export class DisposalScope {
    constructor(name?: string);
    readonly name: string;
    readonly disposed: boolean;
    /** Registers a teardown callback; returns a run-once release function. */
    add(disposer: () => void): () => void;
    /** Runs every registered teardown callback. */
    dispose(): void;
}

/** Returns the scope that currently owns new teardown callbacks. */
export function getScope(): DisposalScope | null;

/** Runs a function with the given scope active. Pass null to detach ownership. */
export function runInScope<T>(scope: DisposalScope | null, fn: () => T): T;

/** Registers a teardown callback with the active scope, if there is one. */
export function onScopeDispose(disposer: () => void): () => void;

/**
 * Factory for creating reactive state proxies.
 */
export class StateFactory {
    constructor(handlerFactoryClass?: typeof ProxyHandlerFactory);
    create<T extends Record<string, any> = Record<string, any>>(initialState?: T, options?: Record<string, any>): T;
}

/** Returns the underlying raw object for a reactive proxy. */
export function toRaw<T>(target: T): T;

/** Returns true when value is an Avenx reactive proxy. */
export function isReactive(value: unknown): boolean;

/** Marks an object so it will not be wrapped by reactive proxies. */
export function markRaw<T extends object>(target: T): T;

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
 * Manages deferred loading (<@defer>) of DOM subtrees.
 */
export class DeferManager {
    constructor(evaluator: DynamicEvaluator, renderer: TemplateRenderer, eventBinder?: EventBinder, componentName?: string);
    process(root: Element, scope: Record<string, any>, state: Record<string, any>, app?: any): void;
    isLoaded(el: Element): boolean;
    loadDeferredContent(container: Element, scope: Record<string, any>, state: Record<string, any>, app?: any): void;
    destroy(): void;
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
    constructor(runHandler: (source: string | Function, event: Event | null) => any);
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
    constructor(capacityOrConfig?: number | { capacity?: number; templateCacheCapacity?: number });
    capacity: number;
    cache: LruCache;
    clearCache(): void;
    render(template: string, resolver: (expr: string) => any): string;
}

/**
 * Triggers initial mounting states.
 */
export class LifecycleManager {
    mount(component: AvenxComponent<any>, target: Element | string): void;
}

export class ComputedRegistry {
    constructor(computed?: Record<string, string>);
    keys(): string[];
    get(key: string): string;
}

export class HtmlEscaper {
    escape(str: string): string;
    unescape(str: string): string;
}

export class SafeHtml {
    value: string;
    constructor(value: any);
    toString(): string;
}

export function html(strings: string | TemplateStringsArray, ...values: any[]): SafeHtml;
export function unescapeHtml(str: string): string;

export class Sanitizer {
    sanitize(html: string): string;
    static sanitizeUrl(url: string, allowedProtocols?: string[]): string;
    static stripTags(html: string): string;
}

export interface AvenxLoggerOptions {
    level?: string;
    silent?: boolean;
    formatter?: (level: string, args: any[]) => any[];
    transports?: Array<any | ((level: string, formattedArgs: any[], rawArgs: any[]) => void)>;
}

export interface AvenxLoggerBindings {
    prefix?: string;
    componentName?: string;
}

export class AvenxLogger {
    config: {
        level: string;
        silent: boolean;
        formatter: (level: string, args: any[]) => any[];
        transports: any[];
    };
    bindings: Record<string, any>;
    constructor(config?: AvenxLoggerOptions);
    configure(config: AvenxLoggerOptions): void;
    setLevel(level: string): void;
    shouldLog(level: string): boolean;
    write(level: string, ...args: any[]): void;
    child(bindings?: string | AvenxLoggerBindings): AvenxLogger;
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

export function formatContextTag(context: any): string;

export function defaultFormatter(level: string, args: any[]): any[];

export const consoleTransport: {
    log(level: string, formattedArgs: any[]): void;
};

export interface ResourceOptions {
    pollInterval?: number;
}

export type ResourceStatus = 'idle' | 'pending' | 'resolved' | 'rejected';

export class Resource<T = any> {
    constructor(
        name: string,
        handlerFn: () => any,
        componentContext?: object | ResourceOptions,
        options?: ResourceOptions
    );

    name: string;
    status: ResourceStatus;
    value: T | undefined;
    error: any;
    promise: Promise<T> | null;
    pollInterval: number;

    read(): T;
    fetch(result?: any): void;
    teardown(): void;
}

export class AvenxWatcher {
    getter: () => any;
    callback: ((newValue: any, oldValue: any) => void) | null;
    options: { immediate?: boolean; lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number; name?: string; isEffect?: boolean; effect?: boolean };
    value: any;
    dirty: boolean;
    isEffect: boolean;
    constructor(
        getter: () => any,
        callback?: ((newValue: any, oldValue: any) => void) | object | null,
        options?: { immediate?: boolean; lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number; name?: string; isEffect?: boolean; effect?: boolean }
    );
    get(): any;
    evaluate(): any;
    teardown(): void;
}

export function watchEffect(
    effect: () => void,
    options?: { lazy?: boolean; deep?: boolean; debounce?: number; throttle?: number; name?: string }
): () => void;

export function initInspector(app: AvenxApp): void;

export class LruCache<T = any> {
    limit: number;
    onEvict: ((key: string, value: T) => void) | null;
    cache: Map<string, T>;
    constructor(limit: number, onEvict?: ((key: string, value: T) => void) | null);
    get(key: string): T | undefined;
    set(key: string, value: T): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    readonly size: number;
}

export function profile<T = any>(enableProfiling: boolean, componentName: string, phase: string, fn: () => T): T;
export function getComponentProfilingInfo(element: any): { enableProfiling: boolean; componentName: string };

export class DeadlockManager {
    constructor(evaluator: any, renderer: any, eventBinder?: any, componentName?: string);
    isTripped(container: any): boolean;
    findBoundaries(root: any): any[];
    trip(container: any, error?: Error | object, scope?: object): void;
    reset(container: any): void;
}

export function setSchedulerMaxFlushCount(count: number): void;
export function getSchedulerMaxFlushCount(): number;
export interface SchedulerDeadlockEvent {
    cyclePath: string;
    triggeringJobId?: any;
    executionHistory?: Array<{ id: any; name: string; job: Function }>;
}
export function onSchedulerDeadlock(handler: (event: SchedulerDeadlockEvent) => void): () => void;
export function resetScheduler(): void;

export function getActiveCausationTrace(): string[];
export function clearCausationTrace(): void;



/**
 * Queues a job to run in the next scheduler flush. Duplicate jobs are ignored.
 */
export function queueJob(job: Function): void;

/**
 * Queues a callback to run after the current flush completes.
 */
export function queueFlushCallback(callback: Function): void;

/**
 * Enables or disables reactivity debug logging.
 */
export function setDebugReactivity(enabled: boolean): void;

/**
 * Returns whether reactivity debug logging is currently enabled.
 */
export function isDebugReactivityEnabled(): boolean;

export interface ValidationRule {
    name: string;
    param?: string;
}

/**
 * Parses a `data-ax-validate` rule string into structured rules.
 */
export function parseValidationRules(ruleString: string): ValidationRule[];

/**
 * Validates a value against parsed rules, returning the resulting error messages.
 */
export function validateValue(
    value: any,
    rules: ValidationRule[],
    options?: { state?: Record<string, any>; customMessages?: Record<string, string> }
): string[];

/**
 * Resolves the field name used for validation state on an input element.
 */
export function getFieldName(element: Element): string;

/**
 * Writes validation errors for a field into the component's `$validation` state.
 */
export function updateValidationState(state: Record<string, any>, fieldName: string, errors: string[]): void;

/**
 * Matches hash routes against route definitions.
 */
export class RouteMatcher {
    static normalizeHash(hash: string, prefix?: string): string | null;
    static matches(routes: Record<string, any>, hash: string, options?: object): boolean;
    static matchRoute(
        routes: Record<string, any>,
        hash: string,
        options?: object,
        activeRouters?: Iterable<object>,
        currentRouter?: object | null
    ): {
        matchedRoute: { definition: any; parent?: any } | null;
        params: Record<string, any>;
        query?: Record<string, any>;
        path?: string;
        otherRouterMatches?: boolean;
        normalizedHash: string | null;
    };
}

/**
 * Mounts and de-duplicates component `<style>` blocks in the document head.
 */
export class StyleMountManager {
    mount(id: string, css: string): void;
    unmount(id: string): void;
    clear(): void;
}

/**
 * Shared StyleMountManager instance used by the runtime.
 */
export const styleMountManager: StyleMountManager;

// ---------------------------------------------------------------------------
// Trace recording
//
// Only the recording half of `avenx trace` ships in the runtime, because that
// is the half that has to run in a real browser next to a real bug. Replay,
// the causal viewer and test generation live behind `avenx-core/testing` and
// the CLI, where an application bundle cannot reach them.
// ---------------------------------------------------------------------------

/** How a trace node relates to Avenx's execution model. */
export type TraceNodeKind =
    | 'event'
    | 'action'
    | 'bridge-action'
    | 'bridge-emit'
    | 'write'
    | 'watcher'
    | 'computed'
    | 'dom'
    | 'resource'
    | 'navigation'
    | 'global'
    | 'error'
    | 'contract';

/** Whether a recorded session can be faithfully replayed. */
export type TraceDeterminism = 'deterministic' | 'best-effort';

/** A reference to a DOM node that both reads well and resolves again on replay. */
export interface TraceNodeRef {
    selector: string;
    nth: number;
}

/** One recorded step. Causality is expressed by `parent`, not by nesting. */
export interface TraceNode {
    id: number;
    parent: number | null;
    seq: number;
    /** Milliseconds since the recording started. */
    t: number;
    type: TraceNodeKind;
    [field: string]: any;
}

/** A complete recording. */
export interface Trace {
    traceVersion: number;
    id: string;
    createdAt: string;
    determinism: {
        status: TraceDeterminism;
        reasons: Array<{ reason: string; detail?: string }>;
    };
    meta: Record<string, any>;
    /** Non-deterministic values the sandbox handed out, in observation order. */
    globals: { now?: number[]; random?: number[] };
    /** Property-path patterns whose values were withheld. */
    redactions: string[];
    redacted?: boolean;
    /** How many nodes the ring buffer dropped, if any. */
    dropped: number;
    nodes: TraceNode[];
}

/** Records one session's causal trace. */
export class TraceRecorder {
    constructor(options?: {
        id?: string;
        maxNodes?: number;
        redact?: string[];
        meta?: Record<string, any>;
    });
    readonly id: string;
    readonly nodes: TraceNode[];
    /** Only ever downgrades: a recording never talks itself back up to deterministic. */
    readonly isDeterministic: boolean;
    readonly componentCount: number;
    /** Switches from application startup to recording user interaction. */
    arm(): TraceRecorder;
    stop(): TraceRecorder;
    toJSON(): Trace;
    serialize(indent?: number): string;
}

/** Starts recording, replacing any recording already in progress. */
export function startRecording(options?: {
    id?: string;
    maxNodes?: number;
    redact?: string[];
    meta?: Record<string, any>;
}): TraceRecorder;

/** Stops the active recording and returns the finished trace. */
export function stopRecording(): Trace | null;

/** The recorder currently attached, if any. */
export function activeRecorder(): TraceRecorder | null;

/** The control surface `avenx serve --trace` publishes on `window.avenxTrace`. */
export interface TraceController {
    readonly id: string;
    readonly size: number;
    readonly deterministic: boolean;
    /** Posts the current trace to the dev server. */
    save(): Promise<{ ok: boolean; id?: string; error?: string }>;
    /** The trace as it stands, without saving it. */
    snapshot(): Trace;
    stop(): Trace | null;
}

/**
 * Starts browser recording and publishes `window.avenxTrace`.
 *
 * Called by the dev server only for `avenx serve --trace`. Nothing in the
 * trace runtime runs until this is called.
 */
export function installTraceRecorder(options?: {
    endpoint?: string;
    redact?: string[];
    maxNodes?: number;
    autoSave?: boolean;
}): TraceController;

/** Stops a recording started by installTraceRecorder. */
export function uninstallTraceRecorder(): Trace | null;

/** Whether a browser recording is currently running. */
export function isRecording(): boolean;

/** Where installTraceRecorder posts a saved trace. */
export const TRACE_ENDPOINT: string;
