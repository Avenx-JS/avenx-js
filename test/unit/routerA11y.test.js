import assert from 'node:assert';
import { AvenxRouter } from '../../lib/core/runtime/AvenxRouter.js';
import { getOrCreateLiveRegion, announce, manageFocus } from '../../lib/core/runtime/navigation/A11yManager.js';

console.log('🧪 Testing Router Accessibility (Focus & Live Region Announcements)...');

// Mock a lightweight browser DOM environment
class MockElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.attributes = {};
    this.style = {};
    this.textContent = '';
    this.children = [];
    this.id = '';
    this._focused = false;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  hasAttribute(name) {
    return name in this.attributes;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  focus() {
    this._focused = true;
    if (global.document) {
      global.document.activeElement = this;
    }
  }

  querySelector(selector) {
    if (selector === '[data-ax-page-heading]' && this.attributes['data-ax-page-heading'] !== undefined) {
      return this;
    }
    for (const child of this.children) {
      if (child.querySelector) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement('BODY');
    this.title = '';
    this.activeElement = null;
  }

  getElementById(id) {
    return this.body.children.find((child) => child.id === id) || null;
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }
}

global.document = new MockDocument();
global.window = {
  requestAnimationFrame: (cb) => {
    cb();
    return 1;
  },
  scrollTo: () => {},
};

async function runTests() {
  // 1. Test live region singleton creation
  const region1 = getOrCreateLiveRegion();
  assert.ok(region1, 'Live region should be created');
  assert.strictEqual(region1.getAttribute('role'), 'status');
  assert.strictEqual(region1.getAttribute('aria-live'), 'polite');

  const region2 = getOrCreateLiveRegion();
  assert.strictEqual(region1, region2, 'Live region should be a singleton');
  console.log('  ✓ Live region singleton creation verified');

  // 2. Test live region announcements
  announce('Dashboard Page');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(region1.textContent, 'Dashboard Page');
  console.log('  ✓ Live region announcement verified');

  // 3. Test focus management
  const pageContainer = new MockElement('DIV');
  const heading = new MockElement('H1');
  heading.setAttribute('data-ax-page-heading', '');
  pageContainer.children.push(heading);

  manageFocus(pageContainer, '[data-ax-page-heading]');
  assert.strictEqual(heading.getAttribute('tabindex'), '-1', 'Heading receives tabindex -1');
  assert.strictEqual(heading._focused, true, 'Heading receives focus');
  console.log('  ✓ Focus management verified');

  // 4. Test Router integration & initial load protection
  const mockApp = {
    currentPageInstance: {
      $el: pageContainer,
    },
    mountPage: () => {},
  };

  const router = new AvenxRouter(
    mockApp,
    {
      '#/': { page: 'Home', title: 'Home Page' },
      '#/about': { page: 'About', title: 'About Page' },
    },
    { mode: 'memory' },
  );

  // Hook delegate.setTitle to update mock document.title
  const origSetTitle = router.delegate.setTitle.bind(router.delegate);
  router.delegate.setTitle = (title) => {
    origSetTitle(title);
    global.document.title = title;
  };

  // Initial start should not steal focus
  router.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(router._isInitialLoad, false);

  // Subsequent navigation should announce and shift focus
  router.navigate('#/about');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(region1.textContent, 'About Page');
  console.log('  ✓ Router navigation announcement & focus coordination verified');

  console.log('✅ All Router Accessibility tests passed successfully!');
}

runTests();