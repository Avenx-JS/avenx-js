import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../helpers/register-happy-dom.js';

import { AvenxApp } from '../../lib/core/runtime/AvenxApp.js';
import { loadComponent } from '../../lib/core/tooling/loadComponent.js';
import { nextTick } from '../../lib/core/reactive/scheduler.js';
import {
  hasStringRenderer,
  installStringRenderer,
  requireStringRenderer,
} from '../../lib/core/renderer/stringRenderer.js';
import ComponentParser from '../../lib/compiler/ComponentParser.js';
import StyleProcessor from '../../lib/compiler/StyleProcessor.js';

const waitForRaf = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

test('component with <transition> compiles without AVX_W47 and renders without string renderer', async () => {
  const parser = new ComponentParser(new StyleProcessor());
  const saved = hasStringRenderer() ? requireStringRenderer() : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-compiled-transition-'));
  let app;

  try {
    installStringRenderer(null);
    document.body.innerHTML = '<div id="app"></div>';
    const file = path.join(root, 'fade.page.js');
    fs.writeFileSync(
      file,
      `
      <state open="false" tx="fade" />
      <transition name="fade">
        <div id="box" data-ax-show="open">Hello</div>
      </transition>
      `,
    );

    const parsed = parser.parse(file);
    assert.strictEqual(parser.renderFallbacks.length, 0, 'expected no AVX_W47 fallback');
    assert.ok(
      typeof parsed === 'string' && parsed.includes('"k":"transition"'),
      'expected a compiled render program with a transition op',
    );

    app = new AvenxApp({ target: '#app' });
    app.registerPage('fade', loadComponent(file));
    app.mountPage('fade');
    await nextTick();

    assert.strictEqual(hasStringRenderer(), false, 'compiled transition must not require string renderer');
    const box = document.querySelector('#box');
    assert.ok(box, 'box should be mounted');
    assert.strictEqual(box.style.display, 'none', 'initial data-ax-show="false" hides without transition');
    assert.strictEqual(box.classList.length, 0, 'no transition classes on initial mount');
  } finally {
    for (const component of app?.activeComponents || []) component.unmount();
    installStringRenderer(saved);
    document.body.innerHTML = '';
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('data-ax-show inside compiled <transition> runs all 6 classes in order for static and dynamic names', async () => {
  const saved = hasStringRenderer() ? requireStringRenderer() : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-show-transition-'));
  let app;

  try {
    installStringRenderer(null);
    document.body.innerHTML = '<div id="app"></div>';
    const file = path.join(root, 'show.page.js');
    fs.writeFileSync(
      file,
      `
      <state open="false" tx="fade" />
      <transition :name="tx">
        <div id="box" data-ax-show="open">Hello</div>
      </transition>
      `,
    );

    app = new AvenxApp({ target: '#app' });
    app.registerPage('show', loadComponent(file));
    app.mountPage('show');
    await nextTick();

    const box = document.querySelector('#box');
    box.style.transitionDuration = '20ms';
    const page = app.activePage;

    // 1. Enter with initial dynamic name ('fade')
    page.state.open = true;
    await nextTick();

    assert.strictEqual(box.style.display, '', 'element becomes visible before enter transition');
    assert.ok(box.classList.contains('fade-enter'), 'fade-enter added synchronously');
    assert.ok(box.classList.contains('fade-enter-active'), 'fade-enter-active added synchronously');

    await waitForRaf();
    assert.ok(!box.classList.contains('fade-enter'), 'fade-enter removed after rAF');
    assert.ok(box.classList.contains('fade-enter-to'), 'fade-enter-to added after rAF');

    await new Promise((r) => setTimeout(r, 90));
    assert.ok(!box.classList.contains('fade-enter-active'), 'fade-enter-active removed after transition');
    assert.ok(!box.classList.contains('fade-enter-to'), 'fade-enter-to removed after transition');

    // 2. Switch dynamic transition name to 'slide' and leave
    page.state.tx = 'slide';
    await nextTick();
    page.state.open = false;
    await nextTick();

    assert.ok(box.classList.contains('slide-leave'), 'slide-leave added synchronously');
    assert.ok(box.classList.contains('slide-leave-active'), 'slide-leave-active added synchronously');
    assert.strictEqual(box.style.display, '', 'element remains visible while leaving');

    await waitForRaf();
    assert.ok(!box.classList.contains('slide-leave'), 'slide-leave removed after rAF');
    assert.ok(box.classList.contains('slide-leave-to'), 'slide-leave-to added after rAF');

    await new Promise((r) => setTimeout(r, 90));
    assert.ok(!box.classList.contains('slide-leave-active'), 'slide-leave-active removed after transition');
    assert.ok(!box.classList.contains('slide-leave-to'), 'slide-leave-to removed after transition');
    assert.strictEqual(box.style.display, 'none', 'element hidden after leave completes');
  } finally {
    for (const component of app?.activeComponents || []) component.unmount();
    installStringRenderer(saved);
    document.body.innerHTML = '';
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('compiled <@if> and <@for> blocks run enter and leave transitions', async () => {
  const saved = hasStringRenderer() ? requireStringRenderer() : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'avenx-block-transition-'));
  let app;

  try {
    installStringRenderer(null);
    document.body.innerHTML = '<div id="app"></div>';
    const file = path.join(root, 'blocks.page.js');
    fs.writeFileSync(
      file,
      `
      <state visible="false" items="['a']" />
      <@if visible>
        <transition name="fade"><p id="cond">Shown</p></transition>
      </@if>
      <ul>
        <@for item in items key="item">
          <transition name="fade"><li>{{ item }}</li></transition>
        </@for>
      </ul>
      `,
    );

    app = new AvenxApp({ target: '#app' });
    app.registerPage('blocks', loadComponent(file));
    app.mountPage('blocks');
    await nextTick();

    const page = app.activePage;
    assert.strictEqual(document.querySelector('#cond'), null);

    // Mount <@if> block
    page.state.visible = true;
    await nextTick();
    const cond = document.querySelector('#cond');
    assert.ok(cond, 'conditional element mounted');
    assert.ok(cond.classList.contains('fade-enter'), 'enter class applied on block mount');
    assert.ok(cond.classList.contains('fade-enter-active'), 'enter-active class applied on block mount');

    await waitForRaf();
    assert.ok(!cond.classList.contains('fade-enter-active'), 'enter classes cleaned up for 0ms duration');

    // Dispose <@if> block with transition duration
    cond.style.transitionDuration = '20ms';
    page.state.visible = false;
    await nextTick();
    assert.ok(cond.isConnected, 'leaving element stays connected until transition ends');
    assert.ok(cond.classList.contains('fade-leave'), 'leave class applied on block dispose');
    assert.ok(cond.classList.contains('fade-leave-active'), 'leave-active class applied on block dispose');

    await waitForRaf();
    assert.ok(cond.classList.contains('fade-leave-to'), 'leave-to class applied after rAF');

    await new Promise((r) => setTimeout(r, 90));
    assert.strictEqual(document.querySelector('#cond'), null, 'leaving element removed after transition');
  } finally {
    for (const component of app?.activeComponents || []) component.unmount();
    installStringRenderer(saved);
    document.body.innerHTML = '';
    fs.rmSync(root, { recursive: true, force: true });
  }
});
