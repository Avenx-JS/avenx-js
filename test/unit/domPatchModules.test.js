import assert from 'assert';
import { setupDOMMock, teardownDOMMock, MockDOMElement } from '../helpers/dom-mock.js';
import {
  classTokensEqual,
  cleanBooleanAttributes,
  cleanBooleanAttributesForNode,
  cleanElement,
  patchAttributes,
  mergeAdjacentTextNodes,
  prepareNode,
  sanitizeUrlsIn,
} from '../../lib/core/renderer/patch/attributes.js';
import {
  triggerUnmounted,
  triggerUnmountedForElement,
  flushLifecycleHooks,
} from '../../lib/core/renderer/patch/unmount.js';
import {
  enter,
  getTransitionName,
  triggerEnter,
  triggerLeave,
  flattenTransitionTags,
  isNodeInPatchTree,
} from '../../lib/core/renderer/patch/transitionControl.js';
import {
  applyDirectivesOnElement,
  applyDirectivesInternal,
  applyDirectives,
  getSlotScope,
} from '../../lib/core/renderer/patch/directives.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForRaf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function testAttributesModule() {
  console.log('🧪 Testing patch/attributes.js independently...');

  // 1. classTokensEqual
  assert.strictEqual(classTokensEqual('btn primary', 'primary btn'), true, 'Token order should not matter');
  assert.strictEqual(classTokensEqual('btn   primary', 'btn primary'), true, 'Extra whitespace should not matter');
  assert.strictEqual(classTokensEqual('btn btn primary', 'primary btn'), true, 'Duplicate tokens normalize');
  assert.strictEqual(classTokensEqual('btn primary', 'btn secondary'), false, 'Different classes must not match');
  assert.strictEqual(classTokensEqual(null, ''), true, 'null and empty normalize to empty token sets');

  // 2. cleanBooleanAttributes
  const btn = new MockDOMElement('button');
  btn.setAttribute('disabled', 'false');
  btn.setAttribute('required', 'true');
  cleanBooleanAttributesForNode(btn);
  assert.strictEqual(btn.hasAttribute('disabled'), false, 'disabled="false" must be removed');
  assert.strictEqual(btn.disabled, false, 'disabled property must be false');
  assert.strictEqual(btn.hasAttribute('required'), true, 'required="true" must be kept');
  assert.strictEqual(btn.required, true, 'required property must be true');

  const container = new MockDOMElement('div');
  const subBtn = new MockDOMElement('button');
  subBtn.setAttribute('disabled', 'false');
  container.appendChild(subBtn);
  cleanBooleanAttributes(container);
  assert.strictEqual(subBtn.hasAttribute('disabled'), false, 'Subtree cleanBooleanAttributes works');

  // 3. cleanElement with transition flattening callback
  const root = new MockDOMElement('div');
  const childBtn = new MockDOMElement('button');
  childBtn.setAttribute('readonly', 'false');
  root.appendChild(childBtn);
  let flattened = false;
  cleanElement(root, () => {
    flattened = true;
  });
  assert.strictEqual(flattened, true, 'cleanElement should invoke transition flattening callback');
  assert.strictEqual(childBtn.hasAttribute('readonly'), false, 'Subtree boolean attributes cleaned');

  // 4. sanitizeUrlsIn
  const linkContainer = new MockDOMElement('div');
  const anchor = new MockDOMElement('a');
  anchor.setAttribute('href', 'javascript:alert(1)');
  linkContainer.appendChild(anchor);
  sanitizeUrlsIn(linkContainer);
  assert.strictEqual(anchor.getAttribute('href'), 'about:blank', 'javascript: href must be sanitized');

  // 5. mergeAdjacentTextNodes
  const p = new MockDOMElement('p');
  const t1 = { nodeType: 3, textContent: 'Hello ' };
  const t2 = { nodeType: 3, textContent: 'World' };
  p.appendChild(t1);
  p.appendChild(t2);
  const merged = mergeAdjacentTextNodes([t1, t2]);
  assert.strictEqual(merged.length, 1, 'Adjacent text nodes merged');
  assert.strictEqual(merged[0].textContent, 'Hello World', 'Merged text content matches');

  // 6. patchAttributes
  const oldEl = new MockDOMElement('div');
  oldEl.setAttribute('id', 'item');
  oldEl.setAttribute('title', 'old title');
  const newEl = new MockDOMElement('div');
  newEl.setAttribute('id', 'item');
  newEl.setAttribute('title', 'new title');
  patchAttributes(oldEl, newEl);
  assert.strictEqual(oldEl.getAttribute('title'), 'new title', 'Updated attribute applied');

  // 7. prepareNode
  const svgWrapper = prepareNode(new MockDOMElement('svg'), false);
  assert.strictEqual(svgWrapper.tagName.toLowerCase(), 'svg', 'SVG element prepared');

  console.log('  ✅ patch/attributes.js tests passed!');
}

function testUnmountModule() {
  console.log('🧪 Testing patch/unmount.js independently...');

  const el = new MockDOMElement('div');
  let unmountedCalled = false;
  el.__avenx_directives = new Map([
    [
      'focus',
      {
        name: 'focus',
        value: true,
        mountedCalled: true,
      },
    ],
  ]);

  const mockApp = {
    directives: new Map([
      [
        'focus',
        {
          unmounted: () => {
            unmountedCalled = true;
          },
        },
      ],
    ]),
  };

  triggerUnmountedForElement(el, mockApp);
  assert.strictEqual(unmountedCalled, true, 'unmounted hook called for mounted directive');
  assert.strictEqual(el.__avenx_directives.get('focus').mountedCalled, false, 'mountedCalled reset to false');

  // triggerUnmounted on subtree
  const parent = new MockDOMElement('div');
  const child = new MockDOMElement('span');
  let childUnmounted = false;
  child.__avenx_directives = new Map([['tooltip', { name: 'tooltip', value: 'help', mountedCalled: true }]]);
  parent.appendChild(child);
  const app2 = {
    directives: new Map([
      [
        'tooltip',
        {
          unmounted: () => {
            childUnmounted = true;
          },
        },
      ],
    ]),
  };
  triggerUnmounted(parent, app2);
  assert.strictEqual(childUnmounted, true, 'Subtree unmount triggers child directive hooks');

  // flushLifecycleHooks
  const session = new Set();
  const target = new MockDOMElement('div');
  let mounted = false;
  let updated = false;
  target.__avenx_directives = new Map([
    ['bind', { name: 'bind', value: 1, mountedCalled: false, valueChanged: false }],
  ]);
  session.add(target);
  const app3 = {
    directives: new Map([
      [
        'bind',
        {
          mounted: () => {
            mounted = true;
          },
          updated: () => {
            updated = true;
          },
        },
      ],
    ]),
  };
  flushLifecycleHooks(session, () => true, app3);
  assert.strictEqual(mounted, true, 'flushLifecycleHooks triggers mounted');

  target.__avenx_directives.get('bind').valueChanged = true;
  flushLifecycleHooks(session, () => true, app3);
  assert.strictEqual(updated, true, 'flushLifecycleHooks triggers updated when value changed');

  console.log('  ✅ patch/unmount.js tests passed!');
}

async function testTransitionControlModule() {
  console.log('🧪 Testing patch/transitionControl.js independently...');

  const el = new MockDOMElement('div');
  el.setAttribute('data-ax-transition', 'fade');
  assert.strictEqual(getTransitionName(el), 'fade', 'Direct transition name matches');

  const dynEl = new MockDOMElement('div');
  dynEl.setAttribute('data-ax-transition', 'customName');
  assert.strictEqual(
    getTransitionName(dynEl, (expr) => (expr === 'customName' ? 'slide' : expr)),
    'slide',
    'Expression-resolved transition name matches',
  );

  // Direct enter call
  enter(el, 'fade');
  assert.strictEqual(el.classList.contains('fade-enter'), true, 'enter class applied');
  await waitForRaf();
  await sleep(60);

  // flattenTransitionTags
  const root = new MockDOMElement('div');
  const transTag = new MockDOMElement('transition');
  transTag.setAttribute('name', 'bounce');
  const inner = new MockDOMElement('span');
  transTag.appendChild(inner);
  root.appendChild(transTag);

  flattenTransitionTags(root);
  assert.strictEqual(root.childNodes.length, 1, 'transition tag unwrapped');
  assert.strictEqual(inner.getAttribute('data-ax-transition'), 'bounce', 'Transition attribute transferred to child');

  // isNodeInPatchTree
  const patchRoot = new MockDOMElement('section');
  const leaf = new MockDOMElement('span');
  patchRoot.appendChild(leaf);
  assert.strictEqual(isNodeInPatchTree(leaf, patchRoot), true, 'Connected child recognized in patch tree');

  const detached = new MockDOMElement('div');
  assert.strictEqual(isNodeInPatchTree(detached, patchRoot), false, 'Detached node rejected from patch tree');

  // triggerEnter & triggerLeave
  let enterCalled = false;
  triggerEnter(el, null, () => {
    enterCalled = true;
  });
  assert.strictEqual(enterCalled, true, 'triggerEnter executes enter transition');

  let leaveCalled = false;
  let unmountCalled = false;
  triggerLeave(
    el,
    null,
    () => {
      leaveCalled = true;
    },
    {},
    () => {
      unmountCalled = true;
    },
    (element, name, done) => {
      done();
    },
  );
  assert.strictEqual(leaveCalled, true, 'triggerLeave executes remove callback');
  assert.strictEqual(unmountCalled, true, 'triggerLeave triggers unmount hook');

  console.log('  ✅ patch/transitionControl.js tests passed!');
}

function testDirectivesModule() {
  console.log('🧪 Testing patch/directives.js independently...');

  // 1. getSlotScope
  const el = new MockDOMElement('div');
  assert.strictEqual(getSlotScope(el), null, 'Element without slot scope returns null');

  // 2. data-ax-html
  const htmlEl = new MockDOMElement('div');
  htmlEl.setAttribute('data-ax-html', 'markup');
  const skip = applyDirectivesOnElement(htmlEl, () => '<b>bold</b>', {});
  assert.strictEqual(skip, true, 'data-ax-html signals skipChildren');
  assert.strictEqual(htmlEl.innerHTML, '<b>bold</b>', 'HTML content inserted');

  // 3. data-ax-show
  const showEl = new MockDOMElement('div');
  showEl.setAttribute('data-ax-show', 'isVisible');
  applyDirectivesOnElement(showEl, (expr) => (expr === 'isVisible' ? false : true), {});
  assert.strictEqual(showEl.style.display, 'none', 'data-ax-show hides element when falsy');

  applyDirectivesOnElement(showEl, (expr) => (expr === 'isVisible' ? true : false), {});
  assert.strictEqual(showEl.style.display, '', 'data-ax-show reveals element when truthy');

  // 4. data-ax-class
  const classEl = new MockDOMElement('div');
  classEl.setAttribute('data-ax-class', 'classMap');
  applyDirectivesOnElement(classEl, () => ({ active: true, disabled: false, highlighted: true }), {});
  assert.strictEqual(classEl.classList.contains('active'), true, 'active class added');
  assert.strictEqual(classEl.classList.contains('disabled'), false, 'disabled class omitted');
  assert.strictEqual(classEl.classList.contains('highlighted'), true, 'highlighted class added');

  // 5. Dynamic attribute name binding :[attrName]="val"
  const dynAttrEl = new MockDOMElement('div');
  dynAttrEl.setAttribute(':[attrExpr]', 'hello');
  applyDirectivesOnElement(dynAttrEl, (expr) => (expr === 'attrExpr' ? 'data-custom' : expr), {});
  assert.strictEqual(dynAttrEl.getAttribute('data-custom'), 'hello', 'Dynamic attribute name resolved and set');

  // 6. Custom directive
  const customEl = new MockDOMElement('button');
  customEl.setAttribute('data-ax-focus.lazy', 'true');
  const session = new Set();
  const mockApp = {
    directives: new Map([['focus', {}]]),
  };
  applyDirectivesOnElement(customEl, () => true, mockApp, { sessionElements: session });
  assert.strictEqual(session.has(customEl), true, 'Element with custom directive tracked in session');
  assert.strictEqual(customEl.__avenx_directives.has('focus.lazy'), true, 'Custom directive registered in element map');
  assert.strictEqual(customEl.__avenx_directives.get('focus.lazy').modifiers.lazy, true, 'Modifier parsed correctly');

  // 7. Full tree applyDirectives with lifecycle flushing
  const root = new MockDOMElement('div');
  const child = new MockDOMElement('p');
  child.setAttribute('data-ax-custom', '1');
  root.appendChild(child);
  applyDirectivesInternal(root, () => 1, mockApp);

  let customMounted = false;
  const appWithDirective = {
    directives: new Map([
      [
        'custom',
        {
          mounted: () => {
            customMounted = true;
          },
        },
      ],
    ]),
  };
  applyDirectives(root, () => 1, appWithDirective);
  assert.strictEqual(customMounted, true, 'applyDirectives flushed mounted lifecycle on tree');

  console.log('  ✅ patch/directives.js tests passed!');
}

(async () => {
  setupDOMMock();
  try {
    testAttributesModule();
    testUnmountModule();
    await testTransitionControlModule();
    testDirectivesModule();
    console.log('\n🎉 All 4 extracted patch collaborator modules passed independent unit testing!');
  } finally {
    teardownDOMMock();
  }
})();
