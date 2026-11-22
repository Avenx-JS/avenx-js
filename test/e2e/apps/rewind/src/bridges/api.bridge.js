import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {},
  save(outcome) {
    return fetch('/api/rewind?outcome=' + outcome)
      .then((response) => response.json())
      .then((result) => {
        if (!result.ok) throw new Error('rewind request rejected');
        return result;
      });
  },
});
