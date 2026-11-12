import assert from 'node:assert/strict';

import '../../lib/core/renderer/installStringRenderer.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { setupDOMMock, teardownDOMMock } from '../helpers/dom-mock.js';

let hashListeners = [];

function setupWindowMock(hash = '') {
  hashListeners = [];
  global.window = {
    addEventListener(event, callback) {
      if (event === 'hashchange') hashListeners.push(callback);
    },
    removeEventListener(event, callback) {
      if (event === 'hashchange') hashListeners = hashListeners.filter((listener) => listener !== callback);
    },
    location: {
      _hash: hash,
      get hash() {
        return this._hash;
      },
      set hash(value) {
        this._hash = value;
        hashListeners.forEach((listener) => listener());
      },
    },
  };
}

class AdminLayout extends AvenxPage {
  static instances = 0;
  static lastInstance = null;

  constructor(...args) {
    super(...args);
    AdminLayout.instances++;
    AdminLayout.lastInstance = this;
  }

  render() {
    return '<div data-layout><main><slot></slot></main></div>';
  }
}

class DashboardPage extends AvenxPage {
  render() {
    return '<section data-page="dashboard">Dashboard</section>';
  }
}

class UsersPage extends AvenxPage {
  render() {
    return '<section data-page="users">Users</section>';
  }
}

class HomePage extends AvenxPage {
  render() {
    return '<section data-page="home">Home</section>';
  }
}

async function waitForNavigation() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function testNestedRouteLayoutRendersAndPersistsAcrossSiblingRoutes() {
  setupDOMMock();
  setupWindowMock('#/admin/dashboard');
  AdminLayout.instances = 0;
  AdminLayout.lastInstance = null;

  const app = new AvenxApp({ target: 'div' });
  app.registerPage('Dashboard', DashboardPage);
  app.registerPage('Users', UsersPage);
  app.registerPage('Home', HomePage);
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
    await waitForNavigation();
    const layoutElement = app.target.querySelector('[data-layout]');
    assert.ok(layoutElement, 'the configured parent layout should be rendered');
    assert.strictEqual(app.target.querySelector('[data-page]').getAttribute('data-page'), 'dashboard');

    const layoutInstance = AdminLayout.lastInstance;
    layoutInstance.state.activeTab = 'dashboard';
    window.location.hash = '#/admin/users';
    await waitForNavigation();

    assert.strictEqual(app.target.querySelector('[data-layout]'), layoutElement, 'sibling navigation should keep the layout DOM mounted');
    assert.strictEqual(AdminLayout.instances, 1, 'sibling navigation should not create another layout instance');
    assert.strictEqual(layoutInstance.state.activeTab, 'dashboard', 'sibling navigation should retain layout state');
    assert.strictEqual(app.target.querySelector('[data-page]').getAttribute('data-page'), 'users');

    window.location.hash = '#/';
    await waitForNavigation();
    assert.strictEqual(app.target.querySelector('[data-layout]'), null, 'leaving the parent route should unmount its layout');
  } finally {
    router.destroy();
    delete global.window;
    teardownDOMMock();
  }
}

testNestedRouteLayoutRendersAndPersistsAcrossSiblingRoutes()
  .then(() => console.log('Nested route layout test passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
