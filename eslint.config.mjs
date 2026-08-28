import js from "@eslint/js";
import jsdoc from "eslint-plugin-jsdoc";
import avenxTemplateParser from "./lib/core/tooling/avenxTemplateParser.js";
import { componentTagNamingRule } from "./lib/core/tooling/eslintComponentTagNaming.js";

export default [
  js.configs.recommended,
  jsdoc.configs['flat/recommended'],

  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "docs/",
      "dev-docs/",
      "coverage/",
      "bench-results/",
      "plugins/avenx-vite/example/"
    ]
  },

  {
    files: ["**/*.component.js", "**/*.page.js"],

    languageOptions: {
      parser: avenxTemplateParser,
      sourceType: "module"
    },

    plugins: {
      avenx: {
        rules: {
          "component-tag-naming": componentTagNamingRule
        }
      }
    },

    rules: {
      "avenx/component-tag-naming": "error"
    }
  },

  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        customElements: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Node: "readonly",
        Event: "readonly",
        CustomEvent: "readonly",
        MouseEvent: "readonly",
        InputEvent: "readonly",
        KeyboardEvent: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        ResizeObserver: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        navigator: "readonly",
        location: "readonly",
        fetch: "readonly",
        Headers: "readonly",
        getSelection: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        DOMParser: "readonly",
        performance: "readonly",
        Blob: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",

        // Node / Common JS / ES Module / Test globals
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        clearImmediate: "readonly",
        global: "writable",
        globalThis: "writable",
        Buffer: "readonly"
      }
    },

    plugins: {
      jsdoc: jsdoc
    },

    rules: {
      "indent": ["error", 2, { "SwitchCase": 1 }],
      "quotes": ["error", "single", {
        "avoidEscape": true,
        "allowTemplateLiterals": true
      }],
      "semi": ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "prefer-arrow-callback": "error",

      "camelcase": ["error", {
        "properties": "always",
        "allow": [
          "__avenx_comp_instance",
          "__avenx_routers",
          "__avenx_enable_profiling",
          "__avenx_directives"
        ]
      }],

      "jsdoc/require-jsdoc": ["error", {
        "require": {
          "MethodDefinition": true,
          "ClassDeclaration": true
        }
      }],

      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/no-undefined-types": "off",
      "jsdoc/reject-any-type": "off",
      "jsdoc/reject-function-type": "off",
      "jsdoc/check-types": "off",
      "jsdoc/escape-inline-tags": "off"
    }
  },

  {
    files: ["test/**/*.js", "bin/**/*.js", "scripts/**/*.js"],

    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/check-param-names": "off",
      "jsdoc/require-param-type": "off",
      "jsdoc/require-returns-type": "off"
    }
  }
];