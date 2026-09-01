import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: {
    items: [{ id: 'a', qty: 1, price: 12 }],
    revision: 0,
  },

  get total() {
    return this.items.reduce((sum, item) => sum + item.qty * item.price, 0);
  },

  // Transactional: the quantity bump and the revision bump are one change.
  // If whatever called this fails, neither of them stands.
  addQty: atomic(function (id, n) {
    const item = this.items.find((entry) => entry.id === id);
    if (item) {
      item.qty = item.qty + n;
    }
    this.revision = this.revision + 1;
  }),

  // Atomic, and deliberately unreadable to the analyser: the key it writes is
  // computed, so Atlas cannot say what this touches. The journal still records
  // it — this is what AVX_W42 exists to say out loud.
  setField: atomic(function (id, field, value) {
    const item = this.items.find((entry) => entry.id === id);
    if (item) {
      item[field] = value;
    }
  }),
});
