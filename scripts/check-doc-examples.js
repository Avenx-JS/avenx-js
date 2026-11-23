import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'test/fixtures/docs');

// Keep fence boundaries: a Markdown example can itself contain shorter fences.
export function codeBlocks(source, file) {
  const blocks = [];
  let open = null;
  for (const [index, line] of source.split(/\r?\n/).entries()) {
    if (open) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/);
      if (close && close[1][0] === open.fence[0] && close[1].length >= open.fence.length) {
        blocks.push({ ...open, code: open.lines.join('\n') + '\n' });
        open = null;
      } else {
        open.lines.push(line);
      }
    } else {
      const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (start) {
        const [language = '', ...info] = start[2].trim().split(/\s+/);
        const markers = info.filter((part) => part === 'avenx-build' || part.startsWith('avenx-build='));
        if (markers.length > 1) throw new Error(`${file}:${index + 1}: duplicate avenx-build marker`);
        open = { file, line: index + 2, fence: start[1], language, marker: markers[0], lines: [] };
      }
    }
  }
  if (open?.marker) throw new Error(`${file}:${open.line}: unclosed marked code fence`);
  return blocks;
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(file);
      return entry.isFile() && /\.mdx?$/.test(entry.name) ? [file] : [];
    });
}

export function checkExamples(directory, report = console.log) {
  const blocks = markdownFiles(directory).flatMap((file) => codeBlocks(fs.readFileSync(file, 'utf8'), file));
  const marked = blocks.filter((block) => block.marker);
  const result = { covered: marked.length, unmarked: blocks.length - marked.length, failed: 0 };
  if (!marked.length) throw new Error('No marked documentation examples found');
  for (const block of marked) {
    const location = `${path.relative(root, block.file)}:${block.line}`;
    let scratch;
    try {
      if (!['js', 'javascript'].includes(block.language)) {
        throw new Error('avenx-build requires a javascript or js application entry');
      }
      const fixture = block.marker.includes('=') ? block.marker.split('=')[1] : 'basic';
      if (!/^[a-z0-9-]+$/.test(fixture) || !fs.existsSync(path.join(fixtures, fixture))) {
        throw new Error(`Unknown documentation fixture: ${fixture}`);
      }
      scratch = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'avenx-doc-example-'));
      fs.cpSync(path.join(fixtures, fixture), scratch, { recursive: true });
      // Compile the published example verbatim. Supporting pages live in the
      // named fixture; do not patch snippets or inject imports to make them pass.
      fs.writeFileSync(path.join(scratch, 'src/main.app.js'), block.code);
      const build = spawnSync(process.execPath, [path.join(root, 'bin/avenx.js'), 'build'], {
        cwd: scratch, encoding: 'utf8', timeout: 60000,
        env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 4 * 1024 * 1024,
      });
      if (build.error || build.status !== 0) {
        throw new Error(`${build.error || `build exited ${build.status}`}\n${build.stdout || ''}${build.stderr || ''}`);
      }
      if (!fs.statSync(path.join(scratch, 'dist/bundle.js')).size) {
        throw new Error('Build produced an empty bundle');
      }
      report(`PASS ${location} (${fixture})`);
    } catch (error) {
      result.failed += 1;
      report(`FAIL ${location}\n${error.message}`);
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  report(`Documentation examples: ${result.covered} covered, ${result.unmarked} unmarked, ${result.failed} failed`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3) throw new Error('Usage: node scripts/check-doc-examples.js [docs-directory]');
    const result = checkExamples(path.resolve(process.argv[2] || path.join(root, 'docs/src/content/docs')));
    process.exitCode = result.failed ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
