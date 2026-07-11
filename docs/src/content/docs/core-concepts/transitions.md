---
title: Transition Animations
description: Learn how to use the <transition> compiler tag and CSS classes for enter/leave animations in Avenx-JS.
---

Avenx-JS features a built-in animation framework powered by the template compiler and `DomPatcher`. By wrapping elements in a `<transition>` tag, you can smoothly animate elements as they enter or leave the DOM lifecycle.

---

## The `<transition>` Tag

The `<transition>` component does not render an element itself; instead, it injects dynamic CSS classes into its immediate child element during entry and exit hooks.

```html
<transition name="fade">
  <div class="box">Animate Me!</div>
</transition>
```

At compile time the `<transition>` wrapper is stripped out and replaced with a `data-ax-transition` attribute on the child. At runtime the child's class list is toggled through a sequence of six class hooks.

If no `name` attribute is given, the transition defaults to `ax`, producing classes like `.ax-enter` and `.ax-leave`.

```html
<transition>
  <p>Default name is "ax"</p>
</transition>
```

### Dynamic Names

The `name` attribute also accepts a template expression so the transition identity can be driven by state:

```html
<transition name="{{ state.transitionType }}">
  <div>Dynamic transition</div>
</transition>
```

---

## Enter / Leave Class Lifecycle

Every transition produces six CSS classes that follow a precise timing sequence.

### Enter

| Step | Classes on Element                          | Trigger                                                                       |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| 1    | `fade-enter` `fade-enter-active`            | Added synchronously when element is inserted                                  |
| 2    | `fade-enter-to` added, `fade-enter` removed | After double `requestAnimationFrame` (browser has rendered the initial paint) |
| 3    | `fade-enter-active` `fade-enter-to` removed | On `transitionend` / `animationend` event or fallback timeout                 |

```text
Element inserted
    ↓
Add: -enter, -enter-active
    ↓
[double rAF]
    ↓
Remove: -enter
Add: -enter-to
    ↓
[transitionend / animationend / timeout]
    ↓
Remove: -enter-active, -enter-to
```

### Leave

| Step | Classes on Element                          | Trigger                                                                                         |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | `fade-leave` `fade-leave-active`            | Added synchronously when element is removed                                                     |
| 2    | `fade-leave-to` added, `fade-leave` removed | After double `requestAnimationFrame`                                                            |
| 3    | `fade-leave-active` `fade-leave-to` removed | On `transitionend` / `animationend` event or fallback timeout, then element is removed from DOM |

```text
Element should be removed
    ↓
Add: -leave, -leave-active  (_isLeaving = true)
    ↓
[double rAF]
    ↓
Remove: -leave
Add: -leave-to
    ↓
[transitionend / animationend / timeout]
    ↓
Remove: -leave-active, -leave-to (_isLeaving = false)
Remove from DOM
```

### Rapid Toggling

If a new transition starts on an element before the previous one finishes (for example, rapidly toggling visibility), the in-progress transition is immediately cleaned up so the new one starts from a clean state.

---

## Duration Computation

The framework reads the element's computed style to determine how long to wait before cleaning up:

- `transition-duration` + `transition-delay`
- `animation-duration` + `animation-delay`

If multiple comma-separated values exist (e.g. separate durations for `opacity` and `transform`), the **maximum** value is used. Units can be `s` (seconds) or `ms` (milliseconds).

If the computed duration is `0` (no CSS transition or animation is defined), cleanup runs synchronously and no animation occurs.

A 50 ms buffer is added as a fallback timeout in case the native `transitionend` or `animationend` events do not fire.

---

## CSS Example

A basic fade transition that changes opacity over 300 ms:

```css
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter,
.fade-leave-to {
  opacity: 0;
}

.fade-enter-to,
.fade-leave {
  opacity: 1;
}
```

### Slide + Fade

```css
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
}

.slide-fade-enter,
.slide-fade-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

.slide-fade-enter-to,
.slide-fade-leave {
  opacity: 1;
  transform: translateX(0);
}
```

---

## Conditional Rendering Transitions

The `<transition>` tag works transparently with `data-ax-show`. When the bound expression toggles, the element passes through the enter or leave class sequence instead of appearing or disappearing instantly.

```html
<transition name="fade">
  <div data-ax-show="state.isVisible">Toggle Me</div>
</transition>
```

When `state.isVisible` becomes `false`:

1. Leave classes are applied
2. After the transition completes, `display: none` is set on the element

When `state.isVisible` becomes `true`:

1. `display` is restored
2. Enter classes are applied

---

## Page-Level Transitions

Route changes can be animated by passing a `transition` option to `mountPage`. The old page's children are wrapped in an `ax-page-exit-wrapper` div that runs the leave transition, while the new page's children simultaneously run the enter transition.

```javascript
app.mountPage('PageB', {}, { transition: 'fade' });
```

The transition name can also be defined per route or globally on the router:

```javascript
const router = new AvenxRouter(app, {
  transition: 'fade',
});
```

```javascript
const router = new AvenxRouter(app, {
  routes: {
    home: { page: 'HomePage', transition: 'slide-fade' },
    about: { page: 'AboutPage' },
  },
});
```

---

## Summary

| Concept          | Behaviour                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Default name     | `ax` when `name` is omitted                                                                        |
| Dynamic name     | `name="{{ expr }}"` for runtime resolution                                                         |
| Runtime fallback | Any `<transition>` elements surviving compile time are flattened by `DomPatcher`                   |
| Cleanup trigger  | `transitionend` / `animationend` events or computed duration + 50 ms timeout                       |
| Class sequence   | `-enter` → `-enter-active` → `-enter-to` (enter); `-leave` → `-leave-active` → `-leave-to` (leave) |
| Rapid toggle     | In-progress transitions are cancelled immediately via `_cleanupTransition`                         |
