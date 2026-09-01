import { AvenxApp } from 'avenx-core/runtime';
import HeavyPanel from './components/heavy-panel/heavy-panel.component.js';

const app = new AvenxApp({ target: '#app' });

app.register('HeavyPanel', HeavyPanel);

app.initRouter({
  '': 'Defer',
  '#/': 'Defer',
  '#/timer': 'Timer',
  // Drives a documented bug; see component-defer.page.js.
  '#/component': 'ComponentDefer',
  '#/stateful': 'StatefulDefer',
  '#/visible': 'Visible',
});
