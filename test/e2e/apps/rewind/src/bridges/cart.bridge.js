import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { quantity: 2 },
  bump: atomic(function () {
    this.quantity += 1;
  }),
});
