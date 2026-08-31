import { AvenxApp } from 'avenx-core/runtime';
import AlphaBox from './components/alpha-box/alpha-box.component.js';
import BetaBox from './components/beta-box/beta-box.component.js';

const app = new AvenxApp({ target: '#app' });

app.register('AlphaBox', AlphaBox);
app.register('BetaBox', BetaBox);

app.initRouter({
  '': 'Styling',
  '#/': 'Styling',
});
