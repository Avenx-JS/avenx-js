import { performance } from 'perf_hooks';
import '../test/helpers/register-happy-dom.js';
import { AvenxApp } from '../lib/core/runtime/AvenxApp.js';
import { AvenxRouter } from '../lib/core/runtime/AvenxRouter.js';

/**
 * Runs benchmarks on the routing system.
 */
function benchmark() {
  const iterations = 5000;
  const appContainer = document.createElement('div');
  appContainer.id = 'app';
  document.body.appendChild(appContainer);
  const app = new AvenxApp({ target: '#app' });

  // 1. Compile routes and instantiate router
  const routes = {
    '#/': 'Home',
    '#/about': 'About',
    '#/contact': 'Contact',
    '#/user/:id': 'UserProfile',
    '#/user/:id/posts/:postId': 'UserPost',
    '#/settings/*': 'Settings',
    '#/docs/*': 'Docs',
    '#/shop/category/:catId/item/:itemId': 'ShopItem',
  };

  const startInit = performance.now();
  for (let i = 0; i < iterations; i++) {
    const router = new AvenxRouter(app, routes);
    router.destroy();
  }
  const endInit = performance.now();
  const initTime = endInit - startInit;

  // 2. Route matching with a single router
  const router = new AvenxRouter(app, routes);

  const testHashes = [
    '#/',
    '#/about',
    '#/user/123',
    '#/user/abc/posts/456',
    '#/settings/profile/security',
    '#/shop/category/books/item/978-3-16',
    '#/non-existent-route',
  ];

  const startMatch = performance.now();
  for (let i = 0; i < iterations; i++) {
    for (const hash of testHashes) {
      router.matches(hash);
    }
  }
  const endMatch = performance.now();
  const matchTime = endMatch - startMatch;

  // 3. Large Route Table Match (500 routes)
  const largeRoutes = {};
  for (let i = 0; i < 500; i++) {
    largeRoutes[`#/route-${i}/:param`] = `Page${i}`;
  }
  largeRoutes['#/target-route/:id'] = 'TargetPage';

  const largeRouter = new AvenxRouter(app, largeRoutes);
  const startLargeMatch = performance.now();
  const largeIterations = 200;
  for (let i = 0; i < largeIterations; i++) {
    largeRouter.matches('#/target-route/456');
    largeRouter.matches('#/non-existent-route');
  }
  const endLargeMatch = performance.now();
  const largeMatchTime = (endLargeMatch - startLargeMatch) * (iterations / largeIterations);

  router.destroy();
  largeRouter.destroy();
  document.body.removeChild(appContainer);

  const totalOps = iterations + iterations * testHashes.length + iterations * 2;
  const totalTime = initTime + matchTime + largeMatchTime;
  const avgTime = totalTime / totalOps;

  console.log(`Running Router benchmark with ${iterations} iterations...`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average time per operation: ${avgTime.toFixed(4)}ms`);
  console.log(`Ops/sec: ${Math.round(1000 / avgTime)}`);
  console.log(`  - Router Init: ${initTime.toFixed(2)}ms`);
  console.log(`  - Route Matches: ${matchTime.toFixed(2)}ms`);
  console.log(`  - Large Route Table: ${largeMatchTime.toFixed(2)}ms`);
}

benchmark();
