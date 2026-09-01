import { AvenxApp } from 'avenx-core/runtime';
import TodoList from './components/todo-list/todo-list.component.js';

/* global AvenxPersistence -- loaded from a <script> tag; see index.html. */

const app = new AvenxApp({ target: '#app' });

// Installed before anything reads the persisted bridge, so these defaults
// reach it. A bridge hydrates on first use and reads its configuration once,
// at that moment.
app.use(AvenxPersistence.avenxPersistence, {
  prefix: 'avenx-todo:',
  onError: ({ key, phase, message }) => {
    console.warn(`[todo] persistence ${phase} failed for "${key}": ${message}`);
  },
});

app.register('TodoList', TodoList);
app.mount('TodoList');

// The queued save runs at the end of the tick. A page that is going away may
// not get one, so write anything still pending first.
window.addEventListener('pagehide', () => app.$persistence.flush());
