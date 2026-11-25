import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Normalizes a file path to POSIX format relative to repository root.
 * @param {string} filePath
 * @param {string} [rootDir]
 * @returns {string}
 */
export function normalizeRepoPath(filePath, rootDir = repositoryRoot) {
  if (!filePath) return '';
  const normFile = filePath.replace(/\\/g, '/');
  const normRoot = rootDir.replace(/\\/g, '/');

  if (normFile.startsWith(normRoot)) {
    return normFile.slice(normRoot.length).replace(/^\/+/, '');
  }

  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
  const rel = path.relative(rootDir, resolved).replace(/\\/g, '/');
  return rel;
}

/**
 * Calculates percentage from covered and total counts.
 * @param {number} covered
 * @param {number} total
 * @returns {number}
 */
function toPercentage(covered, total) {
  if (!total || total === 0) return 100;
  return Number(((covered / total) * 100).toFixed(2));
}

/**
 * Aggregates coverage counts for global and each defined area.
 * @param {Record<string, any>} summaryData
 * @param {string[]} areaKeys
 * @param {string} [rootDir]
 * @returns {Record<string, { lines: { covered: number, total: number, pct: number }, branches: { covered: number, total: number, pct: number }, functions: { covered: number, total: number, pct: number }, statements: { covered: number, total: number, pct: number }, fileCount: number }>}
 */
export function aggregateAreas(summaryData, areaKeys, rootDir = repositoryRoot) {
  const result = {
    global: {
      lines: { covered: 0, total: 0, pct: 100 },
      branches: { covered: 0, total: 0, pct: 100 },
      functions: { covered: 0, total: 0, pct: 100 },
      statements: { covered: 0, total: 0, pct: 100 },
      fileCount: 0,
    },
  };

  for (const area of areaKeys) {
    result[area] = {
      lines: { covered: 0, total: 0, pct: 100 },
      branches: { covered: 0, total: 0, pct: 100 },
      functions: { covered: 0, total: 0, pct: 100 },
      statements: { covered: 0, total: 0, pct: 100 },
      fileCount: 0,
    };
  }

  // If summaryData has global "total", use it directly for global counts
  if (summaryData.total) {
    const t = summaryData.total;
    for (const metric of ['lines', 'branches', 'functions', 'statements']) {
      result.global[metric].covered = t[metric]?.covered || 0;
      result.global[metric].total = t[metric]?.total || 0;
      result.global[metric].pct = toPercentage(result.global[metric].covered, result.global[metric].total);
    }
  }

  let totalFileCount = 0;
  for (const [filePath, fileData] of Object.entries(summaryData)) {
    if (filePath === 'total' || !fileData) continue;
    totalFileCount += 1;
    const rel = normalizeRepoPath(filePath, rootDir);

    // If global counts were not present, accumulate from files
    if (!summaryData.total) {
      for (const metric of ['lines', 'branches', 'functions', 'statements']) {
        result.global[metric].covered += fileData[metric]?.covered || 0;
        result.global[metric].total += fileData[metric]?.total || 0;
      }
    }

    for (const area of areaKeys) {
      const match =
        area === 'bin' ? rel === 'bin' || rel.startsWith('bin/') : rel === area || rel.startsWith(`${area}/`);
      if (match) {
        result[area].fileCount += 1;
        for (const metric of ['lines', 'branches', 'functions', 'statements']) {
          result[area][metric].covered += fileData[metric]?.covered || 0;
          result[area][metric].total += fileData[metric]?.total || 0;
        }
      }
    }
  }

  result.global.fileCount = totalFileCount;
  if (!summaryData.total) {
    for (const metric of ['lines', 'branches', 'functions', 'statements']) {
      result.global[metric].pct = toPercentage(result.global[metric].covered, result.global[metric].total);
    }
  }

  for (const area of areaKeys) {
    for (const metric of ['lines', 'branches', 'functions', 'statements']) {
      result[area][metric].pct = toPercentage(result[area][metric].covered, result[area][metric].total);
    }
  }

  return result;
}

/**
 * Evaluates aggregated coverage against configured floor thresholds.
 * @param {ReturnType<typeof aggregateAreas>} aggregated
 * @param {{ global?: Record<string, number>, areas?: Record<string, Record<string, number>> }} thresholdsConfig
 * @returns {{ passed: boolean, violations: Array<{ area: string, metric: string, measured: number, floor: number }> }}
 */
export function evaluateThresholds(aggregated, thresholdsConfig) {
  const violations = [];
  const metrics = ['lines', 'branches', 'functions', 'statements'];

  const globalFloor = thresholdsConfig.global || thresholdsConfig.areas?.global;
  if (globalFloor && aggregated.global) {
    for (const m of metrics) {
      const floor = globalFloor[m];
      if (typeof floor === 'number') {
        const measured = aggregated.global[m].pct;
        if (measured < floor) {
          violations.push({ area: 'global', metric: m, measured, floor });
        }
      }
    }
  }

  if (thresholdsConfig.areas) {
    for (const [area, areaFloors] of Object.entries(thresholdsConfig.areas)) {
      if (area === 'global') continue;
      const areaData = aggregated[area];
      if (!areaData) {
        violations.push({ area, metric: 'all', measured: 0, floor: 0 });
        continue;
      }
      for (const m of metrics) {
        const floor = areaFloors[m];
        if (typeof floor === 'number') {
          const measured = areaData[m].pct;
          if (measured < floor) {
            violations.push({ area, metric: m, measured, floor });
          }
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Formats a delta number with explicit sign (+ / -).
 * @param {number} diff
 * @returns {string}
 */
function formatDelta(diff) {
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)}%`;
}

/**
 * Computes deltas between current coverage and base or fallback baseline.
 * @param {ReturnType<typeof aggregateAreas>} currentAggregated
 * @param {Record<string, any>} baseSource
 * @param {string[]} areaKeys
 * @returns {Record<string, Record<string, { current: number, base: number, delta: number, formatted: string }>>}
 */
export function computeDeltas(currentAggregated, baseSource, areaKeys) {
  const deltas = {};
  const metrics = ['lines', 'branches', 'functions', 'statements'];
  const allKeys = ['global', ...areaKeys];

  // Base source can either be an already aggregated object or raw baseline percentages
  const isRawPercentages = (entry) => entry && typeof entry.lines === 'number';

  for (const key of allKeys) {
    deltas[key] = {};
    const current = currentAggregated[key];
    const baseEntry = baseSource?.[key];

    for (const m of metrics) {
      const currentPct = current ? current[m].pct : 0;
      let basePct = currentPct;

      if (baseEntry) {
        if (isRawPercentages(baseEntry)) {
          basePct = baseEntry[m] ?? currentPct;
        } else if (baseEntry[m] && typeof baseEntry[m].pct === 'number') {
          basePct = baseEntry[m].pct;
        }
      }

      const diff = Number((currentPct - basePct).toFixed(2));
      deltas[key][m] = {
        current: currentPct,
        base: basePct,
        delta: diff,
        formatted: formatDelta(diff),
      };
    }
  }

  return deltas;
}

/**
 * Generates sticky Markdown coverage report for CI PR comment / summary.
 * @param {object} options
 * @param {ReturnType<typeof aggregateAreas>} options.currentAggregated
 * @param {object} options.thresholdsConfig
 * @param {ReturnType<typeof computeDeltas>} [options.deltas]
 * @param {Array<{ area: string, metric: string, measured: number, floor: number }>} [options.violations]
 * @param {Array<{ file: string, statements: number, branches: number, functions: number, lines: number }>} [options.changedFilesCoverage]
 * @returns {string}
 */
export function formatMarkdownReport({
  currentAggregated,
  thresholdsConfig,
  deltas,
  violations = [],
  changedFilesCoverage = [],
}) {
  const isPassing = violations.length === 0;
  const areaKeys = Object.keys(thresholdsConfig.areas || {}).filter((a) => a !== 'global');
  const allScopes = ['global', ...areaKeys];

  const lines = [
    '<!-- avenx-coverage-report -->',
    '### 📊 Test Coverage & Area Gates Report',
    '',
    isPassing
      ? '> [!NOTE]\n> **Coverage Gate Passed**: All global and per-area coverage thresholds are satisfied.'
      : '> [!WARNING]\n> **Coverage Gate Failed**: One or more coverage thresholds fell below the required floor.',
    '',
    '| Scope | Status | Lines (Floor) | Branches (Floor) | Functions (Floor) | Statements (Floor) | Delta (Lines) |',
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const scope of allScopes) {
    const data = currentAggregated[scope];
    if (!data) continue;

    const floorObj =
      scope === 'global' ? thresholdsConfig.global || thresholdsConfig.areas?.global : thresholdsConfig.areas?.[scope];
    const scopeViolations = violations.filter((v) => v.area === scope);
    const status = scopeViolations.length === 0 ? '✅ Pass' : '❌ Fail';

    const fmt = (metric) => {
      const pctVal = `${data[metric].pct.toFixed(2)}%`;
      const floorVal = floorObj && typeof floorObj[metric] === 'number' ? ` (≥${floorObj[metric]}%)` : '';
      return `${pctVal}${floorVal}`;
    };

    const deltaStr = deltas?.[scope]?.lines?.formatted || '0.00%';
    const scopeLabel = scope === 'global' ? '**global**' : `\`${scope}\``;

    lines.push(
      `| ${scopeLabel} | ${status} | ${fmt('lines')} | ${fmt('branches')} | ${fmt('functions')} | ${fmt('statements')} | ${deltaStr} |`,
    );
  }

  if (violations.length > 0) {
    lines.push('', '#### ⚠️ Threshold Violations', '');
    for (const v of violations) {
      lines.push(`- **${v.area}** \`${v.metric}\`: measured **${v.measured.toFixed(2)}%**, floor **${v.floor}%**`);
    }
  }

  if (changedFilesCoverage.length > 0) {
    lines.push(
      '',
      '<details><summary>Changed Source Files Coverage</summary>',
      '',
      '| File | Statements | Branches | Functions | Lines |',
      '| :--- | :---: | :---: | :---: | :---: |',
    );
    for (const item of changedFilesCoverage) {
      lines.push(
        `| \`${item.file}\` | ${item.statements.toFixed(1)}% | ${item.branches.toFixed(1)}% | ${item.functions.toFixed(1)}% | ${item.lines.toFixed(1)}% |`,
      );
    }
    lines.push('', '</details>');
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Filters and extracts changed source files coverage from summary data.
 * @param {Record<string, any>} summaryData
 * @param {string[]} changedFilesList
 * @param {string} rootDir
 * @returns {Array<{ file: string, statements: number, branches: number, functions: number, lines: number }>}
 */
function getChangedFilesCoverage(summaryData, changedFilesList, rootDir = repositoryRoot) {
  const result = [];
  const normalizedSet = new Set(changedFilesList.map((f) => normalizeRepoPath(f, rootDir)));

  for (const [filePath, data] of Object.entries(summaryData)) {
    if (filePath === 'total' || !data) continue;
    const rel = normalizeRepoPath(filePath, rootDir);
    if ((rel.startsWith('lib/') || rel.startsWith('bin/')) && normalizedSet.has(rel)) {
      result.push({
        file: rel,
        statements: data.statements?.pct ?? 0,
        branches: data.branches?.pct ?? 0,
        functions: data.functions?.pct ?? 0,
        lines: data.lines?.pct ?? 0,
      });
    }
  }

  return result.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Main CLI entrypoint.
 */
export function main(cliArgs = process.argv.slice(2)) {
  let summaryPath = path.resolve(repositoryRoot, 'coverage/coverage-summary.json');
  let thresholdsPath = path.resolve(repositoryRoot, 'coverage-thresholds.json');
  let basePath = null;
  let changedFilesPath = null;
  let markdownPath = null;

  for (let i = 0; i < cliArgs.length; i += 1) {
    const arg = cliArgs[i];
    if (arg === '--summary' && i + 1 < cliArgs.length) {
      summaryPath = path.resolve(repositoryRoot, cliArgs[++i]);
    } else if (arg === '--thresholds' && i + 1 < cliArgs.length) {
      thresholdsPath = path.resolve(repositoryRoot, cliArgs[++i]);
    } else if (arg === '--base' && i + 1 < cliArgs.length) {
      basePath = path.resolve(repositoryRoot, cliArgs[++i]);
    } else if (arg === '--changed-files' && i + 1 < cliArgs.length) {
      changedFilesPath = path.resolve(repositoryRoot, cliArgs[++i]);
    } else if (arg === '--markdown' && i + 1 < cliArgs.length) {
      markdownPath = path.resolve(repositoryRoot, cliArgs[++i]);
    }
  }

  if (!fs.existsSync(summaryPath)) {
    console.error(`❌ Coverage summary not found at: ${summaryPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(thresholdsPath)) {
    console.error(`❌ Coverage thresholds file not found at: ${thresholdsPath}`);
    process.exit(1);
  }

  const summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const thresholdsConfig = JSON.parse(fs.readFileSync(thresholdsPath, 'utf8'));
  const areaKeys = Object.keys(thresholdsConfig.areas || {}).filter((a) => a !== 'global');

  const currentAggregated = aggregateAreas(summaryData, areaKeys, repositoryRoot);
  const evaluation = evaluateThresholds(currentAggregated, thresholdsConfig);

  // Compute deltas against base summary file or committed baseline
  let baseSource = thresholdsConfig.baseline;
  if (basePath && fs.existsSync(basePath)) {
    try {
      const baseSummary = JSON.parse(fs.readFileSync(basePath, 'utf8'));
      baseSource = aggregateAreas(baseSummary, areaKeys, repositoryRoot);
    } catch {
      baseSource = thresholdsConfig.baseline;
    }
  }
  const deltas = computeDeltas(currentAggregated, baseSource, areaKeys);

  // Read changed source files if provided
  let changedFilesCoverage = [];
  if (changedFilesPath && fs.existsSync(changedFilesPath)) {
    const rawChanged = fs
      .readFileSync(changedFilesPath, 'utf8')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    changedFilesCoverage = getChangedFilesCoverage(summaryData, rawChanged, repositoryRoot);
  }

  // Print crisp terminal table
  console.log('\n========================================================================================');
  console.log('📊 Coverage Gate & Area Thresholds Check');
  console.log('========================================================================================');
  console.log(
    `${'Scope'.padEnd(22)} | ${'Lines (Floor)'.padEnd(16)} | ${'Branches (Floor)'.padEnd(16)} | ${'Funcs (Floor)'.padEnd(14)} | ${'Stmts (Floor)'.padEnd(14)} | Status`,
  );
  console.log('----------------------------------------------------------------------------------------');

  const allScopes = ['global', ...areaKeys];
  for (const scope of allScopes) {
    const data = currentAggregated[scope];
    if (!data) continue;
    const floorObj =
      scope === 'global' ? thresholdsConfig.global || thresholdsConfig.areas?.global : thresholdsConfig.areas?.[scope];
    const scopeViolations = evaluation.violations.filter((v) => v.area === scope);
    const status = scopeViolations.length === 0 ? '✅ Pass' : '❌ Fail';

    const fmt = (metric) => {
      const p = `${data[metric].pct.toFixed(2)}%`;
      const f = floorObj && typeof floorObj[metric] === 'number' ? ` (≥${floorObj[metric]}%)` : '';
      return `${p}${f}`;
    };

    console.log(
      `${scope.padEnd(22)} | ${fmt('lines').padEnd(16)} | ${fmt('branches').padEnd(16)} | ${fmt('functions').padEnd(14)} | ${fmt('statements').padEnd(14)} | ${status}`,
    );
  }
  console.log('========================================================================================');

  if (markdownPath) {
    const md = formatMarkdownReport({
      currentAggregated,
      thresholdsConfig,
      deltas,
      violations: evaluation.violations,
      changedFilesCoverage,
    });
    fs.writeFileSync(markdownPath, md, 'utf8');
    console.log(`📝 Written coverage markdown report to: ${markdownPath}`);
  }

  if (!evaluation.passed) {
    console.error('\n❌ Coverage threshold violations detected:');
    for (const v of evaluation.violations) {
      console.error(`  - [${v.area}] ${v.metric}: measured ${v.measured.toFixed(2)}%, required floor ${v.floor}%`);
    }
    process.exit(1);
  }

  console.log('\n✅ All global and per-area coverage thresholds passed.');
  process.exit(0);
}

// Execute when run directly from CLI
const isDirectExecution =
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
    fileURLToPath(import.meta.url) === path.resolve(process.cwd(), process.argv[1]));

if (isDirectExecution) {
  main();
}
