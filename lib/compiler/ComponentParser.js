const fs = require('fs');
const path = require('path');
const ExpressionParser = require('./expressionParser');

/**
 * ComponentParser handles the parsing of Avenx component files (.js and .css).
 * It extracts component state, computed properties, methods, and templates,
 * and coordinates with the StyleProcessor to handle styles.
 */
class ComponentParser {
    /**
     * @param {StyleProcessor} styleProcessor - An instance of StyleProcessor to handle styles.
     */
    constructor(styleProcessor) {
        /** @type {StyleProcessor} */
        this.styleProcessor = styleProcessor;
        /** @type {ExpressionParser} */
        this.expressionParser = new ExpressionParser();
    }

    /**
     * Parses a .component.js or .page.js file and its corresponding CSS file.
     * @param {string} filePath - The absolute path to the file.
     * @param {'component'|'page'} [type='component'] - The type of file being parsed.
     * @returns {string} The generated JavaScript class.
     */
    parse(filePath, type = 'component') {
        const isPage = type === 'page';
        const suffix = isPage ? '.page.js' : '.component.js';
        const content = fs.readFileSync(filePath, 'utf-8');
        const fileName = path.basename(filePath, suffix);
        
        // Convert user-profile or user_profile to UserProfile
        const name = fileName
            .split(/[-_]/)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join('');

        const desPath = filePath.replace(suffix, isPage ? '.page.css' : '.component.css');
        let desBlocks = {};

        if (fs.existsSync(desPath)) {
            this.extractStylesAndVars(fs.readFileSync(desPath, 'utf-8'), desBlocks);
        }

        const state = this.extractState(content);
        const computed = this.extractComputed(content);
        const methods = this.extractMethods(content);
        let template = this.extractTemplate(content, desBlocks, name);

        // Handle declarative tags: <MyComponent /> -> <div data-avenx-comp="MyComponent"></div>
        // Only if it looks like a component (starts with uppercase)
        template = template.replace(/<([A-Z][a-zA-Z0-9]*)\s*\/>/g, '<div data-avenx-comp="$1"></div>');

        const methodStrings = Object.entries(methods)
            .map(([k, v]) => `${k}: \`${v}\``).join(',\n        ');

        if (isPage) {
            return `
class ${name} extends AvenxPage {
    constructor(bridges, componentRegistry) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} }, componentRegistry);
    }
}`;
        }

        return `
class ${name} extends AvenxComponent {
    constructor(bridges) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} });
    }
}`;
    }

    /**
     * Extracts global CSS variables and component-specific style blocks from CSS content.
     * @param {string} desContent - The content of the .component.css file.
     * @param {Object} desBlocks - An object to store the extracted style blocks.
     * @private
     */
    extractStylesAndVars(desContent, desBlocks) {
        const globalMatch = desContent.match(/<@global>([\s\S]*?)<\/ ?@global>/i);
        if (globalMatch) {
            let inner = globalMatch[1];
            const defRegex = /@def\s+([\w-]+)\s+([^;]+);/g;
            let defMatch;
            while ((defMatch = defRegex.exec(inner)) !== null) {
                this.styleProcessor.addVariable(defMatch[1], defMatch[2].trim());
            }
            
            // Remove @def lines and add the rest as global CSS
            const rawCss = inner.replace(/@def\s+[\w-]+\s+[^;]+;/g, '').trim();
            if (rawCss) {
                this.styleProcessor.addGlobalCSS(rawCss);
            }
        }

        const cssBlockMatch = desContent.match(/<@css>([\s\S]*?)<\/ ?@css>/i);
        if (cssBlockMatch) {
            const inner = cssBlockMatch[1];
            let depth = 0, currentName = "", currentBody = "", inBlock = false;
            for (let i = 0; i < inner.length; i++) {
                const char = inner[i];
                if (char === '{' && depth === 0) {
                    currentName = inner.substring(0, i).trim().split('}').pop().trim();
                    inBlock = true; depth++;
                } else if (char === '{') {
                    depth++; currentBody += char;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        if (currentName) desBlocks[currentName] = currentBody.trim();
                        currentBody = ""; currentName = ""; inBlock = false;
                    } else { currentBody += char; }
                } else if (inBlock) { currentBody += char; }
            }
        }
    }

    /**
     * Extracts the initial state from the component's <state /> tags.
     * @param {string} content - The content of the .component.js file.
     * @returns {Object} The extracted state object.
     * @private
     */
    extractState(content) {
        return this.expressionParser.parseState(content);
    }

    /**
     * Extracts computed properties from the component's <computed /> tags.
     * @param {string} content - The content of the .component.js file.
     * @returns {Object} A map of property names to their expression strings.
     * @private
     */
    extractComputed(content) {
        return this.expressionParser.parseComputed(content);
    }

    /**
     * Extracts actions (methods) from the component's <action /> tags.
     * @param {string} content - The content of the .component.js file.
     * @returns {Object<string, string>} A map of method names to their stringified bodies.
     * @private
     */
    extractMethods(content) {
        return this.expressionParser.parseMethods(content);
    }

    /**
     * Extracts the HTML template and processes internal styles.
     * @param {string} content - The content of the .component.js file.
     * @param {Object} desBlocks - The previously extracted design blocks.
     * @param {string} name - The name of the component for style hashing.
     * @returns {string} The cleaned and processed HTML template.
     * @private
     */
    extractTemplate(content, desBlocks, name) {
        let template = content
            .replace(/<state.*? \/>/g, '')
            .replace(/<computed.*? \/>/g, '')
            .replace(/<action.*?>[\s\S]*?<\/action>/g, '')
            .trim();
        template = this.styleProcessor.process(template, desBlocks, name);
        template = this.processForLoops(template);
        return template.split('\n').filter(line => line.trim() !== '').join('\n');
    }

    /**
     * Processes <@for> loops in the template, converting them to <template> tags
     * that can be handled by the runtime for efficient list rendering.
     * @param {string} template - The HTML template string.
     * @returns {string} The processed template.
     * @private
     */
    processForLoops(template) {
        // Matches <@for item in list> or <@for item in list key="item.id">
        // Support both </@for> and </ @for> for flexibility
        const forRegex = /<@for\s+(\w+)\s+in\s+([^>]+?)(?:\s+key="([^"]*)")?>([\s\S]*?)<\/ ?@for>/g;
        return template.replace(forRegex, (match, item, list, key, body) => {
            // Escape inner interpolation tags to prevent them from being processed
            // by the initial template render. They will be processed per-item at runtime.
            const escapedBody = body.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
            let attrs = `data-ax-for="${list.trim()}" data-ax-as="${item.trim()}"`;
            if (key) {
                attrs += ` data-ax-key="${key.trim()}"`;
            }
            return `<template ${attrs}>${escapedBody}</template>`;
        });
    }
}

module.exports = ComponentParser;
