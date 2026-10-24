import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [baseSha, headSha, coveragePath, outputPath] = process.argv.slice(2);

if (!baseSha || !headSha || !coveragePath || !outputPath) {
  throw new Error('Usage: node scripts/compilerCoverageReport.js <base-sha> <head-sha> <coverage-json> <output-file>');
}

function runGit(args) {
  return execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
}

function isCompilerSource(file) {
  return /^lib\/compiler(?:\/|\.js$)/.test(file);
}

function repositoryPath(file) {
  const absolutePath = path.isAbsolute(file) ? file : path.resolve(repositoryRoot, file);
  return path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
}

function percentage(covered, total) {
  return total === 0 ? 'N/A' : `${((covered / total) * 100).toFixed(1)}%`;
}

function readCoverageFile(file) {
  const statements = Object.entries(file.statementMap || {}).map(([id, location]) => ({
    start: location.start.line,
    end: location.end.line,
    hit: (file.s || {})[id] > 0,
  }));
  const lineCounts = new Map();

  for (const [id, location] of Object.entries(file.statementMap || {})) {
    const line = location.start.line;
    const hits = (file.s || {})[id] || 0;
    lineCounts.set(line, Math.min(lineCounts.get(line) ?? hits, hits));
  }

  const branches = Object.values(file.b || {}).flat();
  const lineCovered = [...lineCounts.values()].filter((hits) => hits > 0).length;
  const branchCovered = branches.filter((hits) => hits > 0).length;

  return {
    statements,
    lines: lineCounts.size,
    lineCovered,
    branches: branches.length,
    branchCovered,
    branchMap: file.branchMap || {},
    branchHits: file.b || {},
  };
}

const changedNames = runGit([
  'diff',
  '--name-only',
  '-z',
  `${baseSha}...${headSha}`,
  '--',
  'lib/compiler',
  'lib/compiler.js',
])
  .split('\0')
  .filter(Boolean)
  .filter(isCompilerSource);

const numstat = runGit(['diff', '--numstat', '-z', `${baseSha}...${headSha}`, '--', 'lib/compiler', 'lib/compiler.js']);
let addedLines = 0;
let deletedLines = 0;
for (const entry of numstat.split('\0').filter(Boolean)) {
  const [added, deleted] = entry.split('\t');
  if (added !== '-') addedLines += Number(added);
  if (deleted !== '-') deletedLines += Number(deleted);
}

const patch = runGit([
  'diff',
  '--no-ext-diff',
  '--no-color',
  '--unified=0',
  `${baseSha}...${headSha}`,
  '--',
  'lib/compiler',
  'lib/compiler.js',
]);
const changedLinesByFile = new Map();
let currentFile = null;
let newLine = 0;

for (const line of patch.split(/\r?\n/)) {
  if (line.startsWith('+++ b/')) {
    currentFile = line.slice('+++ b/'.length);
  } else if (line.startsWith('+++ ')) {
    currentFile = null;
  } else if (line.startsWith('@@ ')) {
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    newLine = match ? Number(match[1]) : 0;
  } else if (line.startsWith('+') && !line.startsWith('+++')) {
    if (currentFile && isCompilerSource(currentFile)) {
      if (!changedLinesByFile.has(currentFile)) changedLinesByFile.set(currentFile, new Set());
      changedLinesByFile.get(currentFile).add(newLine);
    }
    newLine += 1;
  } else if (line.startsWith(' ')) {
    newLine += 1;
  }
}

const coverageJson = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
const coverageByFile = new Map(
  Object.entries(coverageJson).map(([file, data]) => [repositoryPath(file), readCoverageFile(data)]),
);
const compilerFiles = [...coverageByFile.entries()].filter(([file]) => isCompilerSource(file));
const totalLines = compilerFiles.reduce((total, [, file]) => total + file.lines, 0);
const coveredLines = compilerFiles.reduce((total, [, file]) => total + file.lineCovered, 0);
const totalBranches = compilerFiles.reduce((total, [, file]) => total + file.branches, 0);
const coveredBranches = compilerFiles.reduce((total, [, file]) => total + file.branchCovered, 0);

let changedExecutable = 0;
let changedCovered = 0;
const uncovered = [];
let changedUnmeasured = 0;
let changedBranchOutcomes = 0;
let changedBranchesCovered = 0;
const uncoveredBranches = [];

for (const [file, lines] of changedLinesByFile) {
  const coverage = coverageByFile.get(file);
  for (const line of lines) {
    const statements = coverage?.statements.filter((statement) => line >= statement.start && line <= statement.end);
    if (!statements?.length) {
      changedUnmeasured += 1;
      continue;
    }
    changedExecutable += 1;
    if (statements.some((statement) => statement.hit)) {
      changedCovered += 1;
    } else {
      uncovered.push(`${file}:${line}`);
    }
  }

  if (!coverage) continue;
  for (const [branchId, branch] of Object.entries(coverage.branchMap || {})) {
    const outcomes = coverage.branchHits[branchId] || [];
    const locations = branch.locations || [];
    outcomes.forEach((hits, index) => {
      const location = locations[index] || branch.loc;
      if (!location || ![...lines].some((line) => line >= location.start.line && line <= location.end.line)) return;
      changedBranchOutcomes += 1;
      if (hits > 0) {
        changedBranchesCovered += 1;
      } else {
        uncoveredBranches.push(`${file}:${location.start.line} (branch ${branchId})`);
      }
    });
  }
}

const uncoveredStatus =
  changedExecutable === 0 && changedBranchOutcomes === 0
    ? 'Could not determine: no changed executable lines were measured.'
    : uncovered.length > 0 || uncoveredBranches.length > 0
      ? `Yes - ${uncovered.length} changed executable line(s) and ${uncoveredBranches.length} changed branch outcome(s) are not covered.`
      : 'No - all measured changed executable lines and branch outcomes are covered.';

const lines = [
  '### Compiler Test Coverage',
  '',
  ...(process.env.TEST_RESULT ? [`- **Test run:** ${process.env.TEST_RESULT}`] : []),
  `- **Overall compiler line coverage:** ${percentage(coveredLines, totalLines)} (${coveredLines}/${totalLines} executable lines)`,
  `- **Overall compiler branch coverage:** ${percentage(coveredBranches, totalBranches)} (${coveredBranches}/${totalBranches} branches)`,
  `- **Compiler files changed:** ${changedNames.length}`,
  `- **Diff size:** +${addedLines} / -${deletedLines} lines`,
  `- **Changed executable lines measured:** ${percentage(changedCovered, changedExecutable)} (${changedCovered}/${changedExecutable}); ${changedUnmeasured} changed line(s) were not measured`,
  `- **Changed branch outcomes measured:** ${percentage(changedBranchesCovered, changedBranchOutcomes)} (${changedBranchesCovered}/${changedBranchOutcomes})`,
  `- **New uncovered code:** ${uncoveredStatus}`,
];

if (uncovered.length > 0 || uncoveredBranches.length > 0) {
  lines.push(
    '',
    '<details><summary>Uncovered changed lines and branches</summary>',
    '',
    ...uncovered.map((line) => `- \`${line}\``),
    ...uncoveredBranches.map((branch) => `- \`${branch}\``),
    '',
    '</details>',
  );
}

if (changedExecutable === 0 && changedBranchOutcomes === 0 && addedLines > 0) {
  lines.push('', 'Changed lines could not be matched to executable lines in the coverage report.');
}

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
