// Type definitions for avenx-core/integration
// Project: Avenx-JS
// Definitions by: Avenx Team
//
// The compiler pieces a build-tool plugin such as @avenx/vite uses. These are
// compiler internals exposed for official integrations; application code should
// use the default `avenx-core` export (AvenxCompiler) or the CLI instead.

/** Parses `.component.js` / `.page.js` sources into runtime modules. */
export class ComponentParser {
    constructor(styleProcessor: StyleProcessor, voidTags?: string[], config?: Record<string, unknown>);
    [member: string]: any;
}

/** Scopes and processes component stylesheets. */
export class StyleProcessor {
    constructor(options?: Record<string, unknown>, config?: Record<string, unknown>);
    reset(): void;
    addVariable(name: string, value: string): void;
    [member: string]: any;
}

/** A located build failure carrying an `AVX_*` diagnostic code. */
export class BuildError extends Error {
    constructor(code: string, ...args: unknown[]);
    readonly code: string;
}

/** Diagnostic codes, keyed by symbolic name. */
export const AvenxErrorCodes: Readonly<Record<string, string>>;

/** A version 3 source map. */
export interface SourceMapV3 {
    version: 3;
    file?: string;
    sources: string[];
    sourcesContent?: (string | null)[];
    names: string[];
    mappings: string;
}

/** Encodes one value as a base64 VLQ segment. */
export function encodeVLQ(value: number): string;

/** Maps a compiled component module back to its source. */
export function generateTemplateSourceMap(
    filePath: string,
    originalCode: string,
    compiledCode: string,
    options?: Record<string, unknown>,
): SourceMapV3;

/** Composes per-module maps into one map for a concatenated bundle. */
export function composeBundleSourceMap(
    bundleFileName: string,
    totalBundleLines: number,
    sections?: unknown[],
    options?: Record<string, unknown>,
): SourceMapV3;

/**
 * The import declaration a compiled module needs for its base class and the
 * expression primitives the code generator emits calls to.
 */
export function runtimeImportStatement(base: string, specifier?: string, opsSpecifier?: string): string;
