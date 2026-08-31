import { AvenxApp } from 'avenx-core/runtime';
import StatCard from './components/stat-card/stat-card.component.js';

const app = new AvenxApp({ target: '#app' });

app.register('StatCard', StatCard);

app.initRouter({
  '': 'Composition',
  '#/': 'Composition',
});
