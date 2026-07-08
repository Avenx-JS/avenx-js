const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');
const { minify } = require('terser');

// Helper to parse simple command line arguments
function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = process.argv[i + 1];
      if (value && !value.startsWith('--')) {
        args[key] = value;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// Simple CSS minifier
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s+/g, ' ') // collapse whitespace
    .replace(/\s*([{}:;])\s*/g, '$1') // remove whitespace around punctuation
    .trim();
}

// Calculate sizes
function getMetrics(rawContent, minifiedContent) {
  const raw = Buffer.byteLength(rawContent, 'utf8');
  const minified = Buffer.byteLength(minifiedContent, 'utf8');
  const gzipped = zlib.gzipSync(Buffer.from(minifiedContent, 'utf8')).length;
  return { raw, minified, gzipped };
}

// Format sizes for display
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = 2;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDiff(diffBytes) {
  if (diffBytes === 0) return '0 B';
  const sign = diffBytes > 0 ? '+' : '';
  return `${sign}${formatBytes(diffBytes)}`;
}

function getPercentChange(baseVal, prVal) {
  if (baseVal === 0) return prVal === 0 ? '0.00%' : '100.00%';
  const change = ((prVal - baseVal) / baseVal) * 100;
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

async function run() {
  const args = parseArgs();

  if (args.action === 'build') {
    const repo = args.repo;
    const out = args.out;

    if (!repo || !out) {
      console.error('❌ Error: --repo and --out are required for build action.');
      process.exit(1);
    }

    const resolvedRepo = path.resolve(repo);
    const resolvedOut = path.resolve(out);

    // Create unique temp directory inside workspace to avoid permissions issues
    const tempDirName = `temp-size-check-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const tempDir = path.join(process.cwd(), tempDirName);

    console.log(`Creating temporary project in ${tempDir}...`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
      const cliPath = path.join(resolvedRepo, 'bin/avenx.js');
      if (!fs.existsSync(cliPath)) {
        throw new Error(`CLI not found at ${cliPath}`);
      }

      console.log('Scaffolding template project...');
      execSync(`node "${cliPath}" init`, { cwd: tempDir, stdio: 'ignore' });

      console.log('Building project bundle...');
      execSync(`node "${cliPath}" build`, { cwd: tempDir, stdio: 'ignore' });

      const jsPath = path.join(tempDir, 'dist/bundle.js');
      const cssPath = path.join(tempDir, 'dist/bundle.css');

      if (!fs.existsSync(jsPath) || !fs.existsSync(cssPath)) {
        throw new Error('Build failed: bundle.js or bundle.css is missing.');
      }

      const jsRaw = fs.readFileSync(jsPath, 'utf8');
      const cssRaw = fs.readFileSync(cssPath, 'utf8');

      console.log('Minifying assets...');
      /* eslint-disable camelcase */
      const jsMinifiedResult = await minify(jsRaw, {
        compress: {
          dead_code: true,
          drop_debugger: true,
          conditionals: true,
          evaluate: true,
          booleans: true,
          unused: true,
          if_return: true,
          join_vars: true,
        },
        mangle: true,
      });
      /* eslint-enable camelcase */

      const jsMinified = jsMinifiedResult.code || '';
      const cssMinified = minifyCss(cssRaw);

      const jsMetrics = getMetrics(jsRaw, jsMinified);
      const cssMetrics = getMetrics(cssRaw, cssMinified);

      const metrics = {
        js: jsMetrics,
        css: cssMetrics,
        total: {
          raw: jsMetrics.raw + cssMetrics.raw,
          minified: jsMetrics.minified + cssMetrics.minified,
          gzipped: jsMetrics.gzipped + cssMetrics.gzipped,
        },
      };

      console.log(`Writing metrics to ${resolvedOut}...`);
      fs.writeFileSync(resolvedOut, JSON.stringify(metrics, null, 2));
      console.log('Build size check complete.');
    } catch (err) {
      console.error('❌ Build size check failed:', err);
      process.exit(1);
    } finally {
      console.log('Cleaning up temporary project...');
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } else if (args.action === 'compare') {
    const base = args.base;
    const pr = args.pr;
    const markdown = args.markdown;
    const thresholdKb = parseFloat(args.threshold || '50');

    if (!base || !pr || !markdown) {
      console.error('❌ Error: --base, --pr, and --markdown are required for compare action.');
      process.exit(1);
    }

    try {
      const baseMetrics = JSON.parse(fs.readFileSync(path.resolve(base), 'utf8'));
      const prMetrics = JSON.parse(fs.readFileSync(path.resolve(pr), 'utf8'));

      const thresholdBytes = thresholdKb * 1024;
      const totalMinified = prMetrics.total.minified;
      const isOverThreshold = totalMinified > thresholdBytes;

      const jsDiff = prMetrics.js.minified - baseMetrics.js.minified;
      const cssDiff = prMetrics.css.minified - baseMetrics.css.minified;
      const totalDiff = prMetrics.total.minified - baseMetrics.total.minified;

      let statusEmoji = '✅';
      if (isOverThreshold) {
        statusEmoji = '🔴';
      } else if (totalDiff > 0) {
        statusEmoji = '⚠️';
      }

      const mdReport = `### 📊 Bundle Size Report

| Asset | Base Size (Minified / Gzipped) | PR Size (Minified / Gzipped) | Difference (Minified) | Status |
| :--- | :--- | :--- | :--- | :--- |
| **bundle.js** | ${formatBytes(baseMetrics.js.minified)} / ${formatBytes(baseMetrics.js.gzipped)} | ${formatBytes(prMetrics.js.minified)} / ${formatBytes(prMetrics.js.gzipped)} | ${formatDiff(jsDiff)} (${getPercentChange(baseMetrics.js.minified, prMetrics.js.minified)}) | ${jsDiff > 0 ? '⚠️' : '✅'} |
| **bundle.css** | ${formatBytes(baseMetrics.css.minified)} / ${formatBytes(baseMetrics.css.gzipped)} | ${formatBytes(prMetrics.css.minified)} / ${formatBytes(prMetrics.css.gzipped)} | ${formatDiff(cssDiff)} (${getPercentChange(baseMetrics.css.minified, prMetrics.css.minified)}) | ${cssDiff > 0 ? '⚠️' : '✅'} |
| **Total** | **${formatBytes(baseMetrics.total.minified)} / ${formatBytes(baseMetrics.total.gzipped)}** | **${formatBytes(prMetrics.total.minified)} / ${formatBytes(prMetrics.total.gzipped)}** | **${formatDiff(totalDiff)} (${getPercentChange(baseMetrics.total.minified, prMetrics.total.minified)})** | ${statusEmoji} |

* Configured threshold: **${thresholdKb.toFixed(2)} KB** (${formatBytes(thresholdBytes)} total minified)
* Current total minified: **${formatBytes(totalMinified)}** (${isOverThreshold ? 'Threshold exceeded 🔴' : 'Passed ✅'})
`;

      console.log(`Writing markdown report to ${markdown}...`);
      fs.writeFileSync(path.resolve(markdown), mdReport, 'utf8');

      if (isOverThreshold) {
        console.error(
          `❌ Error: Total bundle size (${formatBytes(totalMinified)}) exceeds configured threshold of ${thresholdKb} KB.`,
        );
        process.exit(1);
      } else {
        console.log('✅ Bundle size is within the threshold.');
        process.exit(0);
      }
    } catch (err) {
      console.error('❌ Compare size check failed:', err);
      process.exit(1);
    }
  } else {
    console.error('❌ Error: Unknown action. Use --action build or --action compare.');
    process.exit(1);
  }
}

run();
