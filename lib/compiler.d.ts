// Type definitions for Avenx-JS compiler
// Project: Avenx-JS
// Definitions by: Avenx Team

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

    constructor();

    /**
     * Executes the full build process, bundling all core runtime files,
     * components, pages, bridges, and styles into dist/bundle.js and dist/bundle.css.
     */
    build(): void;
    /**
    * Compiles a single component file.
    */
    compileComponent(filePath: string): string;

    /**
     * Compiles a single page file.
     */
compilePage(filePath: string): string;
}

export = AvenxCompiler;
