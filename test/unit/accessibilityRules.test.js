import assert from 'node:assert/strict';
import {
  findAccessibilityIssues,
  validateAccessibility,
  ACCESSIBILITY_RULES,
  A11Y_WARNING_CODES,
  isCustomComponent,
  hasAttribute,
} from '../../lib/compiler/rules/accessibility.js';
import { AvenxErrorCodes } from '../../lib/core/runtime/AvenxError.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';
import { logger } from '../../lib/core/runtime/AvenxLogger.js';

console.log('🧪 Testing Static Accessibility Lint Rules...');

// ----------------------------------------------------
// 1. Helper Function Unit Tests
// ----------------------------------------------------
{
  assert.ok(ACCESSIBILITY_RULES.IMAGE_ALT);
  assert.ok(ACCESSIBILITY_RULES.INTERACTIVE_ROLE);
  assert.ok(ACCESSIBILITY_RULES.ANCHOR_HREF);
  assert.ok(ACCESSIBILITY_RULES.FORM_LABEL);
  assert.ok(ACCESSIBILITY_RULES.BUTTON_NAME);
  assert.ok(ACCESSIBILITY_RULES.POSITIVE_TABINDEX);
  assert.ok(ACCESSIBILITY_RULES.ARIA_UNKNOWN_ROLE);
  assert.ok(ACCESSIBILITY_RULES.ARIA_UNKNOWN_ATTRIBUTE);
  assert.ok(ACCESSIBILITY_RULES.ARIA_INVALID_VALUE);
  assert.ok(ACCESSIBILITY_RULES.ARIA_HIDDEN_FOCUSABLE);

  const directIssues = validateAccessibility('<img src="/direct.png">', 'Direct.component.js', 'Direct', {
    warnings: { [AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT]: 'off' },
  });
  assert.strictEqual(directIssues.length, 1);

  assert.strictEqual(isCustomComponent('div'), false);
  assert.strictEqual(isCustomComponent('button'), false);
  assert.strictEqual(isCustomComponent('my-element'), true);
  assert.strictEqual(isCustomComponent('UserProfile'), true);
  assert.strictEqual(isCustomComponent('Card'), true);

  const nodeWithAttrs = {
    attributes: [
      { name: 'alt', value: 'logo' },
      { name: ':role', value: 'roleExpr' },
      { name: '@click', value: 'onClick' },
    ],
  };
  assert.strictEqual(hasAttribute(nodeWithAttrs, 'alt'), true);
  assert.strictEqual(hasAttribute(nodeWithAttrs, 'role'), true); // dynamic :role satisfies
  assert.strictEqual(hasAttribute(nodeWithAttrs, 'title'), false);
  console.log('  ✅ Helper functions unit tests passed');
}

// ----------------------------------------------------
// 2. Rule 1: AVX_W65 - img missing alt attribute
// ----------------------------------------------------
{
  // Positive: Missing alt
  const issues1 = findAccessibilityIssues('<div><img src="/pic.png"></div>', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT);
  assert.match(issues1[0].message, /missing an alt attribute/);
  assert.match(issues1[0].message, /alt=""/);
  assert.strictEqual(issues1[0].component, 'TestComp');

  // Negative: Literal alt
  const issues2 = findAccessibilityIssues('<div><img src="/pic.png" alt="A lovely photo"></div>', 'TestComp');
  assert.strictEqual(issues2.length, 0);

  // Negative: Decorative empty alt
  const issues3 = findAccessibilityIssues('<div><img src="/pic.png" alt=""></div>', 'TestComp');
  assert.strictEqual(issues3.length, 0);

  // Negative: Dynamic interpolated alt
  const issues4 = findAccessibilityIssues('<div><img src="/pic.png" alt="{{ item.alt }}"></div>', 'TestComp');
  assert.strictEqual(issues4.length, 0);

  // Negative: Dynamic bound :alt
  const issues5 = findAccessibilityIssues('<div><img src="/pic.png" :alt="item.alt"></div>', 'TestComp');
  assert.strictEqual(issues5.length, 0);

  // Negative: Custom component named Img or Image should not be flagged
  const issues6 = findAccessibilityIssues('<div><Img src="/pic.png" /></div>', 'TestComp');
  assert.strictEqual(issues6.length, 0);

  console.log('  ✅ Rule 1 (AVX_W65 - img alt) passed');
}

// ----------------------------------------------------
// 3. Rule 2: AVX_W66 - interactive handler on non-interactive element
// ----------------------------------------------------
{
  // Positive: div with @click and no role or keyboard handler
  const issues1 = findAccessibilityIssues('<div @click="toggleMenu()">Click me</div>', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_INTERACTIVE_ROLE);
  assert.match(issues1[0].message, /Interactive handler on non-interactive element/);

  // Positive: span with @click
  const issues2 = findAccessibilityIssues('<span @click="toggleMenu()">Click me</span>', 'TestComp');
  assert.strictEqual(issues2.length, 1);
  assert.strictEqual(issues2[0].code, AvenxErrorCodes.COMPILER_A11Y_INTERACTIVE_ROLE);

  // Negative: Native button with @click
  const issues3 = findAccessibilityIssues('<button @click="toggleMenu()">Click me</button>', 'TestComp');
  assert.strictEqual(issues3.length, 0);

  // Negative: div with role="button", tabindex="0", and @keydown
  const issues4 = findAccessibilityIssues(
    '<div role="button" tabindex="0" @click="toggleMenu()" @keydown="onKey($event)">Click me</div>',
    'TestComp',
  );
  assert.strictEqual(issues4.length, 0);

  // Negative: div with dynamic :role and @keyup
  const issues5 = findAccessibilityIssues(
    '<div :role="btnRole" tabindex="0" @click="toggleMenu()" @keyup="onKey($event)">Click me</div>',
    'TestComp',
  );
  assert.strictEqual(issues5.length, 0);

  // Negative: Custom component <Card @click="open()" /> is not flagged
  const issues6 = findAccessibilityIssues('<Card @click="open()">Card content</Card>', 'TestComp');
  assert.strictEqual(issues6.length, 0);

  console.log('  ✅ Rule 2 (AVX_W66 - interactive role/keyboard) passed');
}

// ----------------------------------------------------
// 4. Rule 3: AVX_W67 - anchor missing href
// ----------------------------------------------------
{
  // Positive: <a> without href
  const issues1 = findAccessibilityIssues('<a @click="openModal()">Open</a>', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_ANCHOR_HREF);
  assert.match(issues1[0].message, /<a> element is missing an href attribute/);

  // Negative: <a> with static href
  const issues2 = findAccessibilityIssues('<a href="/dashboard">Dashboard</a>', 'TestComp');
  assert.strictEqual(issues2.length, 0);

  // Negative: <a> with interpolation href
  const issues3 = findAccessibilityIssues('<a href="{{ user.profileUrl }}">Profile</a>', 'TestComp');
  assert.strictEqual(issues3.length, 0);

  // Negative: <a> with bound :href
  const issues4 = findAccessibilityIssues('<a :href="user.profileUrl">Profile</a>', 'TestComp');
  assert.strictEqual(issues4.length, 0);

  // Negative: Custom component <AnchorLink /> is not flagged
  const issues5 = findAccessibilityIssues('<AnchorLink @click="openModal()">Open</AnchorLink>', 'TestComp');
  assert.strictEqual(issues5.length, 0);

  console.log('  ✅ Rule 3 (AVX_W67 - anchor href) passed');
}

// ----------------------------------------------------
// 5. Rule 4: AVX_W68 - form controls without label
// ----------------------------------------------------
{
  // Positive: <input> without label
  const issues1 = findAccessibilityIssues('<input type="text" name="email">', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL);
  assert.match(issues1[0].message, /Form control <input> has no associated <label>/);

  // Positive: <select> without label
  const issues2 = findAccessibilityIssues('<select><option value="1">1</option></select>', 'TestComp');
  assert.strictEqual(issues2.length, 1);
  assert.strictEqual(issues2[0].code, AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL);

  // Positive: <textarea> without label
  const issues3 = findAccessibilityIssues('<textarea name="bio"></textarea>', 'TestComp');
  assert.strictEqual(issues3.length, 1);
  assert.strictEqual(issues3[0].code, AvenxErrorCodes.COMPILER_A11Y_FORM_LABEL);

  // Negative: <input type="hidden">, submit, reset, button are exempt
  assert.strictEqual(findAccessibilityIssues('<input type="hidden" name="csrf">').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input type="submit" value="Save">').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input type="button" value="Click">').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input type="reset" value="Reset">').length, 0);

  // Negative: aria-label attribute
  assert.strictEqual(findAccessibilityIssues('<input type="text" aria-label="Search">').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input type="text" aria-label="{{ searchLabel }}">').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input type="text" :aria-label="searchLabel">').length, 0);

  // Negative: aria-labelledby attribute
  assert.strictEqual(findAccessibilityIssues('<input type="text" aria-labelledby="label-id">').length, 0);

  // Negative: Wrapped inside <label>
  const issuesWrapped = findAccessibilityIssues('<label>Search: <input type="text"></label>');
  assert.strictEqual(issuesWrapped.length, 0);

  // Negative: Associated <label for="username"> with <input id="username">
  const issuesFor = findAccessibilityIssues('<div><label for="username">Username</label><input id="username" type="text"></div>');
  assert.strictEqual(issuesFor.length, 0);

  // Negative: Custom component <InputField /> is not flagged
  assert.strictEqual(findAccessibilityIssues('<InputField type="text" />').length, 0);

  console.log('  ✅ Rule 4 (AVX_W68 - form control label) passed');
}

// ----------------------------------------------------
// 6. Rule 5: AVX_W69 - button without accessible name
// ----------------------------------------------------
{
  // Positive: empty button
  const issues1 = findAccessibilityIssues('<button class="icon-trash"></button>', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_BUTTON_NAME);
  assert.match(issues1[0].message, /<button> has no accessible name/);

  // Negative: button with text
  assert.strictEqual(findAccessibilityIssues('<button>Delete</button>').length, 0);

  // Negative: button with aria-label
  assert.strictEqual(findAccessibilityIssues('<button class="icon-trash" aria-label="Delete item"></button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<button class="icon-trash" aria-label="{{ label }}"></button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<button class="icon-trash" :aria-label="label"></button>').length, 0);

  // Negative: button with aria-labelledby
  assert.strictEqual(findAccessibilityIssues('<button aria-labelledby="heading"></button>').length, 0);

  // Negative: button containing <slot>
  assert.strictEqual(findAccessibilityIssues('<button><slot></slot></button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<button><slot name="icon"></slot></button>').length, 0);

  // Negative: button containing icon child element and text
  assert.strictEqual(findAccessibilityIssues('<button><span class="icon"></span> Delete</button>').length, 0);

  // Negative: button containing icon child element with aria-label
  assert.strictEqual(findAccessibilityIssues('<button><span class="icon" aria-label="Delete"></span></button>').length, 0);

  // Positive: button containing only an empty child span with no text or aria-label
  assert.strictEqual(findAccessibilityIssues('<button><span class="icon"></span></button>').length, 1);

  // Negative: Custom component <Button /> is not flagged
  assert.strictEqual(findAccessibilityIssues('<Button class="icon-trash" />').length, 0);

  console.log('  ✅ Rule 5 (AVX_W69 - button accessible name) passed');
}

// ----------------------------------------------------
// 7. Rule 6: AVX_W70 - positive tabindex
// ----------------------------------------------------
{
  // Positive: tabindex="1" or "5"
  const issues1 = findAccessibilityIssues('<input type="text" aria-label="Search" tabindex="1">', 'TestComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_POSITIVE_TABINDEX);
  assert.match(issues1[0].message, /Positive tabindex "1"/);

  const issues2 = findAccessibilityIssues('<div tabindex="10">Content</div>', 'TestComp');
  assert.strictEqual(issues2.length, 1);
  assert.strictEqual(issues2[0].code, AvenxErrorCodes.COMPILER_A11Y_POSITIVE_TABINDEX);

  // Negative: tabindex="0"
  assert.strictEqual(findAccessibilityIssues('<div tabindex="0">Focusable</div>').length, 0);

  // Negative: tabindex="-1"
  assert.strictEqual(findAccessibilityIssues('<div tabindex="-1">Programmatic focus</div>').length, 0);

  // Negative: dynamic tabindex is conservative
  assert.strictEqual(findAccessibilityIssues('<div tabindex="{{ tabIdx }}">Dynamic</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div :tabindex="tabIdx">Dynamic</div>').length, 0);

  // Negative: Custom component <Custom tabindex="5" /> is not flagged
  assert.strictEqual(findAccessibilityIssues('<CustomWidget tabindex="5" />').length, 0);

  console.log('  ✅ Rule 6 (AVX_W70 - positive tabindex) passed');
}

// ----------------------------------------------------
// 8. Rule 7: AVX_W72 - aria-unknown-role
// ----------------------------------------------------
{
  // Positive: Typo in role with suggestion
  const issues1 = findAccessibilityIssues('<div role="btn">Click me</div>', 'RoleComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ROLE);
  assert.match(issues1[0].message, /Unknown ARIA role "btn"/);
  assert.match(issues1[0].message, /Did you mean "button"\?/);
  assert.strictEqual(issues1[0].closest, 'button');

  // Positive: Another near-miss typo
  const issues2 = findAccessibilityIssues('<span role="dialogg">Modal</span>', 'RoleComp');
  assert.strictEqual(issues2.length, 1);
  assert.strictEqual(issues2[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ROLE);
  assert.match(issues2[0].message, /Did you mean "dialog"\?/);
  assert.strictEqual(issues2[0].closest, 'dialog');

  // Positive: Abstract role is invalid
  const issuesAbstract = findAccessibilityIssues('<div role="roletype">Container</div>', 'RoleComp');
  assert.strictEqual(issuesAbstract.length, 1);
  assert.strictEqual(issuesAbstract[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ROLE);

  // Positive: Empty role attribute
  const issuesEmpty = findAccessibilityIssues('<div role="">Empty</div>', 'RoleComp');
  assert.strictEqual(issuesEmpty.length, 1);
  assert.strictEqual(issuesEmpty[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ROLE);

  // Negative: Valid roles
  assert.strictEqual(findAccessibilityIssues('<div role="button">Click</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="dialog">Dialog</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="none">None</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="presentation">Presentation</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="status">Status</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="alertdialog dialog">Fallback</div>').length, 0);

  // Dynamic cases: ignored per critical boundary
  assert.strictEqual(findAccessibilityIssues('<div role="{{ kind }}">Dynamic</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div :role="kind">Bound</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div role="btn" data-ax-dyn-attrs="role">DynAttr</div>').length, 0);

  // Custom component: ignored
  assert.strictEqual(findAccessibilityIssues('<CustomCard role="btn" />').length, 0);

  console.log('  ✅ Rule 7 (AVX_W72 - aria-unknown-role) passed');
}

// ----------------------------------------------------
// 9. Rule 8: AVX_W73 - aria-unknown-attribute
// ----------------------------------------------------
{
  // Positive: Typo in attribute name with suggestion
  const issues1 = findAccessibilityIssues('<div aria-labeledby="label-id">Content</div>', 'AttrComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ATTRIBUTE);
  assert.match(issues1[0].message, /Unknown ARIA attribute "aria-labeledby"/);
  assert.match(issues1[0].message, /Did you mean "aria-labelledby"\?/);
  assert.strictEqual(issues1[0].closest, 'aria-labelledby');

  // Positive: Another near-miss typo
  const issues2 = findAccessibilityIssues('<button aria-rolee="button">Save</button>', 'AttrComp');
  assert.strictEqual(issues2.length, 1);
  assert.strictEqual(issues2[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_UNKNOWN_ATTRIBUTE);
  assert.match(issues2[0].message, /Unknown ARIA attribute "aria-rolee"/);

  // Negative: Valid aria attributes
  assert.strictEqual(findAccessibilityIssues('<input aria-label="Name" />').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="true">Hidden</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<input aria-label="Required input" aria-required="true" />').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-live="polite">Live</div>').length, 0);

  // Dynamic cases: ignored per critical boundary
  assert.strictEqual(findAccessibilityIssues('<div aria-labeledby="{{ dynamicLabel }}">Dynamic</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div :aria-labeledby="dynamicLabel">Bound</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-invalidattr="test" data-ax-dyn-attrs="aria-invalidattr">DynAttr</div>').length, 0);

  // Custom component: ignored
  assert.strictEqual(findAccessibilityIssues('<CustomInput aria-labeledby="test" />').length, 0);

  console.log('  ✅ Rule 8 (AVX_W73 - aria-unknown-attribute) passed');
}

// ----------------------------------------------------
// 10. Rule 9: AVX_W74 - aria-invalid-value
// ----------------------------------------------------
{
  // Positive: Boolean attribute with invalid value
  const issues1 = findAccessibilityIssues('<div aria-hidden="yes">Hidden</div>', 'ValueComp');
  assert.strictEqual(issues1.length, 1);
  assert.strictEqual(issues1[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);
  assert.match(issues1[0].message, /Invalid value "yes" for ARIA attribute "aria-hidden"/);
  assert.match(issues1[0].message, /Expected one of "true", "false", "undefined"/);

  // Positive: Boolean attribute with numeric string "0"
  const issuesDisabled = findAccessibilityIssues('<div aria-disabled="0">Disabled</div>', 'ValueComp');
  assert.strictEqual(issuesDisabled.length, 1);
  assert.strictEqual(issuesDisabled[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);

  // Positive: Tristate attribute with invalid token
  const issuesChecked = findAccessibilityIssues('<div aria-checked="maybe">Checked</div>', 'ValueComp');
  assert.strictEqual(issuesChecked.length, 1);
  assert.strictEqual(issuesChecked[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);

  // Positive: Token attribute with invalid value
  const issuesLive = findAccessibilityIssues('<div aria-live="fast">Alert</div>', 'ValueComp');
  assert.strictEqual(issuesLive.length, 1);
  assert.strictEqual(issuesLive[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);

  // Positive: Integer attribute with non-numeric value
  const issuesLevel = findAccessibilityIssues('<div aria-level="high">Heading</div>', 'ValueComp');
  assert.strictEqual(issuesLevel.length, 1);
  assert.strictEqual(issuesLevel[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);

  // Positive: Number attribute with non-numeric value
  const issuesValueNow = findAccessibilityIssues('<div aria-valuenow="progress">Bar</div>', 'ValueComp');
  assert.strictEqual(issuesValueNow.length, 1);
  assert.strictEqual(issuesValueNow[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_INVALID_VALUE);

  // Negative: Valid boolean, tristate, token, number values
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="true">Hidden</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="false">Visible</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="undefined">Default</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden>Valueless boolean</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-checked="mixed">Mixed</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-live="polite">Polite</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-live="assertive">Assertive</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-level="3">Level 3</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-valuenow="50.5">Value 50.5</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-label="Arbitrary string is fine">Text</div>').length, 0);

  // Dynamic cases: ignored per critical boundary
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="{{ isHidden }}">Dynamic</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div :aria-hidden="isHidden">Bound</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div aria-live="fast" data-ax-dyn-attrs="aria-live">DynAttr</div>').length, 0);

  // Custom component: ignored
  assert.strictEqual(findAccessibilityIssues('<CustomModal aria-hidden="yes" />').length, 0);

  console.log('  ✅ Rule 9 (AVX_W74 - aria-invalid-value) passed');
}

// ----------------------------------------------------
// 11. Rule 10: AVX_W75 - aria-hidden-focusable
// ----------------------------------------------------
{
  // Positive: Button with aria-hidden="true"
  const issuesBtn = findAccessibilityIssues('<button aria-hidden="true">Click</button>', 'FocusComp');
  assert.strictEqual(issuesBtn.length, 1);
  assert.strictEqual(issuesBtn[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE);
  assert.match(issuesBtn[0].message, /Focusable element <button> has aria-hidden="true"/);

  // Positive: Valueless boolean button aria-hidden
  const issuesValueless = findAccessibilityIssues('<button aria-hidden>Click</button>', 'FocusComp');
  assert.strictEqual(issuesValueless.length, 1);
  assert.strictEqual(issuesValueless[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE);

  // Positive: Anchor with href
  const issuesAnchor = findAccessibilityIssues('<a href="/home" aria-hidden="true">Home</a>', 'FocusComp');
  assert.strictEqual(issuesAnchor.length, 1);
  assert.strictEqual(issuesAnchor[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE);

  // Positive: Form controls
  assert.strictEqual(findAccessibilityIssues('<input aria-label="Input" aria-hidden="true" />').length, 1);
  assert.strictEqual(findAccessibilityIssues('<input type="text" aria-label="Text input" aria-hidden="true" />').length, 1);
  assert.strictEqual(findAccessibilityIssues('<select aria-label="Options" aria-hidden="true"><option>1</option></select>').length, 1);
  assert.strictEqual(findAccessibilityIssues('<textarea aria-label="Comments" aria-hidden="true"></textarea>').length, 1);

  // Positive: summary and iframe
  assert.strictEqual(findAccessibilityIssues('<summary aria-hidden="true">Summary</summary>').length, 1);
  assert.strictEqual(findAccessibilityIssues('<iframe aria-hidden="true" src="/embed"></iframe>').length, 1);

  // Positive: Non-negative tabindex
  const issuesTab0 = findAccessibilityIssues('<div tabindex="0" aria-hidden="true">Focusable</div>', 'FocusComp');
  assert.strictEqual(issuesTab0.length, 1);
  assert.strictEqual(issuesTab0[0].code, AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE);

  const issuesTabPos = findAccessibilityIssues('<span tabindex="2" aria-hidden="true">Focusable</span>', 'FocusComp');
  assert.strictEqual(issuesTabPos.length, 2); // Also triggers AVX_W70 (positive tabindex)
  assert.ok(issuesTabPos.some((i) => i.code === AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE));

  // Negative: Non-interactive elements with aria-hidden="true"
  assert.strictEqual(findAccessibilityIssues('<div aria-hidden="true">Static container</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<span aria-hidden="true">Icon</span>').length, 0);

  // Negative: Anchor without href does not trigger AVX_W75
  const issuesNoHref = findAccessibilityIssues('<a aria-hidden="true">Placeholder link</a>');
  assert.strictEqual(issuesNoHref.some((i) => i.code === AvenxErrorCodes.COMPILER_A11Y_ARIA_HIDDEN_FOCUSABLE), false);

  // Negative: input[type="hidden"]
  assert.strictEqual(findAccessibilityIssues('<input type="hidden" aria-hidden="true" />').length, 0);

  // Negative: tabindex="-1" removes element from tab sequence
  assert.strictEqual(findAccessibilityIssues('<button tabindex="-1" aria-hidden="true">Disabled button</button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div tabindex="-1" aria-hidden="true">Backdrop</div>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<a href="/link" tabindex="-1" aria-hidden="true">Hidden link</a>').length, 0);

  // Negative: aria-hidden="false"
  assert.strictEqual(findAccessibilityIssues('<button aria-hidden="false">Visible</button>').length, 0);

  // Dynamic cases: ignored per critical boundary
  assert.strictEqual(findAccessibilityIssues('<button aria-hidden="{{ isHidden }}">Button</button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<button :aria-hidden="isHidden">Button</button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<button aria-hidden="true" data-ax-dyn-attrs="aria-hidden">Button</button>').length, 0);
  assert.strictEqual(findAccessibilityIssues('<div :tabindex="tabIdx" aria-hidden="true">Div</div>').length, 0);

  // Custom component: ignored
  assert.strictEqual(findAccessibilityIssues('<CustomButton aria-hidden="true" />').length, 0);

  console.log('  ✅ Rule 10 (AVX_W75 - aria-hidden-focusable) passed');
}

// ----------------------------------------------------
// 12. Integration with ComponentParser and Warning Reporter
// ----------------------------------------------------
{
  const styleProc = new StyleProcessor();

  // Test default: emits warning via logger.warn
  let loggedWarnings = [];
  const origWarn = logger.warn;
  logger.warn = (...args) => loggedWarnings.push(args.join(' '));

  try {
    const parser = new ComponentParser(styleProc, [], { warnings: {} });
    parser.validateTemplate('<img src="/test.png">', {}, {}, {}, {}, 'ImageComponent.component.js', 'ImageComponent');

    assert.strictEqual(loggedWarnings.length, 1);
    assert.ok(loggedWarnings[0].includes('AVX_W65'));
    assert.ok(loggedWarnings[0].includes('missing an alt attribute'));
    assert.ok(loggedWarnings[0].includes('ImageComponent'));
  } finally {
    logger.warn = origWarn;
  }

  // Test silencing: "warnings": { "AVX_W65": "off" }
  loggedWarnings = [];
  logger.warn = (...args) => loggedWarnings.push(args.join(' '));

  try {
    const parserOff = new ComponentParser(styleProc, [], {
      warnings: { [AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT]: 'off' },
    });
    parserOff.validateTemplate('<img src="/test.png">', {}, {}, {}, {}, 'ImageComponent.component.js', 'ImageComponent');

    assert.strictEqual(loggedWarnings.length, 0, 'AVX_W65 should be silenced when configured to off');
  } finally {
    logger.warn = origWarn;
  }

  // Test escalation: "warnings": { "AVX_W65": "error" }
  let errorThrown = false;
  const parserErr = new ComponentParser(styleProc, [], {
    warnings: { [AvenxErrorCodes.COMPILER_A11Y_IMAGE_ALT]: 'error' },
  });

  try {
    parserErr.validateTemplate('<img src="/test.png">', {}, {}, {}, {}, 'ImageComponent.component.js', 'ImageComponent');
  } catch (err) {
    errorThrown = true;
    assert.ok(err.message.includes('AVX_W65'));
  }
  assert.strictEqual(errorThrown, true, 'ComponentParser should throw BuildError when AVX_W65 is configured to error');

  console.log('  ✅ ComponentParser integration with severity settings passed');
}

// ----------------------------------------------------
// 13. All 10 warning codes are registered in A11Y_WARNING_CODES
// ----------------------------------------------------
{
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W65'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W66'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W67'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W68'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W69'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W70'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W72'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W73'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W74'), true);
  assert.strictEqual(A11Y_WARNING_CODES.has('AVX_W75'), true);
  assert.strictEqual(A11Y_WARNING_CODES.size, 10);
  console.log('  ✅ A11Y_WARNING_CODES registry verified');
}

console.log('🎉 All static accessibility lint rule unit tests passed!');
