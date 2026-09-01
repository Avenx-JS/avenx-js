---
title: 'Migrating from Angular to Avenx-JS'
description: 'Guide for migrating Angular TypeScript components, templates, Injectable Services, Signals, and RxJS to Avenx-JS.'
---

This guide details how to migrate applications built with **Angular** to **Avenx-JS**.

---

## 1. Architectural Overview & Mental Model Shift

Angular applications use TypeScript classes with `@Component` decorators, dependency injection trees, and RxJS/Signals. Avenx-JS provides a lightweight companion file architecture (`.component.js` and `.component.css`) with proxy-based state and imported Bridges (`bridge()`).

| Concept | Angular | Avenx-JS |
| :--- | :--- | :--- |
| **Component Definition** | TypeScript `@Component` class + HTML template | `.component.js` (logic/template) + `.component.css` |
| **Template Loops** | `*ngFor="let item of items"` | `<@for item in state.items key="item.id">` |
| **Shared State & Services** | `@Injectable({ providedIn: 'root' })` Services | **Bridges** (`bridge()` in `src/bridges/*.bridge.js`) |
| **Reactivity** | Signals (`signal()`) / RxJS Observables | Proxy state (`<state />`) and `<computed />` tags |
| **Route Protection** | Angular `CanActivate` guards | `AvenxGuard` classes with `canActivate(to, from)` |

---

## 2. Component Anatomy and Template Syntax

*This section will document replacing `@Component` classes and Angular directives (`*ngFor`, `[ngClass]`, `(click)`) with Avenx companion files and template syntax.*

---

## 3. Services and Dependency Injection Alternatives

Angular centralizes shared business logic and global state in `@Injectable({ providedIn: 'root' })` services injected into component constructors through its Dependency Injection (DI) framework. Avenx-JS replaces services and DI with **Bridges** — reactive modules in `src/bridges/*.bridge.js` created with the `bridge()` factory and reached by importing them. See [Shared State & Bridges](/core-concepts/bridges) for the full bridge API and [Migration Overview](/migration/overview) for the high-level conceptual mapping.

### Replacing `@Injectable` Services

A service becomes a bridge module. Where Angular marks the class with `@Injectable({ providedIn: 'root' })`, Avenx declares it in `src/bridges/<name>.bridge.js` and passes a definition to `bridge()`. State the service held as fields becomes keys of `state`; business logic becomes actions.

**Before — Angular `@Injectable` Service & Component DI**

```typescript
// user.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  currentUser = { name: 'Guest', role: 'visitor' };
  isLoggedIn = false;

  setUser(name: string, role: string) {
    this.currentUser = { name, role };
    this.isLoggedIn = true;
  }
}

// user.component.ts
import { Component } from '@angular/core';
import { UserService } from './user.service';

@Component({ selector: 'app-user', template: `<p>{{ userService.currentUser.name }}</p>` })
export class UserComponent {
  constructor(public userService: UserService) {}
}
```

**After — Avenx.js Bridge**

```javascript
// src/bridges/user.bridge.js
import { bridge } from 'avenx-core/runtime';

export default bridge({
  state: {
    currentUser: { name: 'Guest', role: 'visitor' },
    isLoggedIn: false,
  },

  setUser(name, role) {
    this.currentUser = { name, role };
    this.isLoggedIn = true;
  },
});
```

### Using a Bridge in a Component Template

A component reaches a bridge by importing it. The import replaces Angular's constructor injection: it is what puts the bridge in template scope, and it is what lets the compiler see every consumer.

**Before — Angular template using the injected service**

```html
<!-- user.component.html -->
<p>{{ userService.currentUser.name }} ({{ userService.currentUser.role }})</p>
<button (click)="userService.setUser('Alice', 'Admin')">Set Admin</button>
```

**After — Avenx.js template using the imported bridge**

```html
<!-- src/components/user/user.component.js -->
import user from '../../bridges/user.bridge.js';

<div>
  <p>User: {{ user.currentUser.name }} ({{ user.currentUser.role }})</p>
  <button @click="user.setUser('Alice', 'Admin')">Set Admin</button>
</div>
```

### Eliminating Constructor Injection

Avenx components do not take constructor parameters. There is no DI container and no provider tree to configure. Shared logic is reached by importing the bridge and referencing it in the template or inside `<action>` blocks.

### Global Registration & Singleton Scope

A bridge module is instantiated once, no matter how many modules import it. All components and pages share that one instance, so state written by one component is immediately visible to every other component that imports the bridge — the Avenx equivalent of a root-provided singleton service. A bridge nothing imports is left out of the bundle entirely.

### Key Conceptual Differences & Pitfalls

- **No DI Hierarchy**: Angular supports hierarchical injectors and scoping services to specific module trees. Avenx Bridges operate as global singletons; there is no per-module or per-route scoping.
- **No Constructor Parameters**: Component constructors in Avenx do not accept injected services. Import the bridge and reference it directly in templates or actions.
- **State is read-only outside the bridge**: A component cannot assign to `user.isLoggedIn`. Every mutation goes through an action, which is what keeps one origin for each change.

---

## 4. Signals and RxJS to Proxy Reactivity

Angular models reactive data with two APIs: **Signals** (`signal()`, `computed()`, `effect()`) for synchronous state, and **RxJS Observables** (`BehaviorSubject`, `async` pipe) for streams. Avenx-JS collapses both into **transparent Proxy state**: plain properties on a reactive `state` object that the framework watches and patches into the DOM for you. See the [Reactive State](/core-concepts/reactivity) guide for the full mental model, and the [Migration Overview](/migration/overview) for how every framework maps onto it.

### 4.1 Replacing Signals & Observables with `<state>`

A single `<state>` tag declares all of a component's reactive properties. Values are plain JavaScript properties — there are no setter functions and no getter calls.

| Angular | Avenx-JS |
| :--- | :--- |
| `signal(0)` | `<state count="0" />` → `state.count` |
| `signal.set(v)` / `signal.update(fn)` | `state.count = v` / `state.count++` |
| `BehaviorSubject` | `<state status="'Ready'" />` → `state.status` |
| `subject.next(v)` | `state.status = v` |
| `computed(() => expr)` | `<computed name="doubleCount" value="state.count * 2" />` |

#### Before – Angular Signals & RxJS Async Pipe

```typescript
import { Component, signal, computed } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Component({
  selector: 'app-counter',
  template: `
    <div>
      <p>Count: {{ count() }}</p>
      <p>Double: {{ doubleCount() }}</p>
      <p>Status: {{ status$ | async }}</p>
      <button (click)="increment()">Increment</button>
    </div>
  `
})
export class CounterComponent {
  count = signal(0);
  doubleCount = computed(() => this.count() * 2);
  status$ = new BehaviorSubject('Ready');

  increment() {
    this.count.update(c => c + 1);
    this.status$.next('Updated at ' + new Date().toLocaleTimeString());
  }
}
```

#### After – Avenx.js Proxy State & Computed

```html
<!-- src/components/counter/counter.component.js -->
<state count="0" status="'Ready'" />
<computed name="doubleCount" value="state.count * 2" />
<action name="increment">
  state.count++;
  state.status = 'Updated at ' + new Date().toLocaleTimeString();
</action>

<div>
  <p>Count: {{ state.count }}</p>
  <p>Double: {{ doubleCount }}</p>
  <p>Status: {{ state.status }}</p>
  <button @click="increment()">Increment</button>
</div>
```

### 4.2 Replacing the `async` Pipe

Templates read reactive properties directly. There is no subscription unwrapping and no `async` pipe: interpolation (`{{ state.count }}`) already reflects the latest value, and every mutation schedules an automatic DOM patch.

| Angular template | Avenx-JS template |
| :--- | :--- |
| `{{ count() }}` | `{{ state.count }}` |
| `{{ status$ | async }}` | `{{ state.status }}` |
| `*ngIf="(user$ | async) as user"` | `data-ax-show="state.user"` |
| `*ngFor="let item of items$ | async"` | `<@for item in state.items key="item.id">` |

### 4.3 Replacing Streams with `<resource>`

RxJS is not needed for asynchronous data that changes over time. Avenx-JS provides the [`<resource>` SFC tag & `Resource` API](/core-concepts/resources), which tracks reactive dependencies, re-fetches when they change, and integrates with `<@suspense>`:

```typescript
// Angular: this.user$ = this.http.get<User>(`/api/users/${this.id}`);
```

```html
<!-- Avenx-JS -->
<resource name="user" handler="fetch(`/api/users/${state.userId}`).then(r => r.json())" />

<p>Name: {{ state.user?.name }}</p>
```

### 4.4 Mental Model Shift: Push Streams → Declarative Proxy State

- **No execution parentheses**: Angular Signals are getter functions (`count()`); Avenx state properties are read as plain values (`state.count`).
- **No `.next()`, `.set()`, or `.update()`**: mutating a proxy property (`state.count++`, `state.status = ...`) is the only API you need.
- **No subscription lifecycle**: Angular requires `| async` or manual `subscribe()`/`unsubscribe()` management. Avenx components never subscribe; the framework's watcher observes property reads and patches the DOM automatically, batching updates into a single microtask flush.
- **Derived values are cached, not recomputed**: Angular `computed()` lazily caches; Avenx `<computed>` does the same with automatic dependency tracking and circular-dependency protection.

### 4.5 Key Conceptual Differences & Pitfalls

- **No Execution Parentheses**: Angular Signals require calling the signal getter function (`count()`). Avenx state properties are plain proxy properties (`state.count`).
- **No Async Pipe Needed**: Templates read reactive properties directly. No subscription unwrapping or `async` pipe operators are necessary.
- **Simplified State Mutations**: Mutate proxy properties directly (`state.count++`) instead of calling `signal.update()`, `signal.set()`, or `subject.next()`.
- **Services that push streams**: Angular services often expose `BehaviorSubject`s that components subscribe to. In Avenx, share data through a **Bridge** (`bridge()` in `src/bridges/*.bridge.js`) whose state is read reactively in any component that imports it, with `bridge.on(event, handler)` for one-off notifications.
