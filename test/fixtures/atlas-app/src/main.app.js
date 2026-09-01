import { AvenxApp } from 'avenx-core/runtime';
import AuthGuard from './guards/auth.guard.js';

const app = new AvenxApp({ target: '#app' });

app.initRouter({
  '': 'Cart',
  '#/cart': 'Cart',
  '#/checkout': { page: 'Checkout', guards: [AuthGuard] },
});

app.mount('Cart');
