import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';
import { loadComponent } from '../../lib/core/tooling/loadComponent.js';
import { mountTestComponent } from '../../lib/core/testing.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-initial-validation-'));
let wrapper;
try {
  const file = path.join(root, 'form.component.js');
  fs.writeFileSync(file, `<state email="" />
<div>
  <input aria-label="Email" name="email" data-ax-bind="email" data-ax-validate="required|email" />
  <p id="valid">{{ state.$validation?.isValid }}</p>
</div>`);
  wrapper = await mountTestComponent(loadComponent(file));
  assert.equal(wrapper.instance.state.$validation?.isValid, false);
  assert.equal(wrapper.element.querySelector('#valid').textContent, 'false');
  const input = wrapper.element.querySelector('input');
  input.value = 'reader@example.com';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wrapper.instance.$nextTick();
  assert.equal(wrapper.instance.state.$validation.isValid, true);
  assert.equal(wrapper.element.querySelector('#valid').textContent, 'true');
  assert.deepEqual(Array.from(wrapper.instance.state.$validation.errors.email), []);
  const field = wrapper.instance.state.$validation.fields.email;
  wrapper.update();
  await wrapper.instance.$nextTick();
  assert.equal(wrapper.instance.state.$validation.fields.email, field,
    'unchanged validation must not keep replacing reactive objects and scheduling renders');
} finally {
  wrapper?.unmount();
  fs.rmSync(root, { recursive: true, force: true });
}
