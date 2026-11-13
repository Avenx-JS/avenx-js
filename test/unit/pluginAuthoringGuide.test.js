import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import '../helpers/register-happy-dom.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

document.body.innerHTML = '<div id="app"></div>';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-plugin-guide-'));
const componentFile = path.join(tempDir, 'IconComponent.component.js');
fs.writeFileSync(componentFile, '<span data-testid="plugin-icon">icon</span>');
const generated = new ComponentParser(new StyleProcessor()).parse(componentFile, 'component');
const IconComponent = new Function('AvenxComponent', `${generated}\nreturn IconComponent;`)(AvenxComponent);
const IconPlugin = {
  name: 'IconPlugin',
  install(app) {
    app.register('IconComponent', IconComponent);
  },
};
const app = new AvenxApp({ target: '#app' });
app.use(IconPlugin);
app.mount('IconComponent');
assert.ok(document.querySelector('[data-testid="plugin-icon"]'));
fs.rmSync(tempDir, { recursive: true, force: true });
