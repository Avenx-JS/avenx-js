import assert from 'assert';
import { setupDOMMock, teardownDOMMock, MockDOMElement } from '../helpers/dom-mock.js';
import { DomPatcher } from '../../lib/core/renderer/domPatch.js';
import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { AvenxPage } from '../../lib/core/runtime/AvenxPage.js';
import { AvenxComponent } from '../../lib/core/runtime/AvenxComponent.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitForRaf = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

(async () => {
  try {
    console.log('🧪 Testing Transition and Animation Hooks...');
    setupDOMMock();

    // 1. Test basic DomPatcher enter and leave class cycles
    const patcher = new DomPatcher();
    const el = new MockDOMElement('div');
    el.style.transitionDuration = '50ms';

    // Enter transition
    patcher.enter(el, 'fade');
    assert.ok(el.classList.contains('fade-enter'), 'Should initially have enter class');
    assert.ok(el.classList.contains('fade-enter-active'), 'Should initially have enter-active class');

    await waitForRaf();
    assert.ok(!el.classList.contains('fade-enter'), 'Should remove enter class after raf');
    assert.ok(el.classList.contains('fade-enter-to'), 'Should add enter-to class after raf');

    await sleep(100); // Wait for transition duration + buffer
    assert.ok(!el.classList.contains('fade-enter-active'), 'Should remove enter-active class after transition ends');
    assert.ok(!el.classList.contains('fade-enter-to'), 'Should remove enter-to class after transition ends');

    // Leave transition
    let leaveRemoved = false;
    patcher.leave(el, 'fade', () => {
      leaveRemoved = true;
    });
    assert.ok(el.classList.contains('fade-leave'), 'Should initially have leave class');
    assert.ok(el.classList.contains('fade-leave-active'), 'Should initially have leave-active class');
    assert.ok(el._isLeaving, 'Should set _isLeaving to true');

    await waitForRaf();
    assert.ok(!el.classList.contains('fade-leave'), 'Should remove leave class after raf');
    assert.ok(el.classList.contains('fade-leave-to'), 'Should add leave-to class after raf');

    await sleep(100); // Wait for transition duration + buffer
    assert.ok(!el.classList.contains('fade-leave-active'), 'Should remove leave-active class after transition ends');
    assert.ok(!el.classList.contains('fade-leave-to'), 'Should remove leave-to class after transition ends');
    assert.ok(!el._isLeaving, 'Should reset _isLeaving to false');
    assert.strictEqual(leaveRemoved, true, 'Remove callback should be called after leave transition ends');

    // 2. Test <transition> tag flattening
    const parentEl = new MockDOMElement('div');
    const transNode = new MockDOMElement('transition');
    transNode.setAttribute('name', 'fade');
    const childNode = new MockDOMElement('div');
    transNode.appendChild(childNode);
    parentEl.appendChild(transNode);

    patcher.flattenTransitionTags(parentEl);
    assert.strictEqual(parentEl.childNodes.length, 1, 'Should flatten transition tag and replace it with its child');
    assert.strictEqual(parentEl.childNodes[0], childNode, 'Child should be moved directly under parent');
    assert.strictEqual(
      childNode.getAttribute('data-ax-transition'),
      'fade',
      'Child should receive data-ax-transition attribute',
    );

    // 3. Test conditional rendering transitions using data-ax-show
    class ShowComponent extends AvenxComponent {
      constructor(bridges) {
        super(
          { isVisible: true },
          {},
          bridges,
          '<div id="target" data-ax-show="isVisible" data-ax-transition="fade">Hello</div>',
        );
      }
    }

    // We mock document querySelector to return a target div
    const appContainer = new MockDOMElement('div');
    appContainer.setAttribute('id', 'app');

    const originalQuerySelector = global.document.querySelector;
    global.document.querySelector = (sel) => {
      if (sel === '#app') return appContainer;
      return originalQuerySelector(sel);
    };

    const app = new AvenxApp({ target: '#app' });
    app.register('ShowComponent', ShowComponent);

    app.mount('ShowComponent', '#app');
    await waitForRaf();

    const targetDiv = appContainer.childNodes[0];
    assert.ok(targetDiv, 'Component should be mounted');
    assert.strictEqual(targetDiv.style.display, '', 'Element should be visible initially');
    assert.ok(targetDiv.axShowInitialized, 'Show initialization flag should be set');

    // Toggle state to false (triggers leave transition)
    const componentInstance = appContainer.__avenx_comp_instance;
    componentInstance.state.isVisible = false;
    await Promise.resolve(); // Wait for update microtask to run patchNode

    // Target should have leave classes active immediately after patch
    assert.ok(targetDiv.classList.contains('fade-leave-active'), 'Should start leave transition');

    // Wait for transition to end (mock duration is 0, so runs after rafs)
    await waitForRaf();
    assert.strictEqual(targetDiv.style.display, 'none', 'Element should be hidden after leave transition finishes');

    // 4. Test page/routing transitions
    class PageA extends AvenxPage {
      constructor(bridges, compReg) {
        super({}, {}, bridges, '<div class="page-a">Page A</div>', {}, compReg);
      }
    }
    class PageB extends AvenxPage {
      constructor(bridges, compReg) {
        super({}, {}, bridges, '<div class="page-b">Page B</div>', {}, compReg);
      }
    }

    app.registerPage('PageA', PageA);
    app.registerPage('PageB', PageB);

    // Mount PageA initially
    app.mountPage('PageA');
    assert.strictEqual(appContainer.childNodes.length, 1);
    assert.ok(appContainer.childNodes[0].classList.contains('page-a'));

    // Mount PageB with fade transition option
    const parentOfApp = new MockDOMElement('div');
    parentOfApp.appendChild(appContainer);

    // Mount PageA again to set state
    app.mountPage('PageA');
    assert.strictEqual(appContainer.childNodes.length, 1);

    // Now trigger transition mounting PageB
    app.mountPage('PageB', {}, { transition: 'fade' });

    // parentOfApp childNodes should contain exitWrapper next to appContainer
    const exitWrapper = parentOfApp.childNodes.find((c) => c.classList && c.classList.contains('ax-page-exit-wrapper'));
    assert.ok(exitWrapper, 'Should insert exitWrapper into parent during route transition');
    assert.ok(exitWrapper.classList.contains('fade-leave-active'), 'Exit wrapper should run leave transition');

    const newPageChild = appContainer.childNodes[0];
    assert.ok(newPageChild.classList.contains('page-b'));
    assert.ok(newPageChild.classList.contains('fade-enter-active'), 'New page elements should run enter transition');

    // Wait for all transitions to fully settle before cleaning up
    await sleep(50);

    // Cleanup globals
    global.document.querySelector = originalQuerySelector;
    teardownDOMMock();
    console.log('  ✅ Transition and Animation Hooks tests passed!');
  } catch (error) {
    console.error('❌ Transition and Animation Hooks tests failed!');
    console.error(error);
    process.exit(1);
  }
})();
