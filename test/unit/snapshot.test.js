import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSnapshot, serializeSnapshot, getObsoleteSnapshots, mountTestComponent } from '../../lib/core/testing.js';
import { AvenxComponent } from '../../lib/core/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const snapshotDir = path.join(__dirname, '__snapshots__');
const snapshotFile = path.join(snapshotDir, `${path.basename(__filename)}.snap`);

function cleanup() {
  if (fs.existsSync(snapshotFile)) {
    fs.unlinkSync(snapshotFile);
  }
  if (fs.existsSync(snapshotDir)) {
    try {
      fs.rmdirSync(snapshotDir);
    } catch {
      // directory may have other files in future runs
    }
  }
}

// Clean before run
cleanup();

// Preserve original CI environment variable during fixture testing
const initialCI = process.env.CI;
delete process.env.CI;

try {
  // 1. Serialization & Masking Test
  const rawMarkup = '<div class="card ax-a8f190" id="item-123"><span data-b="2" data-a="1">Hello</span></div>';
  const serialized = serializeSnapshot(rawMarkup, {
    masks: [{ match: /item-\d+/, replace: 'item-[id]' }],
  });

  assert.ok(serialized.includes('ax-[hash]'), 'Serializes and masks scoped CSS class hashes');
  assert.ok(serialized.includes('item-[id]'), 'Serializes and applies custom user mask');
  assert.ok(serialized.includes('data-a="1" data-b="2"'), 'Serializes attributes in alphabetical order');

  // 2. Initial Snapshot Write
  assertSnapshot(rawMarkup, 'basic markup', { testFile: __filename });
  assert.ok(fs.existsSync(snapshotFile), 'Snapshot file created on first assertion');

  const initialData = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  assert.ok(initialData['basic markup'], 'Persists named snapshot');

  // 3. Subsequent Matching Snapshot Passes
  assert.doesNotThrow(() => {
    assertSnapshot(rawMarkup, 'basic markup', { testFile: __filename });
  }, 'Exact matching snapshot does not throw');

  // 4. Mismatch Throws Readable Diff
  assert.throws(
    () => {
      assertSnapshot('<div class="card ax-a8f190">Different Content</div>', 'basic markup', {
        testFile: __filename,
      });
    },
    (err) => {
      return err.message.includes('Snapshot mismatch') && err.message.includes('-');
    },
    'Mismatched snapshot throws with a diff'
  );

  // 5. Update Snapshot Mode Rewrites
  const previousUpdateVal = process.env.AVENX_UPDATE_SNAPSHOTS;
  try {
    process.env.AVENX_UPDATE_SNAPSHOTS = '1';
    assert.doesNotThrow(() => {
      assertSnapshot('<div>Updated Content</div>', 'basic markup', { testFile: __filename });
    }, 'Update mode suppresses mismatch error and overwrites');

    const updatedData = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    assert.ok(updatedData['basic markup'].includes('Updated Content'), 'Overwrites existing snapshot content');
  } finally {
    if (previousUpdateVal === undefined) {
      delete process.env.AVENX_UPDATE_SNAPSHOTS;
    } else {
      process.env.AVENX_UPDATE_SNAPSHOTS = previousUpdateVal;
    }
  }

  // 6. CI Mode Rejects Missing Snapshot
  try {
    process.env.CI = 'true';
    assert.throws(
      () => {
        assertSnapshot('<div>New Content</div>', 'uncommitted snapshot', { testFile: __filename });
      },
      /does not exist in CI mode/,
      'Fails in CI mode if snapshot is missing'
    );
  } finally {
    delete process.env.CI;
  }

  // 7. Obsolete Snapshot Detection
  const obsolete = getObsoleteSnapshots(__filename);
  assert.ok(Array.isArray(obsolete), 'Returns obsolete snapshot array');

  // 8. Component Mount Wrapper .toMatchSnapshot() Test
  class SampleCard extends AvenxComponent {
    render() {
      return `<div class="sample-card"><h1>Hello Snapshot</h1></div>`;
    }
  }

  const wrapper = await mountTestComponent(SampleCard);
  assert.doesNotThrow(() => {
    wrapper.toMatchSnapshot('sample card render', { testFile: __filename });
  }, 'wrapper.toMatchSnapshot() asserts successfully');

  // Clean up generated fixture snapshots
  cleanup();

  console.log('✅ All snapshot assertion helper tests passed.');
} finally {
  if (initialCI !== undefined) {
    process.env.CI = initialCI;
  } else {
    delete process.env.CI;
  }
}