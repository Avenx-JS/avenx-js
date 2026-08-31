import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Counter',
  '#/': 'Counter',
});
