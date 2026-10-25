// Type definitions for Avenx-JS compiler
// Project: Avenx-JS
// Definitions by: Avenx Team

/**
 * The Content-Security-Policy posture a build commits to.
 *
 * Read from `csp` in avenx.config.json, and settable per invocation with
 * `avenx build --csp-strict`.
 */
interface AvenxCspConfig {
    /**
     * Refuses to emit anything that would need `script-src 'unsafe-eval'`.
     *
     * Off by default, and the default build path is unchanged by it. When on,
     * a development build leaves the expression interpreter out, an expression
     * the code generator could not compile fails the build (AVX_C31) in either
     * mode rather than being interpreted at run time, and the emitted
     * JavaScript is parsed and refused if it still contains `eval`, the
     * `Function` constructor or a `with` statement (AVX_C32).
     *
     * A production build links no interpreter either way, so there the option
     * adds only the check on the emitted file.
     */
    strict?: boolean;
}

/**
 * Compiler options, as accepted by the constructor.
 *
 * Only the options this declaration file describes are listed; the compiler
 * merges whatever it is given over the resolved avenx.config.json.
 */
interface AvenxCompilerOptions {
    /** Project root. Defaults to the nearest directory holding a package.json. */
    rootDir?: string;
    /** Source directory, relative to the root. */
    srcDir?: string;
    /** Output directory, relative to the root. */
    distDir?: string;
    /** Build mode. Production is the default for `avenx build`. */
    mode?: 'production' | 'development';
    /** Content-Security-Policy posture. */
    csp?: AvenxCspConfig;
    [option: string]: unknown;
}

/**
 * What a completed build wrote.
 */
interface AvenxBuildResult {
    mode: 'production' | 'development';
    distDir: string;
    files: string[];
    durationMs: number;
}

/**
 * AvenxCompiler is the main orchestrator for the Avenx-JS build process.
 * It coordinates the parsing of components, processing of styles, and the
 * final bundling of the application.
 */
declare class AvenxCompiler {
    /**
     * The root directory of the project.
     */
    rootDir: string;

    /**
     * The source directory (usually 'src').
     */
    srcDir: string;

    /**
     * The distribution directory (usually 'dist').
     */
    distDir: string;

    /**
     * The directory containing core runtime files.
     */
    coreDir: string;

    /**
     * True when this build must not emit anything needing `'unsafe-eval'`.
     *
     * Orthogonal to the mode: see {@link AvenxCspConfig.strict}.
     */
    cspStrict: boolean;

    constructor(options?: AvenxCompilerOptions);

    /**
     * Executes the full build process, bundling all core runtime files,
     * components, pages, bridges, and styles into dist/bundle.js and dist/bundle.css.
     *
     * Throws a BuildError when the application cannot be compiled; nothing is
     * written in that case, so the previous output directory is left intact.
     */
    build(): AvenxBuildResult;
    /**
    * Compiles a single component file.
    */
    compileComponent(filePath: string): string;

    /**
     * Compiles a single page file.
     */
compilePage(filePath: string): string;
}

// `export =` cannot sit beside named exports, so the interfaces above are
// published through a namespace merged with the class -- which is also how a
// consumer reaches them: `AvenxCompiler.AvenxCspConfig`.
declare namespace AvenxCompiler {
    export { AvenxCspConfig, AvenxCompilerOptions, AvenxBuildResult };
}

export = AvenxCompiler;
