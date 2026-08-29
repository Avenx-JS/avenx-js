import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    items: [],
    coupon: null,
    discount: 0,
  },

  get total() {
    return this.items.reduce((sum, item) => sum + item.qty * item.price, 0);
  },

  get count() {
    return this.items.length;
  },

  addQty(id, n) {
    const item = this.items.find((entry) => entry.id === id);
    if (item) {
      item.qty = item.qty + n;
    }
    this.emit('changed', id);
  },

  applyCoupon(code) {
    this.coupon = code;
    this.discount = 10;
  },
});
