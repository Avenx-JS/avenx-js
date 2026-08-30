import { AvenxApp } from 'avenx-core/runtime';
import CartItem from './components/cart-item/cart-item.component.js';
import PostCard from './components/post-card/post-card.component.js';

const app = new AvenxApp({ target: '#app' });

app.register('CartItem', CartItem);
app.register('PostCard', PostCard);

app.initRouter({
  '': 'Cart',
  '#/': 'Cart',
  '#/cart': 'Cart',
});
