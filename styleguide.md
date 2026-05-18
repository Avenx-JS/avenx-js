# JavaScript Style Guide: Avenx Project

This style guide defines the coding standards for the Avenx project. it is based on the Airbnb JS Style Guide and ensures code consistency and maintainability.

## 1. Naming Conventions

### 1.1 Classes
*   **Format:** `PascalCase`
*   **Example:** `AvenxComponent`, `CounterBridge`

### 1.2 Methods & Variables
*   **Format:** `camelCase`
*   **Example:** `renderTemplate`, `updateState`, `activeComponents`

### 1.3 Private Fields
*   **Format:** `#` prefix (Native JS Private Fields)
*   **Example:** `#state`, `#element`
*   *Note:* If native private fields are not supported, the `_` prefix (e.g., `_template`) is used as an alternative to signal internal visibility.

### 1.4 Constants
*   **Format:** `UPPER_SNAKE_CASE`
*   **Example:** `MAX_DEPTH`, `DEFAULT_RE_RENDER_DELAY`

## 2. Documentation

### 2.1 JSDoc
All public methods and classes **must** be documented using JSDoc.
```javascript
/**
 * Short description of the method.
 * @param {string} paramName - Description of the parameter.
 * @returns {number} Description of the return value.
 */
publicMethod(paramName) { ... }
```

## 3. Best Practices

### 3.1 Variable Declaration
*   No `var`.
*   Use `const` by default.
*   Use `let` only when the variable needs to be reassigned.

### 3.2 Functions
*   Use **Arrow Functions** for callbacks (e.g., in `forEach`, `map`, `addEventListener`).
```javascript
// Correct
this.items.forEach(item => { ... });

// Incorrect
this.items.forEach(function(item) { ... });
```

### 3.3 Indentation & Formatting
*   Indentation: **2 spaces** (no tabs).
*   Use semicolons (`;`).
*   Use single quotes (`'`) for strings, except for template literals (`` ` ``).

## 4. Example
```javascript
/**
 * An exemplary component.
 */
class ExampleComponent extends AvenxComponent {
  #internalCounter = 0;

  /**
   * Initializes the component.
   */
  constructor() {
    const INITIAL_VALUE = 10;
    this.value = INITIAL_VALUE;
  }

  /**
   * Increments the value.
   */
  increment() {
    this.items.forEach(item => this.#process(item));
  }

  #process(item) {
    // internal logic
  }
}
```
