const fs = require('fs');
const { performance } = require('perf_hooks');
const StyleProcessor = require('../lib/compiler/StyleProcessor');
const ComponentParser = require('../lib/compiler/ComponentParser');

// Mock data
const componentJs = `<state count="0" />

<action name="reset">
    count = 0;
</action>

<div>
    <@css container />
    <h1 @css title>Avenx Framework</h1>
    
    <div @css counter-box>
        <span @css text>Reactive Counter</span>
        <span @css count>{{ count }}</span>
    </div>

    <div @css button-group>
        <button @css btn-primary @click="count++">Increment</button>
        <button @css btn-secondary @click="reset()">Reset</button>
    </div>
</div>`;

const componentCss = `<@global>
    @def primary #4f46e5;
    @def primary-hover #4338ca;
    @def secondary #64748b;
    @def secondary-hover #475569;
    @def dark #0f172a;
    @def white #ffffff;
    @def gray-100 #f1f5f9;
</ @global>

<@css>
    container {
        padding: 2.5rem;
        background: @white;
        border-radius: 1.5rem;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
        text-align: center;
        border: 1px solid rgba(0,0,0,0.05);
    }

    title {
        color: @dark;
        font-size: 1.875rem;
        font-weight: 800;
        margin-bottom: 0.5rem;
        letter-spacing: -0.025em;
    }

    counter-box {
        background: @gray-100;
        padding: 1rem;
        border-radius: 0.75rem;
        margin: 1.5rem 0;
    }

    text {
        font-size: 1.125rem;
        color: @secondary;
        font-weight: 500;
    }

    count {
        font-size: 2.25rem;
        font-weight: 800;
        color: @primary;
        display: block;
        margin-top: 0.25rem;
    }

    button-group {
        display: flex;
        gap: 0.75rem;
        justify-content: center;
    }

    btn-primary {
        background: @primary;
        color: white;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);

        &:hover {
            background: @primary-hover;
            transform: translateY(-1px);
            box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
        }

        &:active {
            transform: translateY(0);
        }
    }

    btn-secondary {
        background: @secondary;
        color: white;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 0.75rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;

        &:hover {
            background: @secondary-hover;
        }
    }
</ @css>`;

// Mock fs.readFileSync and fs.existsSync
const originalReadFileSync = fs.readFileSync;
const originalExistsSync = fs.existsSync;

fs.readFileSync = (filePath, options) => {
  if (filePath.endsWith('.component.js')) return componentJs;
  if (filePath.endsWith('.component.css')) return componentCss;
  return originalReadFileSync(filePath, options);
};

fs.existsSync = (filePath) => {
  if (filePath.endsWith('.component.js') || filePath.endsWith('.component.css')) return true;
  return originalExistsSync(filePath);
};

/**
 *
 */
function benchmark() {
  const iterations = 1000;
  const styleProcessor = new StyleProcessor();
  const parser = new ComponentParser(styleProcessor);
  const testFile = 'test.component.js';

  console.log(`Running ComponentParser benchmark with ${iterations} iterations...`);

  // Warmup
  for (let i = 0; i < 100; i++) {
    styleProcessor.reset();
    parser.parse(testFile);
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    styleProcessor.reset();
    parser.parse(testFile);
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per parse: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
}

benchmark();

// Restore original fs methods
fs.readFileSync = originalReadFileSync;
fs.existsSync = originalExistsSync;
