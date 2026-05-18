// Avenx.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC_DIR = path.join(__dirname, 'src');
const DIST_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR);

let globalStyles = "";
let cssVariables = {};

/**
 * Processes the CSS within a component template, handling @css tags and scoping.
 * @param {string} html - The HTML template string.
 * @param {Object} [desBlocks={}] - A map of CSS blocks defined in the .axd file.
 * @param {string} [componentName=""] - The name of the component for hash generation.
 * @returns {string} The modified HTML with scoped class names and without @css tags.
 */
function processCSS(html, desBlocks = {}, componentName = "") {
    // Sucht nach <@css blockName>...</@css> ODER <@css blockName />
    const cssRegex = /<@css\s*(\w+)?\s*>([\s\S]*?)<\/ @css>|<@css\s*(\w+)?\s*\/?>/g;
    let match;
    let modifiedHtml = html;

    const matches = [];
    while ((match = cssRegex.exec(html)) !== null) {
        matches.push(match);
    }

    // Wir verarbeiten die Blöcke von hinten nach vorne
    let anonymousIndex = 0;
    for (let i = matches.length - 1; i >= 0; i--) {
        const m = matches[i];
        const blockName = m[1] || m[3];
        let cssContent = (m[2] || "").trim();
        const fullMatch = m[0];
        const matchIndex = m.index;

        // Falls kein Inline-CSS da ist, nimm den Block aus der .axd
        if (!cssContent) {
            if (blockName) {
                cssContent = desBlocks[blockName] || "";
            } else {
                // Rückfall auf positionale Zuordnung für anonyme Blöcke
                cssContent = desBlocks[`__anon_${anonymousIndex++}`] || "";
            }
        }

        if (!cssContent) {
            modifiedHtml = modifiedHtml.replace(fullMatch, '');
            continue;
        }

        // Variablen ersetzen
        for (const [varName, varValue] of Object.entries(cssVariables)) {
            const varRegex = new RegExp(`@${varName}\\b`, 'g');
            cssContent = cssContent.replace(varRegex, varValue);
        }

        const hash = "avenx-" + crypto.createHash('md5').update(cssContent + componentName).digest('hex').substring(0, 8);
        
        let baseRules = "";
        let nestedRules = "";
        
        // Robusterer Parser für CSS-Regeln und Blöcke
        let current = "";
        let depth = 0;
        for (let char of cssContent) {
            current += char;
            if (char === '{') depth++;
            else if (char === '}') depth--;
            
            if (depth === 0 && (char === ';' || char === '}')) {
                let rule = current.trim();
                if (rule.includes('{')) {
                    nestedRules += rule.replace(/&/g, `.${hash}`) + "\n";
                } else if (rule && rule !== ';') {
                    if (!rule.endsWith(';')) rule += ';';
                    baseRules += rule + " ";
                }
                current = "";
            }
        }
        if (current.trim()) {
            let rule = current.trim();
            if (rule.includes('{')) {
                nestedRules += rule.replace(/&/g, `.${hash}`) + "\n";
            } else if (rule && rule !== ';') {
                if (!rule.endsWith(';')) rule += ';';
                baseRules += rule + " ";
            }
        }

        if (baseRules.trim()) globalStyles += `.${hash} { ${baseRules} }\n`;
        if (nestedRules.trim()) globalStyles += nestedRules + "\n";

        const beforeMatch = modifiedHtml.substring(0, matchIndex);
        const lastTagStart = beforeMatch.lastIndexOf('<');
        
        if (lastTagStart !== -1 && beforeMatch[lastTagStart + 1] !== '/') {
            const tagContent = modifiedHtml.substring(lastTagStart, matchIndex);
            let updatedTag;
            if (tagContent.includes('class="')) {
                updatedTag = tagContent.replace('class="', `class="${hash} `);
            } else {
                updatedTag = tagContent.replace(/(\s*\/?>)/, ` class="${hash}"$1`);
            }
            
            modifiedHtml = modifiedHtml.substring(0, lastTagStart) + 
                           updatedTag + 
                           modifiedHtml.substring(matchIndex + fullMatch.length);
        } else {
            modifiedHtml = modifiedHtml.replace(fullMatch, '');
        }
    }
    return modifiedHtml;
}

/**
 * Parses an Avenx Template (.axt) file and its corresponding .axd style file.
 * @param {string} filePath - The path to the .axt file.
 * @returns {Object} An object containing the component name and the generated JavaScript code.
 */
function parseAXT(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const name = path.basename(filePath, '.axt');
    const desPath = filePath.replace('.axt', '.axd');
    let desBlocks = {};
    let anonymousCount = 0;

    if (fs.existsSync(desPath)) {
        const desContent = fs.readFileSync(desPath, 'utf-8');
        
        // 1. Variablen aus <@global> extrahieren
        const globalMatch = desContent.match(/<@global>([\s\S]*?)<\/ @global>/i);
        if (globalMatch) {
            const globalInner = globalMatch[1];
            const defRegex = /@def\s+(\w+)\s+([^;]+);/g;
            let defMatch;
            while ((defMatch = defRegex.exec(globalInner)) !== null) {
                cssVariables[defMatch[1]] = defMatch[2].trim();
            }
        }

        // 2. Blöcke aus <@css> extrahieren
        const cssBlockMatch = desContent.match(/<@css>([\s\S]*?)<\/ @css>/i);
        
        if (cssBlockMatch) {
            const inner = cssBlockMatch[1];
            let depth = 0;
            let currentName = "";
            let currentBody = "";
            let inBlock = false;
            
            for (let i = 0; i < inner.length; i++) {
                const char = inner[i];
                if (char === '{' && depth === 0) {
                    let before = inner.substring(0, i).trim();
                    let lastBrace = before.lastIndexOf('}');
                    currentName = before.substring(lastBrace + 1).trim();
                    inBlock = true;
                    depth++;
                } else if (char === '{') {
                    depth++;
                    currentBody += char;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        if (currentName) desBlocks[currentName] = currentBody.trim();
                        currentBody = "";
                        currentName = "";
                        inBlock = false;
                    } else {
                        currentBody += char;
                    }
                } else if (inBlock) {
                    currentBody += char;
                }
            }
        }
    }

    const state = {};
    const stateMatch = content.match(/<state\s+(.*?)\s*\/>/);
    if (stateMatch) {
        stateMatch[1].match(/(\w+)="([^"]*)"/g)?.forEach(pair => {
            const [k, v] = pair.split('=');
            const val = v.replace(/"/g, '');
            state[k] = isNaN(val) ? val : Number(val);
        });
    }

    const methods = {};
    const actionRegex = /<action\s+name="(\w+)">([\s\S]*?)<\/action>/g;
    let m;
    while ((m = actionRegex.exec(content)) !== null) {
        methods[m[1]] = m[2].trim().replace(/\s+/g, ' ');
    }

    let template = content
        .replace(/<state.*? \/>/g, '')
        .replace(/<action.*?>[\s\S]*?<\/action>/g, '')
        .trim();
    
    template = processCSS(template, desBlocks, name);

    // Bereinigung: Entferne nur echte Leerzeilen (die nur Whitespace enthalten)
    template = template.split('\n')
        .filter(line => line.trim() !== '')
        .join('\n');

    const methodStrings = Object.entries(methods)
        .map(([k, v]) => `${k}: function() { ${v} }`).join(',\n        ');

    const js = `
class ${name} extends AvenxComponent {
    constructor(bridges) {
        super(${JSON.stringify(state)}, bridges, \`${template}\`, { ${methodStrings} });
    }
}`;
    return { name, js };
}

/**
 * Builds the application by compiling components, bridges, and the main entry point into a single bundle.
 * Extracts styles and variables into a separate CSS bundle.
 */
function build() {
    globalStyles = "/* Generated by Avenx-JS (Zero-Classname / @css Tag) */\n";
    console.log("--- Avenx-JS Compiler ---");
    
    let bundleJs = fs.readFileSync(path.join(SRC_DIR, 'runtime.js'), 'utf-8').replace(/export /g, '');

    const bridgeDir = path.join(SRC_DIR, 'bridges');
    let bridgeRegistrations = "";
    if (fs.existsSync(bridgeDir)) {
        fs.readdirSync(bridgeDir).forEach(file => {
            if (file.endsWith('.js')) {
                const bridgeName = path.basename(file, '.js');
                console.log(`[Bridge] ${bridgeName}`);
                let content = fs.readFileSync(path.join(bridgeDir, file), 'utf-8');
                // Versuche den Export zu finden und in ein Objekt umzuwandeln
                // Einfache Heuristik: export default { ... }
                const match = content.match(/export\s+default\s+([\s\S]*)/);
                if (match) {
                    const objStr = match[1].trim().replace(/;$/, '');
                    bridgeRegistrations += `app.registerBridge('${bridgeName}', ${objStr});\n`;
                }
            }
        });
    }

    const compDir = path.join(SRC_DIR, 'components');
    if (fs.existsSync(compDir)) {
        fs.readdirSync(compDir).forEach(file => {
            if (file.endsWith('.axt')) {
                console.log(`[Compiling] ${file}`);
                const { js } = parseAXT(path.join(compDir, file));
                bundleJs += js;
            }
        });
    }

    const mainFile = path.join(SRC_DIR, 'main.avx');
    if (fs.existsSync(mainFile)) {
        let main = fs.readFileSync(mainFile, 'utf-8').replace(/import.*?;/g, ''); 
        // Wir fügen die Bridge-Registrierungen in das main-Script ein,
        // nachdem die App-Instanz erstellt wurde.
        // Das setzt voraus, dass die Variable 'app' heißt.
        if (bridgeRegistrations) {
            main = main.replace(/(const\s+app\s+=\s+new\s+AvenxApp\(.*?\);)/, `$1\n${bridgeRegistrations}`);
        }
        bundleJs += `\n(function(){\n${main}\n})();`;
    }

    fs.writeFileSync(path.join(DIST_DIR, 'bundle.js'), bundleJs);
    fs.writeFileSync(path.join(DIST_DIR, 'bundle.css'), globalStyles);
    console.log("-----------------------");
    console.log('Build erfolgreich: dist/bundle.js & dist/bundle.css');
}

build();
