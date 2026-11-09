import { AvenxApp } from 'avenx-core/runtime';

const app = new AvenxApp({ target: '#app' });

// Both pages are emitted as lazy chunks under dist/pages/ because
// avenx.config.json turns codeSplitting on. The bundle only carries the
// runtime and a loader per page, so anything a page renders came through a
// chunk the browser fetched on demand.
app.initRouter({
  '/': 'Home',
  '#/about': 'About',
});
