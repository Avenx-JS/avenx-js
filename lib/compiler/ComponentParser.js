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
        template = this.processComponentTags(template);

        const methodStrings = Object.entries(methods)
            .map(([k, v]) => `${k}: \`${v}\``).join(',\n        ');

        if (isPage) {
            return `
class ${name} extends AvenxPage {
    constructor(bridges, componentRegistry, props) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} }, componentRegistry, props);
    }
}`;
        }

        return `
class ${name} extends AvenxComponent {
    constructor(bridges, props) {
        super(${JSON.stringify(state)}, ${JSON.stringify(computed)}, bridges, \`${template}\`, { ${methodStrings} }, props);
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
        let currentTemplate = template;

        while (true) {
            // Matches <@for item in list> or <@for item in list key="item.id">, or closing tag </@for> / </ @for>
            const tagRegex = /(<@for\s+(\w+)\s+in\s+([^>]+?)(?:\s+key="([^"]*)")?>)|(<\/ ?@for>)/gi;
            let match;
            const tags = [];
            while ((match = tagRegex.exec(currentTemplate)) !== null) {
                if (match[1]) {
                    tags.push({
                        type: 'start',
                        index: match.index,
                        length: match[0].length,
                        item: match[2],
                        list: match[3],
                        key: match[4]
                    });
                } else {
                    tags.push({
                        type: 'end',
                        index: match.index,
                        length: match[0].length
                    });
                }
            }

            if (tags.length === 0) {
                break;
            }

            let innerPair = null;
            const stack = [];
            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                if (tag.type === 'start') {
                    stack.push(tag);
                } else {
                    const startTag = stack.pop();
                    if (startTag) {
                        innerPair = { start: startTag, end: tag };
                        break; // Found innermost loop!
                    }
                }
            }

            if (!innerPair) {
                console.warn("[ComponentParser] Unmatched <@for> tags in template.");
                break;
            }

            const startIdx = innerPair.start.index;
            const endIdx = innerPair.end.index + innerPair.end.length;

            const bodyStart = startIdx + innerPair.start.length;
            const bodyEnd = innerPair.end.index;
            const body = currentTemplate.substring(bodyStart, bodyEnd);

            // Escape inner interpolation tags to prevent them from being processed
            // by the initial template render. They will be processed per-item at runtime.
            const escapedBody = body.replace(/\{\{/g, '{%').replace(/\}\}/g, '%}');
            let attrs = `data-ax-for="${innerPair.start.list.trim()}" data-ax-as="${innerPair.start.item.trim()}"`;
            if (innerPair.start.key) {
                attrs += ` data-ax-key="${innerPair.start.key.trim()}"`;
            }

            const replacement = `<template ${attrs}>${escapedBody}</template>`;
            currentTemplate = currentTemplate.substring(0, startIdx) + replacement + currentTemplate.substring(endIdx);
        }

        return currentTemplate;
    }

    /**
     * Processes component tags recursively to handle transclusion slots.
     * Maps `<CompName ...>...</CompName>` to `<div data-avenx-comp="CompName">...</div>`.
     * @param {string} template - The template string.
     * @returns {string} The processed template.
     */
    processComponentTags(template) {
        let currentTemplate = template;
        
        while (true) {
            // Find the first occurrence of < followed by an uppercase letter
            const match = currentTemplate.match(/<([A-Z][a-zA-Z0-9]*)\b/);
            if (!match) {
                break;
            }
            
            const compName = match[1];
            const startIndex = match.index;
            
            // Find the end of this opening/self-closing tag
            let i = startIndex + 1 + compName.length;
            let inQuote = null;
            let isSelfClosing = false;
            let tagEndIndex = -1;
            
            while (i < currentTemplate.length) {
                const char = currentTemplate[i];
                if (inQuote) {
                    if (char === inQuote) {
                        inQuote = null;
                    }
                } else if (char === '"' || char === "'") {
                    inQuote = char;
                } else if (char === '>') {
                    const trimmedBefore = currentTemplate.substring(startIndex + 1 + compName.length, i).trim();
                    if (trimmedBefore.endsWith('/')) {
                        isSelfClosing = true;
                    }
                    tagEndIndex = i + 1;
                    break;
                }
                i++;
            }
            
            if (tagEndIndex === -1) {
                break; // Malformed tag, stop parsing to prevent infinite loops
            }
            
            // Extract the attributes string
            let attrsStr = currentTemplate.substring(startIndex + 1 + compName.length, tagEndIndex - 1).trim();
            if (isSelfClosing && attrsStr.endsWith('/')) {
                attrsStr = attrsStr.slice(0, -1).trim();
            }
            
            // Parse attributes
            const props = [];
            const attrRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
                const attrName = attrMatch[1];
                const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
                
                let propExpr;
                if (attrVal.startsWith('{{') && attrVal.endsWith('}}')) {
                    propExpr = attrVal.slice(2, -2).trim();
                } else {
                    const trimmed = attrVal.trim();
                    if (trimmed === 'true' || trimmed === 'false' || trimmed === 'null' || (trimmed !== '' && !isNaN(trimmed))) {
                        propExpr = trimmed;
                    } else {
                        propExpr = `'${trimmed.replace(/'/g, "\\'")}'`;
                    }
                }
                props.push(`data-props-${attrName}="${propExpr}"`);
            }
            const propsAttr = props.length > 0 ? ` ${props.join(' ')}` : '';
            
            if (isSelfClosing) {
                const replacement = `<div data-avenx-comp="${compName}"${propsAttr}></div>`;
                currentTemplate = currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
            } else {
                // Find matching closing tag </CompName>
                let searchIndex = tagEndIndex;
                let depth = 1;
                let closingTagIndex = -1;
                let closingTagLength = 0;
                
                while (searchIndex < currentTemplate.length) {
                    const nextOpen = currentTemplate.substring(searchIndex).match(new RegExp(`^<${compName}\\b`));
                    const nextClose = currentTemplate.substring(searchIndex).match(new RegExp(`^</\\s*${compName}\\s*>`));
                    
                    if (nextClose) {
                        depth--;
                        if (depth === 0) {
                            closingTagIndex = searchIndex;
                            closingTagLength = nextClose[0].length;
                            break;
                        }
                        searchIndex += nextClose[0].length;
                    } else if (nextOpen) {
                        // Scan to end of this open tag to see if it is self-closing
                        let tempIdx = searchIndex + nextOpen[0].length;
                        let tempInQuote = null;
                        let tempIsSelfClosing = false;
                        while (tempIdx < currentTemplate.length) {
                            const tc = currentTemplate[tempIdx];
                            if (tempInQuote) {
                                if (tc === tempInQuote) tempInQuote = null;
                            } else if (tc === '"' || tc === "'") {
                                tempInQuote = tc;
                            } else if (tc === '>') {
                                const trimmedBefore = currentTemplate.substring(searchIndex + nextOpen[0].length, tempIdx).trim();
                                if (trimmedBefore.endsWith('/')) {
                                    tempIsSelfClosing = true;
                                }
                                tempIdx++;
                                break;
                            }
                            tempIdx++;
                        }
                        if (!tempIsSelfClosing) {
                            depth++;
                        }
                        searchIndex = tempIdx;
                    } else {
                        searchIndex++;
                    }
                }
                
                if (closingTagIndex === -1) {
                    // No matching closing tag, treat as self-closing
                    const replacement = `<div data-avenx-comp="${compName}"${propsAttr}></div>`;
                    currentTemplate = currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(tagEndIndex);
                } else {
                    const innerContent = currentTemplate.substring(tagEndIndex, closingTagIndex);
                    // Recursively process tags inside innerContent
                    const processedInner = this.processComponentTags(innerContent);
                    const replacement = `<div data-avenx-comp="${compName}"${propsAttr}>${processedInner}</div>`;
                    currentTemplate = currentTemplate.substring(0, startIndex) + replacement + currentTemplate.substring(closingTagIndex + closingTagLength);
                }
            }
        }
        return currentTemplate;
    }
}

module.exports = ComponentParser;
