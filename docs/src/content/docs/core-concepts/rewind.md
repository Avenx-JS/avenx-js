---
title: 'Avenx Rewind'
description: 'Compiler-verified state transactions: an atomic action journals every write it makes and undoes them all if it fails.'
---

An action marked `atomic` runs inside a **transaction**. Every state write it
makes — its own, and those of any bridge action it calls — is journaled. If the
action fails, the journal is played backwards and the state is what it was
before the action ran.

```html
<state qty="1" />

<action name="inc" atomic> qty++; return api.setQty(id, qty); </action>
```

`qty` increments instantly, so the UI feels immediate. If the promise rejects,
`qty` goes back to what it was. No `catch`, no snapshot, no inverse.

And the part a library cannot give you: **the build tells you which of the
action's effects a rewind will not undo.**

---

## The problem

Optimistic updates are one of the most common patterns in a real application
and one of the most reliably wrong. The shape is always the same: write to
state immediately, call the server, undo the write if the call fails. Everyone
writes the first half. Almost nobody keeps the second half correct, because:

- the write touched a component _and_ a bridge;
- the write was nested (`items[3].qty`) or a collection method (`splice`);
- a second optimistic update landed while the first was in flight;
- somebody added a fourth write a year later and never touched the rollback.

The failure mode is the worst kind. The page shows a value the server never
accepted, and nothing errors.

Written by hand in Avenx, the correct version of the example above looks like
this:

```html
<action name="incQty">
  const prevQty = cart.items.find(i => i.id === id).qty; const prevRevision = cart.revision; cart.addQty(id, 1); return
  api.setQty(id, prevQty + 1).catch(err => { cart.setQty(id, prevQty); cart.revision = prevRevision; throw err; });
</action>
```

Every line after `cart.addQty` is bookkeeping the compiler could have derived —
and it is already wrong, because `cart.addQty` may write keys this rollback
never mentions.

---

## Declaring a transaction

### On a component or page action

Add `atomic` to the `<action>` tag:

```html
<action name="incQty" atomic>
  busy = true; cart.addQty(props.id, 1); return api.setQty(props.id, cart.qtyOf(props.id));
</action>
```

### On a bridge action

A bridge is an ordinary ES module, so there is no attribute to hang the
declaration on. Wrap the function with `atomic()` instead:

```javascript
import { bridge, atomic } from 'avenx-core/runtime';

export default bridge({
  state: { items: [], revision: 0 },

  get total() {
    return this.items.reduce((sum, i) => sum + i.qty * i.price, 0);
  },

  addQty: atomic(function (id, n) {
    const item = this.items.find((entry) => entry.id === id);
    item.qty += n;
    this.revision++;
  }),
});
```

`atomic()` returns the same function, so its name, arity and identity are
unchanged.

---

## What decides the outcome

A transaction has no extra vocabulary. It commits and rewinds through what an
action already does:

| The action…                     | The transaction…                                          |
| :------------------------------ | :-------------------------------------------------------- |
| returns normally                | commits                                                   |
| returns a promise that resolves | commits                                                   |
| throws                          | rewinds, then rethrows the original error                 |
| returns a promise that rejects  | rewinds, then the promise rejects with the original error |

The error is never swallowed. A rewind happens _before_ it reaches the caller,
so a `catch` around the call still sees exactly what was thrown.

---

## What a rewind restores

Everything that went through Avenx state during the action:

- component, page, props and styles state;
- bridge state, including writes made by a bridge action the action called;
- nested properties, at any depth (`items[2].qty`);
- keys the transaction created — removed on rewind, not set to `undefined`;
- keys the transaction deleted — put back with their value;
- arrays, `Map`s and `Set`s, restored from a savepoint taken before the first
  mutation.

Restoring goes through the same reactive machinery as an ordinary write, so
watchers wake, computed values recompute and the DOM corrects itself. There is
no special case to learn.

### What it does not restore

A rewind restores state. It cannot un-send a request, un-emit an event or
un-write `localStorage`. Rather than leave you to discover that, the build
lists them — see [AVX_W43](#avx_w43--an-effect-a-rewind-cannot-undo) below.

---

## Overlapping transactions

Two optimistic updates to the same value — the double-clicked like button — is
the case that breaks naive rollback:

```html
<action name="like" atomic> likes++; return api.like(post.id); </action>
```

Click twice. `likes` goes `4 → 5` (T1), then `5 → 6` (T2). T1's request fails.

A naive rewind restores `4` and silently destroys T2's still-valid update. Avenx
restores a path only if the value there is still the one the transaction wrote.
`likes` is `6`, not `5`, so it is left alone and reported:

```text
[AVX_R29] Rewind of the atomic action "PostCard.like" left 1 path(s) unrestored:
  post.likes — wrote 5, found 6
The "safe" conflict policy refuses to overwrite a value the transaction did not
write. Everything else it journaled was restored.
```

### Choosing a policy

| Policy           | Behaviour                                                                  |
| :--------------- | :------------------------------------------------------------------------- |
| `safe` (default) | Leave the newer value alone and report AVX_R29.                            |
| `force`          | Restore regardless. For a transaction that is the authority on that value. |
| `abort`          | Restore what is safe, then throw AVX_R29.                                  |

Per action:

```html
<action name="reset" atomic onConflict="force"> ... </action>
```

```javascript
resetAll: atomic(function () { ... }, { onConflict: 'force' }),
```

Or project-wide in `avenx.config.json`:

```json
{
  "rewind": {
    "onConflict": "safe",
    "maxSnapshotItems": 10000
  }
}
```

---

## Nesting

An atomic action called from another atomic action **joins** the enclosing
transaction rather than opening a second one. So this undoes exactly once:

```html
<action name="checkout" atomic>
  cart.addQty(id, 1);
  <!-- itself atomic -->
  return api.checkout();
</action>
```

Called on its own, `cart.addQty` is still its own transaction.

---

## What the compiler reports

The rewind itself never depends on this analysis — the journal watches the
reactive proxies, so it sees every write whether or not anything predicted it.
What the analysis is for is telling you, before you ship, where the promise is
thinner than it looks.

### AVX_W42 — the write set is incomplete

```text
[AVX_W42] cart.setField is atomic, but its write set could not be resolved
completely (src/bridges/cart.bridge.js:26):
  dynamic-member "item[field]"  src/bridges/cart.bridge.js:26
```

The action reaches state through a computed key, an unresolved identifier, a
spread — or it writes state inside a `.then()` continuation, which runs after
the transaction has already closed and is therefore **never journaled**.

The rewind is unaffected in the first cases and genuinely incomplete in the
last. What is affected in all of them is the report: overlap analysis and the
effect list below are incomplete for that action.

### AVX_W43 — an effect a rewind cannot undo

```text
[AVX_W43] session.save is atomic, but 2 effect(s) cannot be rewound:
  storage localStorage.setItem(  src/bridges/session.bridge.js:14
  emit emit('saved'  src/bridges/session.bridge.js:15
```

Emits, storage writes, direct DOM access and timers all survive a rewind.
Either move them after the transaction, or accept that a rewind leaves them.

A request whose result the action **returns or awaits** is deliberately not
listed: that is the outcome the rewind hangs off, not a stray effect.

### AVX_W44 — two transactions writing the same state

```text
[AVX_W44] PostCard.like and PostCard.unlike are both atomic and both write
PostCard.liked, PostCard.likes (src/components/post-card/post-card.component.js:3).
```

This is the compile-time half of the double-click case above. It may be
perfectly fine — the `safe` policy handles it — but you should know it exists.

The warning is gated twice, and both gates matter:

- it is **skipped when either write set is unbounded**, because an overlap
  computed from a partial set is a false positive and a false negative at once;
- it is **skipped for a caller and its callee**, whose sets overlap by
  construction and which cannot conflict, because a nested transaction joins
  the enclosing frame.

Any of the three can be silenced or escalated per project:

```json
{ "warnings": { "AVX_W44": "off" } }
```

---

## In a trace

A value that changes back on its own would otherwise be the most confusing
thing in a recording, so a rewind is a node of its own and the restoring writes
are its children:

```text
▸ click <button.qty-inc> CartItem
  └─ action CartItem.incQty()  src/components/cart-item/cart-item.component.js:8
     └─ rewind CartItem.incQty — 2 restored  [safe]
        ├─ write cart.items.0.qty 2 → 1
        │  └─ woke CartItem#render
        └─ write CartItem.busy true → false
           └─ woke CartItem#render
```

Replay compares those writes like any other, so a regression that breaks a
rewind diverges on exactly the writes that went missing. See
[Avenx Trace](/core-concepts/trace).

---

## Limits

Worth knowing before you rely on it:

- **The journal follows the action's dynamic extent.** A write made inside a
  `.then()` continuation happens after the action has handed back its promise,
  so it is not journaled. Keep optimistic writes ahead of the promise you
  return. AVX_W42 reports this.
- **Non-reactive values are invisible.** Module-level variables, `markRaw()`
  objects and external stores are not journaled, because nothing routes them
  through Avenx state.
- **Collections are bounded.** A collection larger than
  `rewind.maxSnapshotItems` (default 10,000) gets no savepoint. This is
  reported through AVX_R29 rather than truncated quietly.
- **Component actions are synchronous.** `<action>` bodies compile to
  synchronous functions, so `await` belongs in a bridge action. Return the
  promise from the component action instead.
- **`Resource.mutate()` is not journaled.** An optimistic resource value set
  that way is outside the transaction.

---

## Cost

With no transaction open, each mutation site is one boolean read and one
comparison — the same guard shape tracing uses. Measured over 100,000 writes:

|                      | Time             |
| :------------------- | :--------------- |
| No transaction open  | 89.24 ms         |
| Inside a transaction | 89.89 ms (+0.7%) |
| Transaction + rewind | 89.74 ms (+0.6%) |

Collection savepoints are the one cost that scales with data rather than with
calls: 200 transactions taking one savepoint each cost 2.3 ms over a 100-entry
array and 8.6 ms over a 10,000-entry one.

Run it yourself with `node benches/rewind-overhead.bench.js`.

---

## Related

- [Avenx Atlas](/core-concepts/atlas) — the model the write-set analysis walks.
- [Avenx Trace](/core-concepts/trace) — where a rewind shows up as a cause.
- [Bridges](/core-concepts/bridges) — where shared state lives.
- [Compiler Contracts](/core-concepts/compiler-contracts) — the other place a
  declaration changes what the compiler checks.
