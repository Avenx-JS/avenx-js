import fs from 'fs';
import path from 'path';
import { test, expect } from '../../support/fixtures.js';
import { APPS_DIR } from '../../support/apps.js';

/**
 * Every documented template construct, from both bundles, compared one by one.
 *
 * The unit and integration tiers install the expression interpreter and the
 * string renderer unconditionally (see test/run-tests.js), which is what a
 * development build does and what no production bundle does. A defect that
 * exists only in the shipped arrangement is invisible there. This spec is
 * where that arrangement is exercised: the `parity` fixture is built with
 * `avenx build` and `avenx build --dev`, and each construct below is driven
 * through the same steps against each bundle.
 *
 * Three things are checked per construct:
 *
 * 1. **Content.** The steps assert particular rendered text, attributes and
 *    styles on both bundles. Agreement alone would pass two bundles that both
 *    render nothing.
 * 2. **Parity.** After the steps, the construct's section is serialised --
 *    markup, live form state, computed display and colour -- and the
 *    production snapshot must equal the development one. There is no
 *    allowlist: a divergence is a red test.
 * 3. **Nothing was interpreted.** The fixture builds with no AVX_W48 (the
 *    global setup refuses to continue otherwise), so the development bundle's
 *    interpreter should never run. A source that reaches it was not compiled
 *    and not reported: it works under `--dev` and throws AVX_R32 in
 *    production. That is how `<Component :is>` and `<transition name>` failed,
 *    and neither raised an error a test could see.
 *
 * Adding a construct: give it a `data-construct` section in the fixture and an
 * entry in CONSTRUCTS. The coverage test at the bottom fails if the two lists
 * disagree.
 */
const BUILDS = [
  { label: 'production', entry: 'index.html' },
  { label: 'development', entry: 'index.dev.html' },
];

/**
 * Serialises a construct's section into lines that can be compared.
 *
 * Attributes are sorted, whitespace in text is collapsed, and the state the
 * markup does not carry -- an input's live value, a checkbox's `checked`, an
 * option's `selected`, computed `display` and `color` -- is read from the
 * element, because that is where two-way binding and `data-ax-show` diverge
 * when they diverge.
 * @param {Element} root - The `[data-construct]` element.
 * @returns {string[]} One line per element and text node.
 */
function serialise(root) {
  const lines = [];
  const visit = (node, depth) => {
    const indent = '  '.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text) lines.push(`${indent}${JSON.stringify(text)}`);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = /** @type {HTMLElement} */ (node);
    const parts = [...el.attributes].map((attr) => `${attr.name}=${JSON.stringify(attr.value)}`).sort();
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      parts.push(`.value=${JSON.stringify(el.value)}`);
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
      parts.push(`.checked=${el.checked}`);
    }
    if (tag === 'option') parts.push(`.selected=${el.selected}`);
    if (tag === 'details') parts.push(`.open=${el.open}`);
    if ('disabled' in el) parts.push(`.disabled=${el.disabled}`);
    const style = getComputedStyle(el);
    parts.push(`display:${style.display}`, `color:${style.color}`);

    lines.push(`${indent}<${tag} ${parts.join(' ')}>`);
    for (const child of el.childNodes) visit(child, depth + 1);
  };
  visit(root, 0);
  return lines;
}

/**
 * The texts of every element with a test id inside a section, in order.
 * @param {import('@playwright/test').Locator} section - The construct section.
 * @param {string} testId - The test id to collect.
 * @returns {import('@playwright/test').Locator} The matching elements.
 */
const rows = (section, testId = 'row') => section.getByTestId(testId);

/**
 * Starts recording every class any element in a section carries, including
 * elements inserted later.
 *
 * Each record's old value is read as well as the class list, because a
 * transition can add and remove a class before the observer is called, and
 * reading only the current list would miss it.
 * @param {import('@playwright/test').Locator} section - The construct section.
 * @returns {Promise<void>}
 */
async function recordClasses(section) {
  await section.evaluate((root) => {
    const seen = new Set();
    const take = (value) => {
      for (const token of (value || '').split(/\s+/)) if (token) seen.add(token);
    };
    window.__parityClasses = seen;
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes') {
          take(record.oldValue);
          take(record.target.getAttribute('class'));
        }
        for (const node of record.addedNodes || []) {
          if (node.nodeType === Node.ELEMENT_NODE) take(node.getAttribute('class'));
        }
      }
    }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  });
}

/**
 * The classes recorded since `recordClasses` was called.
 * @param {import('@playwright/test').Page} page - The page.
 * @returns {Promise<string[]>} Every class token seen.
 */
const recordedClasses = (page) => page.evaluate(() => [...(window.__parityClasses || [])]);

/**
 * Each construct: the route it lives on, and the steps that assert on it.
 *
 * `knownGap` pins a construct that does not work today, in either build, under
 * `test.fail()`. The README's rule applies: a pinned gap turns the run red the
 * moment it starts passing, which is how a fix gets noticed.
 * @type {Object<string, {hash: string, knownGap?: string, steps: function({page: import('@playwright/test').Page, section: import('@playwright/test').Locator}): Promise<void>}>}
 */
const CONSTRUCTS = {
  // ---- Text and attributes (#/, compiled to a render program) -------------
  interpolation: {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('value')).toHaveText('Hello Ada');
      await expect(section.getByTestId('expression')).toHaveText('6 / first');
      // Escaped: the markup arrives as text, not as an element.
      await expect(section.getByTestId('escaped')).toHaveText('<em>raw</em>');
      await expect(section.getByTestId('escaped').locator('em')).toHaveCount(0);
      await page.getByTestId('change').click();
      await expect(section.getByTestId('value')).toHaveText('Hello Grace');
      await expect(section.getByTestId('expression')).toHaveText('10 / second');
      await expect(section.getByTestId('escaped')).toHaveText('<strong>raw again</strong>');
    },
  },
  'raw-interpolation': {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('raw').locator('em')).toHaveText('raw');
      await page.getByTestId('change').click();
      await expect(section.getByTestId('raw').locator('strong')).toHaveText('raw again');
      await expect(section.getByTestId('raw').locator('em')).toHaveCount(0);
    },
  },
  'boolean-attributes': {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('locked')).toBeDisabled();
      await expect(section.getByTestId('details')).not.toHaveAttribute('open');
      await expect(section.getByTestId('readonly')).not.toBeEditable();
      await page.getByTestId('change').click();
      await expect(section.getByTestId('locked')).toBeEnabled();
      await expect(section.getByTestId('details')).toHaveAttribute('open');
      await expect(section.getByTestId('readonly')).toBeEditable();
    },
  },
  show: {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('shown')).toBeHidden();
      await expect(section.getByTestId('flex')).toHaveCSS('display', 'flex');
      await page.getByTestId('change').click();
      await expect(section.getByTestId('shown')).toBeVisible();
      await expect(section.getByTestId('flex')).toBeHidden();
    },
  },
  class: {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('class-string')).toHaveClass('base theme-a');
      await expect(section.getByTestId('class-object')).toHaveClass('base idle');
      await page.getByTestId('change').click();
      await expect(section.getByTestId('class-string')).toHaveClass('base theme-b');
      await expect(section.getByTestId('class-object')).toHaveClass('base active');
    },
  },
  style: {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('styled')).toHaveCSS('color', 'rgb(255, 0, 0)');
      await expect(section.getByTestId('styled')).toHaveCSS('font-weight', '400');
      await page.getByTestId('change').click();
      await expect(section.getByTestId('styled')).toHaveCSS('color', 'rgb(0, 0, 255)');
      await expect(section.getByTestId('styled')).toHaveCSS('font-weight', '700');
    },
  },
  html: {
    hash: '',
    async steps({ page, section }) {
      await expect(section.getByTestId('html').locator('b')).toHaveText('bold');
      await expect(section.getByTestId('html').locator('script')).toHaveCount(0);
      expect(await page.evaluate(() => window.__parityXss)).toBeUndefined();
      await page.getByTestId('change').click();
      await expect(section.getByTestId('html').locator('i')).toHaveText('italic');
    },
  },
  svg: {
    hash: '',
    async steps({ page, section }) {
      const circle = section.getByTestId('circle');
      // An SVG element created in the HTML namespace is inert: it has no
      // geometry and draws nothing, while the markup looks right.
      expect(await circle.evaluate((el) => el.namespaceURI)).toBe('http://www.w3.org/2000/svg');
      await expect(circle).toHaveAttribute('r', '10');
      await page.getByTestId('change').click();
      await expect(circle).toHaveAttribute('r', '30');
      expect(await circle.evaluate((el) => el.r.baseVal.value)).toBe(30);
    },
  },

  // ---- Control flow (#/control) --------------------------------------------
  'if-chain': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(section.getByTestId('branch')).toHaveText('none');
      await page.getByTestId('inc').click();
      await expect(section.getByTestId('branch')).toHaveText('one');
      await page.getByTestId('inc').click();
      await expect(section.getByTestId('branch')).toHaveText('many 2');
      await expect(section.getByTestId('after-if')).toHaveText('after the chain');
    },
  },
  'for-array': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(rows(section)).toHaveText(['0:one', '1:two']);
      await page.getByTestId('reorder').click();
      await expect(rows(section)).toHaveText(['0:two', '1:three', '2:one']);
      await page.getByTestId('empty').click();
      await expect(rows(section)).toHaveCount(0);
      await expect(rows(section, 'row-empty')).toHaveText('no items');
    },
  },
  'for-object': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(rows(section)).toHaveText(['theme=dark', 'size=large']);
      await page.getByTestId('reorder').click();
      await expect(rows(section)).toHaveText(['theme=light', 'size=large', 'density=compact']);
      await page.getByTestId('empty').click();
      await expect(rows(section, 'row-empty')).toHaveText('no settings');
    },
  },
  'for-map': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(rows(section)).toHaveText(['alpha=1', 'beta=2']);
      await page.getByTestId('reorder').click();
      await expect(rows(section)).toHaveText(['beta=20', 'gamma=3']);
      await page.getByTestId('empty').click();
      await expect(rows(section, 'row-empty')).toHaveText('no pairs');
    },
  },
  'for-set': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(rows(section)).toHaveText(['red', 'green']);
      await page.getByTestId('reorder').click();
      await expect(rows(section)).toHaveText(['green', 'blue', 'red']);
      await page.getByTestId('empty').click();
      await expect(rows(section, 'row-empty')).toHaveText('no tags');
    },
  },
  'for-range': {
    hash: '#/control',
    async steps({ page, section }) {
      await expect(rows(section)).toHaveText(['#0', '#1', '#2']);
      await page.getByTestId('reorder').click();
      await expect(rows(section)).toHaveText(['#0', '#1', '#2', '#3', '#4']);
      await page.getByTestId('empty').click();
      await expect(rows(section, 'row-empty')).toHaveText('no range');
    },
  },

  // ---- Forms (#/forms) -----------------------------------------------------
  bind: {
    hash: '#/forms',
    async steps({ section }) {
      const bound = section.getByTestId('bound');
      const initial = {
        text: 'Ada', bio: 'hello', age: 7, volume: 50, when: '2026-11-20', city: 'lisbon',
        cities: ['oslo'], agreed: false, fruits: ['apple'], plan: 'free',
      };
      await expect(bound).toHaveText(JSON.stringify(initial));
      await expect(section.getByTestId('text')).toHaveValue('Ada');
      await expect(section.getByTestId('bio')).toHaveValue('hello');
      await expect(section.getByTestId('city')).toHaveValue('lisbon');
      await expect(section.getByTestId('fruit-apple')).toBeChecked();
      await expect(section.getByTestId('plan-free')).toBeChecked();

      await section.getByTestId('text').fill('Grace');
      await section.getByTestId('bio').fill('typed');
      await section.getByTestId('age').fill('42');
      await section.getByTestId('volume').fill('80');
      await section.getByTestId('when').fill('2027-01-02');
      await section.getByTestId('city').selectOption('berlin');
      await section.getByTestId('cities').selectOption(['berlin', 'oslo']);
      await section.getByTestId('agreed').check();
      await section.getByTestId('fruit-pear').check();
      await section.getByTestId('plan-pro').check();

      // Numbers stay numbers, the multiple select and the checkbox group are
      // arrays, and the date input writes its string.
      await expect(bound).toHaveText(JSON.stringify({
        text: 'Grace', bio: 'typed', age: 42, volume: 80, when: '2027-01-02', city: 'berlin',
        cities: ['berlin', 'oslo'], agreed: true, fruits: ['apple', 'pear'], plan: 'pro',
      }));
    },
  },

  // ---- Components (#/components) -------------------------------------------
  'nesting-and-props': {
    hash: '#/components',
    async steps({ page, section }) {
      await expect(section.getByTestId('frame-title')).toHaveText('Quarterly');
      // A grandchild: <BadgeLabel> inside <FrameCard> inside the page.
      await expect(section.getByTestId('badge-label')).toHaveText('badge: Quarterly');
      await page.getByTestId('rename').click();
      await expect(section.getByTestId('frame-title')).toHaveText('Annual');
      await expect(section.getByTestId('badge-label')).toHaveText('badge: Annual');
    },
  },
  'underscored-component': {
    hash: '#/components',
    async steps({ page, section }) {
      await expect(section.getByTestId('frame-title')).toHaveText('Quarterly');
      await expect(section.getByTestId('underscored-slot')).toHaveText('inside');
      await page.getByTestId('rename').click();
      await expect(section.getByTestId('frame-title')).toHaveText('Annual');
    },
  },
  slots: {
    hash: '#/components',
    async steps({ page, section }) {
      await expect(section.getByTestId('projected-body')).toHaveText('projected into the default slot');
      await expect(section.getByTestId('projected-footer')).toHaveText('projected into the footer');
      await expect(section.getByTestId('frame-footer').first()).not.toContainText('footer fallback');
      // The <template slot="footer"> wrapper is unwrapped: both of its
      // elements are in the second card's footer, and its body falls back.
      const wrapped = section.getByTestId('frame-card').nth(1);
      await expect(wrapped.getByTestId('frame-title')).toHaveText('wrapped');
      await expect(wrapped.getByTestId('frame-footer').getByTestId('wrapped-first')).toHaveText('first wrapped');
      await expect(wrapped.getByTestId('frame-footer').getByTestId('wrapped-second')).toHaveText('second wrapped');
      await expect(wrapped.getByTestId('frame-body')).toHaveText('default fallback');
      // The fallback content of both slots, from the card with nothing projected.
      const bare = page.locator('[data-construct="nesting-and-props"]');
      await expect(bare.getByTestId('frame-body')).toHaveText('default fallback');
      await expect(bare.getByTestId('frame-footer')).toHaveText('footer fallback');
    },
  },
  'router-view': {
    hash: '#/shell/outlet',
    async steps({ page, section }) {
      await expect(page.getByTestId('shell-heading')).toHaveText('Shell layout');
      await expect(page.getByTestId('shell-outlet').locator('[data-construct="router-view"]')).toHaveCount(1);
      await expect(section.getByTestId('outlet-content')).toHaveText('routed into the outlet');
    },
  },

  // ---- Deferred and async (#/async) ----------------------------------------
  'defer-idle': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('content')).toHaveText('loaded when idle');
      await expect(section.getByTestId('placeholder')).toHaveCount(0);
    },
  },
  'defer-timer': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('content')).toHaveText('loaded after the timer');
      await expect(section.getByTestId('placeholder')).toHaveCount(0);
    },
  },
  'defer-interaction': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('placeholder')).toHaveText('interaction placeholder');
      await expect(section.getByTestId('content')).toHaveCount(0);
      // Dispatched rather than clicked: a real click moves the pointer first,
      // and `mouseenter` is an interaction trigger too, so the placeholder is
      // gone before the click lands.
      await section.getByTestId('placeholder').dispatchEvent('click');
      await expect(section.getByTestId('content')).toHaveText('loaded on interaction');
    },
  },
  'defer-expression': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('placeholder')).toHaveText('expression placeholder');
      await section.getByTestId('make-ready').click();
      await expect(section.getByTestId('content')).toHaveText('loaded when ready');
    },
  },
  'defer-visible': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('placeholder')).toHaveText('visible placeholder');
      await section.scrollIntoViewIfNeeded();
      await expect(section.getByTestId('content')).toHaveText('loaded once visible');
    },
  },
  resource: {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('status')).toHaveText('resolved');
    },
  },
  suspense: {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('resolved')).toHaveText('parity-quote');
      await expect(section.getByTestId('pending')).toHaveCount(0);
    },
  },
  'error-boundary': {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('caught')).toHaveText('caught parity failure');
      await expect(section.getByTestId('unreached')).toHaveCount(0);
    },
  },
  deadlock: {
    hash: '#/async',
    async steps({ section }) {
      await expect(section.getByTestId('inside')).toHaveText('inside boundary');
      await expect(section.getByTestId('tripped')).toHaveCount(0);
    },
  },

  // ---- Motion (#/motion) ---------------------------------------------------
  transition: {
    hash: '#/motion',
    async steps({ page, section }) {
      // The class prefix is the evaluated transition name. Uncompiled, a
      // production bundle used the raw expression text and produced
      // `'fade'-enter-active`, quotes included, which no stylesheet matches.
      await recordClasses(section);
      await section.getByTestId('add-item').click();
      await expect(rows(section)).toHaveText(['first', 'added']);
      await expect.poll(() => recordedClasses(page)).toEqual(
        expect.arrayContaining(['fade-enter', 'fade-enter-active', 'fade-enter-to']),
      );
      expect((await recordedClasses(page)).filter((token) => !token.startsWith('fade-'))).toEqual([]);
      // At rest before the snapshot: the enter classes are removed again.
      await expect(rows(section).nth(1)).toHaveAttribute('class', '');
    },
  },
  'transition-on-show': {
    hash: '#/motion',
    knownGap:
      'A <transition> around a data-ax-show element applies no transition classes: toggling the binding changes ' +
      'display immediately, in either build. templates.md and transitions.md both document the pairing. Nothing ' +
      'else drives it; specs/transitions/ covers list rows only.',
    async steps({ page, section }) {
      await recordClasses(section);
      await section.getByTestId('toggle').click();
      await expect(section.getByTestId('panel')).toBeVisible();
      await expect
        .poll(() => recordedClasses(page), { timeout: 1_000 })
        .toEqual(expect.arrayContaining(['fade-enter-active']));
    },
  },
  'virtual-list': {
    hash: '#/motion',
    async steps({ section }) {
      await expect(rows(section, 'virtual-row').first()).toHaveText('row 0');
      const rendered = await rows(section, 'virtual-row').count();
      expect(rendered).toBeGreaterThan(0);
      expect(rendered).toBeLessThan(50);
      await section.locator('.virtual-list-viewport').evaluate((viewport) => {
        viewport.scrollTop = 4000;
        viewport.dispatchEvent(new Event('scroll'));
      });
      await expect(section.getByText('row 100', { exact: true })).toBeVisible();
      await expect(section.getByText('row 0', { exact: true })).toHaveCount(0);
    },
  },

  // ---- Constructs only the string renderer has (#/string-path) -----------
  'dynamic-attribute-names': {
    hash: '#/string-path',
    async steps({ section }) {
      // The first render only; an update is the pinned gap below.
      await expect(section.getByTestId('dynamic-attr')).toHaveAttribute('data-tone', 'warm');
    },
  },
  ref: {
    hash: '#/string-path',
    async steps({ section }) {
      await expect(section.getByTestId('ref-report')).toHaveText('unread');
      await section.getByTestId('read-ref').click();
      await expect(section.getByTestId('ref-report')).toHaveText('marked/span');
    },
  },
  validate: {
    hash: '#/string-path',
    async steps({ section }) {
      await expect(section.getByTestId('form-valid')).toHaveText('invalid');
      await section.getByTestId('username').fill('ab');
      await expect(section.getByTestId('username-error')).not.toHaveText('no error');
      await expect(section.getByTestId('form-valid')).toHaveText('invalid');
      await section.getByTestId('username').fill('abcd');
      await expect(section.getByTestId('username-error')).toHaveText('no error');
      await expect(section.getByTestId('form-valid')).toHaveText('valid');
    },
  },
  'scoped-slot': {
    hash: '#/string-path',
    async steps({ section }) {
      await expect(section.getByTestId('scoped-row')).toHaveText('first x2');
      await expect(section.getByTestId('scoped-fallback')).toHaveText('no template for first');
      await section.getByTestId('scoped-bump').first().click();
      await expect(section.getByTestId('scoped-row')).toHaveText('second x3');
    },
  },
  'dynamic-component': {
    hash: '#/string-path',
    async steps({ page, section }) {
      await expect(section.getByTestId('profile-card')).toHaveText('Profile for Ada');
      await page.getByTestId('show-settings').click();
      await expect(section.getByTestId('settings-card')).toHaveText('Settings for Ada');
      await expect(section.getByTestId('profile-card')).toHaveCount(0);
      await page.getByTestId('rename').click();
      await expect(section.getByTestId('settings-card')).toHaveText('Settings for Grace');
    },
  },

  'underscored-component-on-string-path': {
    hash: '#/string-path',
    async steps({ page, section }) {
      await expect(section.getByTestId('frame-title')).toHaveText('Ada');
      await expect(section.getByTestId('underscored-slot')).toHaveText('inside');
      await page.getByTestId('rename').click();
      await expect(section.getByTestId('frame-title')).toHaveText('Grace');
    },
  },

  // ---- Known gaps of the string renderer (#/string-path) -----------------
  //
  // Each of these works on a compiled page and fails here, identically in both
  // builds: they are not parity defects, which is why the comparison above
  // could not have found them, and the content assertions did.
  'dynamic-attribute-update': {
    hash: '#/string-path',
    async steps({ page, section }) {
      await expect(section.getByTestId('dynamic-attr')).toHaveAttribute('data-tone', 'warm');
      await page.getByTestId('change').click();
      await expect(section.getByTestId('dynamic-attr')).toHaveAttribute('data-tone', 'cool', { timeout: 1_000 });
    },
  },
  'style-on-string-path': {
    hash: '#/string-path',
    knownGap:
      'data-ax-style is a render-program op the string renderer does not implement: in a template that falls back ' +
      '(AVX_W47) the attribute is interpolated to "[object Object]" and no style is applied, in either build.',
    async steps({ page, section }) {
      await expect(section.getByTestId('styled')).toHaveCSS('color', 'rgb(255, 0, 0)', { timeout: 1_000 });
      await page.getByTestId('change').click();
      await expect(section.getByTestId('styled')).toHaveCSS('color', 'rgb(0, 0, 255)', { timeout: 1_000 });
    },
  },
  'textarea-on-string-path': {
    hash: '#/string-path',
    async steps({ section }) {
      await expect(section.getByTestId('note')).toHaveValue('typed before mount', { timeout: 1_000 });
    },
  },
  'template-slot-on-string-path': {
    hash: '#/string-path',
    knownGap:
      'The <template slot="..."> wrapper is unwrapped only on the compiled path. In a template that falls back the ' +
      '<template> itself is projected, so its content stays inert and nothing is shown, in either build.',
    async steps({ section }) {
      await expect(section.getByTestId('wrapped-first')).toBeVisible({ timeout: 1_000 });
    },
  },
};

test.describe('every documented construct renders the same from both bundles', () => {
  for (const [name, construct] of Object.entries(CONSTRUCTS)) {
    test(name, async ({ page, app }) => {
      if (construct.knownGap) test.fail(true, construct.knownGap);

      /** @type {Object<string, string[]>} */
      const snapshots = {};
      for (const build of BUILDS) {
        await test.step(`${build.label} bundle`, async () => {
          await app.open('parity', { entry: build.entry, hash: construct.hash });
          const section = page.locator(`[data-construct="${name}"]`);
          await expect(section, `the ${name} section did not render`).toHaveCount(1);

          await construct.steps({ page, section });
          snapshots[build.label] = await section.evaluate(serialise);

          const interpreted = await page.evaluate(() =>
            typeof window.Avenx.interpretedSources === 'function' ? window.Avenx.interpretedSources() : null,
          );
          if (build.label === 'production') {
            // A production bundle has no interpreter at all; if one is here,
            // this is not the comparison it claims to be.
            expect(interpreted, 'the production bundle carries an expression interpreter').toBeNull();
          } else {
            expect(
              interpreted,
              'the development bundle interpreted expressions the build neither compiled nor reported as AVX_W48; ' +
                'each of these renders under --dev and throws AVX_R32 in production',
            ).toEqual([]);
          }
        });
      }

      expect(snapshots.production, `${name} renders differently in production than in development`).toEqual(
        snapshots.development,
      );
    });
  }
});

test.describe('parity fixture coverage', () => {
  test('every data-construct section in the fixture has a check here, and every check a section', () => {
    // Read from the fixture sources rather than the browser, so a section on a
    // page no check visits is still counted.
    const srcDir = path.join(APPS_DIR, 'parity', 'src');
    const found = new Set();
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (entry.name.endsWith('.js')) {
          for (const match of fs.readFileSync(full, 'utf8').matchAll(/data-construct="([^"]+)"/g)) {
            found.add(match[1]);
          }
        }
      }
    };
    scan(srcDir);

    expect([...found].sort()).toEqual(Object.keys(CONSTRUCTS).sort());
  });
});
