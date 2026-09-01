// Type definitions for Avenx-JS testing utilities
// Import from 'avenx-core/testing'.

import { AvenxComponent } from './index.js';

export interface MockBridgeStateChange {
    prop: string;
    value: any;
}

export interface MockBridgeCall {
    method: string;
    args: any[];
}

export type MockBridge<T> = T & {
    $calls: MockBridgeCall[];
    $stateChanges: MockBridgeStateChange[];
    $onStateChange(cb: (prop: string, value: any) => void): () => void;
    $onCall(cb: (method: string, args: any[]) => void): () => void;
    $reset(): void;
    readonly $isMock: true;
};

export class AvenxMock {
    static createMockBridge<T extends object>(
        bridgeClassOrObject: T | (new (...args: any[]) => T),
        initialData?: Partial<T> | Record<string, any>
    ): MockBridge<T>;

    static createSandbox(): AvenxSandbox;

    static createMockRouter(options?: {
        currentRoute?: { hash?: string; page?: string; params?: Record<string, any> };
        hash?: string;
        page?: string;
        params?: Record<string, any>;
        queryParams?: Record<string, any>;
        guards?: Array<
            | ((to: any, from: any) => boolean | string | void)
            | { canActivate: (to: any, from: any) => boolean | string | void }
        >;
    }): {
        currentRoute: { hash: string; page: string; params: Record<string, any> };
        push(path: string): boolean;
        replace(path: string): boolean;
        getParams(): Record<string, any>;
        $calls: Array<{ method: string; args: any[]; blocked?: boolean }>;
        $reset(): void;
        readonly $isMock: true;
    };

    static trigger(element: any, eventName: string, eventData?: Record<string, any>): void;

    static mountTestComponent<C extends AvenxComponent<any> = AvenxComponent<any>>(
        ComponentClass: new (...args: any[]) => C,
        options?: MountTestComponentOptions
    ): Promise<MountTestComponentResult<C>>;

    static fireEvent(
        element: any,
        eventType: string,
        detail?: Record<string, any>
    ): Promise<void>;

    static flushPromises(): Promise<void>;
}

export interface MountTestComponentOptions {
    props?: Record<string, any>;
    slots?: Record<string, any> | string | any;
    state?: Record<string, any>;
    initialState?: Record<string, any>;
    bridges?: Record<string, any>;
    components?: Record<string, typeof AvenxComponent>;
    container?: any;
    route?: Record<string, any>;
}

export interface MountTestComponentResult<C = AvenxComponent<any>> {
    instance: C;
    component: C;
    element: any;
    container: any;
    update(): void;
    unmount(): void;
    readonly html: string;
    find(selector: string): any | null;
    findAll(selector: string): any[];
    findComponent(ComponentClassOrName: any): AvenxComponent<any> | null;
    trigger(selectorOrEl: any, eventName: string, detail?: Record<string, any>): Promise<void>;
}

export function mountTestComponent<C extends AvenxComponent<any> = AvenxComponent<any>>(
    ComponentClass: new (...args: any[]) => C,
    options?: MountTestComponentOptions
): Promise<MountTestComponentResult<C>>;

export function fireEvent(
    element: any,
    eventType: string,
    detail?: Record<string, any>
): Promise<void>;

export function flushPromises(): Promise<void>;

export class AvenxSandbox {
    components: Map<string, typeof AvenxComponent>;
    bridges: Record<string, any>;
    constructor();
    register(name: string, compClass: typeof AvenxComponent): this;
    registerBridge(name: string, bridgeInstance: any): this;
    setRoute(route: { hash?: string; page?: string; params?: Record<string, any> }): this;
    waitForUpdate(): Promise<void>;
    mount(
        compClass: typeof AvenxComponent,
        props?: Record<string, any>,
        container?: any
    ): {
        instance: AvenxComponent<any>;
        container: any;
        readonly html: string;
        update(): void;
        trigger(selectorOrElement: any, eventName: string, eventData?: Record<string, any>): void;
    };
}

// ---------------------------------------------------------------------------
// Trace replay
//
// Replay drives a recording's inputs back into a real application and compares
// what happens against what was recorded. It lives here rather than in the
// runtime because it exists to serve tests, and an application bundle must not
// carry it.
// ---------------------------------------------------------------------------

import type { Trace, TraceDeterminism, TraceRecorder } from './index.js';

export { TraceRecorder, startRecording, stopRecording, activeRecorder } from './index.js';

/** One replayed input and how it compared against the recording. */
export interface ReplayStep {
    index: number;
    type: string;
    /** A short label such as `click <button.qty-inc>`. */
    label: string;
    /** Observation signatures the recording holds for this step. */
    expected: string[];
    /** What this run actually produced. */
    observed: string[];
    diverged: boolean;
}

/** Something replay could not reconcile with the recording. */
export interface ReplayProblem {
    step: number;
    kind: 'divergence' | 'input' | 'exhausted';
    detail?: string;
    expected?: string[];
    observed?: string[];
    at?: number;
}

export interface ReplayResult {
    ok: boolean;
    traceId: string;
    /** What the recording claimed about itself. */
    recordedDeterminism: TraceDeterminism;
    /**
     * Whether this run reproduced a deterministic recording exactly. Re-derived
     * from the run, never copied from the trace — it is the only claim in the
     * system backed by evidence.
     */
    verified: boolean;
    steps: ReplayStep[];
    problems: ReplayProblem[];
    /** Observations that belonged to no recorded input. */
    orphans: string[];
    contractViolations: TraceContractViolation[];
}

export interface ReplayOptions<TContext = any> {
    /** Sets up and mounts the application. Its return value is passed to `at`. */
    mount(): TContext | Promise<TContext>;
    /** Runs after each input, for your own assertions. */
    at?(step: ReplayStep, context: TContext): void | Promise<void>;
    /** Where to resolve event targets. Defaults to the mounted subtree. */
    root?: Document | Element;
    /** A router to drive recorded navigations through. */
    router?: { navigate(hash: string): void };
    /**
     * Accept a trace the recorder marked best-effort. Without this, replaying
     * one throws rather than reporting a pass it cannot stand behind.
     */
    allowBestEffort?: boolean;
    /** Throw on divergence. Defaults to true. */
    strict?: boolean;
}

/**
 * Replays a recorded trace against a live application.
 *
 * @throws When the trace cannot be read (AVX_R25), when it is best-effort and
 * `allowBestEffort` was not set (AVX_R26), or when replay diverged in strict
 * mode (AVX_R27).
 */
export function replay<TContext = any>(trace: Trace, options: ReplayOptions<TContext>): Promise<ReplayResult>;

/** Renders a replay's problems as a developer-readable report. */
export function formatProblems(result: ReplayResult): string;

/** A declared contract the running code did not honour. */
export interface TraceContractViolation {
    /** The compiler's own diagnostic code, e.g. `AVX_W33`. */
    code: string;
    contract: 'pure' | 'deterministic';
    /** The unit that broke its promise, e.g. `CartItem.incQty()`. */
    unit: string;
    detail: string;
    nodeId: number;
}

/** Checks a trace's declared contracts against what it recorded. */
export function findContractViolations(trace: Trace): TraceContractViolation[];

/** Substitutes globals that log every non-deterministic value handed out. */
export function installRecordingGlobals(recorder: TraceRecorder): void;

/** Removes every substitution, restoring the real globals. */
export function clearGlobalOverrides(): void;

/** The trace format version this build writes. */
export const TRACE_VERSION: number;

export const Determinism: {
    readonly DETERMINISTIC: 'deterministic';
    readonly BEST_EFFORT: 'best-effort';
};

/** Validates that a value is a trace this build can read. */
export function validateTrace(trace: unknown): { ok: boolean; error?: string };
