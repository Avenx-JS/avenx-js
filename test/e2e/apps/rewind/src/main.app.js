import { AvenxApp } from 'avenx-core/runtime';
import Observer from './components/observer/observer.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Observer', Observer);
app.initRouter({ '/': 'Rewind' });
