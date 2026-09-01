// Type definitions for Avenx-JS build-time tooling
// Import from 'avenx-core/tooling'. Node only: these helpers read from disk.

export interface InvalidComponentTagIssue {
    tagName: string;
    expectedName: string;
    index: number;
}

export function componentNameFromFile(fileName: string): string;
export function findRegisteredComponents(projectRoot: string, componentsDir?: string): Set<string>;
export function extractLintableTemplate(source: string): string;
export function findInvalidComponentTags(source: string, registeredComponents: Set<string>): InvalidComponentTagIssue[];
export function findProjectRoot(filePath: string, fallbackRoot: string): string;

/** ESLint rule that flags component tags whose casing does not match the file. */
export const componentTagNamingRule: {
    meta: Record<string, any>;
    create(context: any): Record<string, any>;
};

/** ESLint parser that exposes the JavaScript regions of a component template. */
export const avenxTemplateParser: {
    parseForESLint(code: string, options?: any): any;
};

/**
 * Compiles a single `.component.js` or `.page.js` into a usable class.
 *
 * Avenx component files are not JavaScript modules, so a test cannot import
 * one. This runs the same ComponentParser the build uses, which is what lets a
 * generated regression test mount the component the application ships.
 */
export function loadComponent(
    filePath: string,
    options?: { type?: 'component' | 'page'; config?: Record<string, any> }
): new (bridges?: any, props?: any) => any;

/** The class name the compiler emits for a component file. */
export function classNameFor(filePath: string): string;
