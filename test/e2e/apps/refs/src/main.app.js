import { AvenxApp } from 'avenx-core/runtime';
import Child from './components/child.component.js';

const app = new AvenxApp({ target: '#app' });
app.register('Child', Child);
app.initRouter({ '': 'Refs' });
