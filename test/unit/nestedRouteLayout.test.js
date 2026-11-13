import assert from 'node:assert/strict';
import '../helpers/register-happy-dom.js';
import '../../lib/core/renderer/installStringRenderer.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';

class AdminLayout extends AvenxPage {
  static instance = null;

  constructor(...args) {
    super(...args);
    AdminLayout.instance = this;
  }

  render() {
    return '<div data-layout><slot></slot></div>';
  }
}

class Page extends AvenxPage {
  render() { return '<section data-page>Page</section>'; }
}

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

async function testNestedRouteLayout() {
  const container = document.createElement('div');
  container.id = 'app';
  document.body.appendChild(container);
  window.location.hash = '#/admin/dashboard';
  AdminLayout.instance = null;

  const app = new AvenxApp({ target: '#app' });
  app.registerPage('Dashboard', Page);
  app.registerPage('Users', Page);
  app.registerPage('Home', Page);
  const router = app.initRouter({
    '/admin': {
      layout: AdminLayout,
      children: [
        { path: '/dashboard', page: 'Dashboard' },
        { path: '/users', page: 'Users' },
      ],
    },
    '/': 'Home',
  });

  try {
    await tick();
    const layout = app.target.querySelector('[data-layout]');
    assert.ok(layout, 'the configured parent layout should be rendered');
    assert.ok(app.target.querySelector('[data-page]'), 'the active child should render inside the layout');
    AdminLayout.instance.state.activeTab = 'users';

    router.navigate('#/admin/users');
    await tick();
    assert.equal(app.target.querySelector('[data-layout]'), layout);
    assert.equal(AdminLayout.instance.state.activeTab, 'users');
    assert.ok(app.target.querySelector('[data-page]'));

    router.navigate('#/');
    await tick();
    assert.equal(app.target.querySelector('[data-layout]'), null);
    assert.throws(() => app.mountPage('Dashboard', {}, { layout: 'MissingLayout' }), /AVX_R02.*MissingLayout/);
  } finally {
    router.destroy();
    container.remove();
  }
}

testNestedRouteLayout()
  .then(() => console.log('Nested route layout tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
