/**
 * @file atlasSlotProps.test.js
 * @description Slot-prop expressions count as state reads without hiding unused state.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AvenxCompiler from '../../lib/compiler.js';
import { findUnreadState } from '../../lib/compiler/atlas/diagnostics.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-atlas-slot-'));
try {
  fs.writeFileSync(path.join(root, 'avenx.config.json'), '{}');
  const source = path.join(root, 'src/components/probe/probe.component.js');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(
    source,
    `<state label="Avenx" visible="true" unused="1" />
<div><slot name="row" :label="label" :visible="visible">Fallback</slot></div>`,
  );
  const model = new AvenxCompiler({
    rootDir: root,
    srcDir: 'src',
    distDir: 'dist',
    logging: { silent: true },
  }).analyze();
  assert.deepStrictEqual(
    findUnreadState(model)
      .map((finding) => finding.node.id)
      .sort(),
    ['state:component:Probe.unused'],
    'slot props must count as reads without suppressing genuinely unused state',
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
