/**
 * Key definitions and whether the string renderer currently supports them.
 * @type {Array<[string, string, boolean]>}
 */
const keyDefinitions = [
  ['enter', 'Enter', true],
  ['escape', 'Escape', true],
  ['esc', 'Escape', true],
  ['tab', 'Tab', true],
  ['space', ' ', true],
  ['delete', 'Delete', true],
  ['up', 'ArrowUp', false],
  ['down', 'ArrowDown', false],
  ['left', 'ArrowLeft', false],
  ['right', 'ArrowRight', false],
  ['backspace', 'Backspace', false],
];

/**
 * Key names accepted by the compiled event renderer.
 * @type {Map<string, string>}
 */
export const KEY_MODIFIERS = new Map(keyDefinitions.map(([name, key]) => [name, key]));

/**
 * Existing string-renderer key support, drawn from the same definitions.
 * @type {object}
 */
export const FALLBACK_KEY_MODIFIERS = Object.fromEntries(
  keyDefinitions.filter(([, , fallback]) => fallback).map(([name, key]) => [name, key]),
);

/**
 * System modifiers and their event properties.
 * @type {object}
 */
export const SYSTEM_MODIFIERS = {
  ctrl: 'ctrlKey',
  alt: 'altKey',
  shift: 'shiftKey',
  meta: 'metaKey',
  cmd: 'metaKey',
};

/**
 * The accepted event modifier vocabulary across both renderers.
 * @type {Set<string>}
 */
export const EVENT_MODIFIERS = new Set([
  'prevent',
  'stop',
  'self',
  'once',
  'passive',
  'capture',
  ...KEY_MODIFIERS.keys(),
  ...Object.keys(SYSTEM_MODIFIERS),
]);
