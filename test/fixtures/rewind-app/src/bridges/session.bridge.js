import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: {
    lastSaved: 0,
    dirty: false,
  },

  // Declared atomic, but it emits and it writes storage. Neither of those can
  // be undone, which is exactly what the build reports as AVX_W43.
  save: atomic(function (stamp) {
    this.lastSaved = stamp;
    this.dirty = false;
    localStorage.setItem('lastSaved', String(stamp));
    this.emit('saved', stamp);
  }),
});
