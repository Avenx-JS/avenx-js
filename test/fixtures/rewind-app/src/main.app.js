import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Cart',
  '#/cart': 'Cart',
});

app.mount('Cart');
