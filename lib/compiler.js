const fs = require('fs');
const path = require('path');
const StyleProcessor = require('./core/StyleProcessor');
const ComponentParser = require('./core/ComponentParser');

/**
 * AvenxCompiler is the main orchestrator for the Avenx-JS build process.
 * It coordinates the parsing of components, processing of styles, and the
 * final bundling of the application.
 */
class AvenxCompiler {
    /**
     * Creates an instance of AvenxCompiler and initializes its sub-processors.
     * Uses the current working directory as the project root.
     */
    constructor() {
        /** @type {string} */
        this.rootDir = process.cwd();
        /** @type {string} */
        this.srcDir = path.join(this.rootDir, 'src');
        /** @type {string} */
        this.distDir = path.join(this.rootDir, 'dist');
        /** @type {string} */
        this.runtimeDir = path.join(__dirname, 'runtime');
        
        /** @type {StyleProcessor} */
        this.styleProcessor = new StyleProcessor();
        /** @type {ComponentParser} */
        this.componentParser = new ComponentParser(this.styleProcessor);
        
        this.init();
    }

    /**
     * Initializes the compiler environment, ensuring required directories exist.
     * @private
     */
    init() {
        if (!fs.existsSync(this.distDir)) {
            try {
                fs.mkdirSync(this.distDir, { recursive: true });
            } catch (e) {
                console.error(`❌ Error: Could not create dist directory at ${this.distDir}`);
            }
        }
    }

    /**
     * Executes the full build process.
     */
    build() {
        console.log("--- Avenx-JS Compiler ---");
        
        if (!fs.existsSync(this.srcDir)) {
            console.error(`❌ Error: 'src' directory not found at ${this.srcDir}. Run 'avenx init' to scaffold a project.`);
            return;
        }

        // Reset style processor to avoid accumulating styles across multiple builds (watch mode)
        this.styleProcessor.reset();

        let bundleJs = this.getRuntime();
        const bridgeData = this.processBridges();
        bundleJs += this.processComponents();
        bundleJs += this.processMain(bridgeData.registrations);

        fs.writeFileSync(path.join(this.distDir, 'bundle.js'), bundleJs);
        fs.writeFileSync(path.join(this.distDir, 'bundle.css'), this.styleProcessor.getGlobalStyles());
        
        console.log("-----------------------");
        console.log(`Build erfolgreich: dist/bundle.js & dist/bundle.css`);
    }

    /**
     * Reads the core runtime files and prepares them for the bundle.
     * @returns {string}
     * @private
     */
    getRuntime() {
        const bridge = fs.readFileSync(path.join(this.runtimeDir, 'AvenxBridge.js'), 'utf-8').replace(/export /g, '');
        const comp = fs.readFileSync(path.join(this.runtimeDir, 'AvenxComponent.js'), 'utf-8').replace(/export /g, '');
        const app = fs.readFileSync(path.join(this.runtimeDir, 'AvenxApp.js'), 'utf-8').replace(/export /g, '');
        return bridge + "\n" + comp + "\n" + app;
    }

    /**
     * Processes bridge registrations from the global directory.
     * @returns {Object}
     * @private
     */
    processBridges() {
        const globalDir = path.join(this.srcDir, 'global');
        let registrations = "";
        if (fs.existsSync(globalDir)) {
            fs.readdirSync(globalDir).forEach(file => {
                if (file.endsWith('.bridge.js')) {
                    const name = path.basename(file, '.bridge.js');
                    const capitalizedName = name.split(/[-_]/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join("") + "Bridge";
                    
                    console.log(`[Bridge] ${capitalizedName}`);
                    const content = fs.readFileSync(path.join(globalDir, file), 'utf-8');
                    const match = content.match(/export\s+default\s+([\s\S]*)/);
                    if (match) {
                        const objStr = match[1].trim().replace(/;$/, '');
                        registrations += `app.registerBridge('${capitalizedName}', ${objStr});\n`;
                    }
                }
            });
        }
        return { registrations };
    }

    /**
     * Processes all components in the src/components folder.
     * @returns {string}
     * @private
     */
    processComponents() {
        let componentsJs = "";
        const compDir = path.join(this.srcDir, 'components');
        
        const scan = (dir) => {
            if (!fs.existsSync(dir)) return;
            fs.readdirSync(dir).forEach(file => {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    scan(fullPath);
                } else if (file.endsWith('.component.js')) {
                    console.log(`[Compiling] ${file}`);
                    componentsJs += this.componentParser.parse(fullPath);
                }
            });
        };

        scan(compDir);
        return componentsJs;
    }

    /**
     * Processes the main application entry point.
     * @param {string} bridgeRegistrations
     * @returns {string}
     * @private
     */
    processMain(bridgeRegistrations) {
        const mainFile = path.join(this.srcDir, 'main.app.js');
        if (fs.existsSync(mainFile)) {
            let main = fs.readFileSync(mainFile, 'utf-8')
                .replace(/import\s*{\s*AvenxApp\s*}\s*from\s*['"].*?['"];?/g, '') 
                .replace(/import\s+.*?\s+from\s+['"].*?['"];?/gm, ''); 
            
            if (bridgeRegistrations) {
                main = main.replace(/(const\s+app\s+=\s+new\s+AvenxApp\([\s\S]*?\);)/, `$1\n${bridgeRegistrations}`);
            }
            return `\n(function(){\n${main}\n})();`;
        }
        return "";
    }
}

module.exports = AvenxCompiler;
