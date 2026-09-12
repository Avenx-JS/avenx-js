/**
 * @file installVirtualList.js
 * @description Registers `<VirtualList>` as a built-in component.
 *
 * Importing this module is what puts the virtual list -- and the template
 * renderer and DOM patcher it drives -- into a bundle. Nothing in the framework
 * imports it; the compiler adds it to the entry graph when a template in the
 * build references `<VirtualList>`.
 * @module lib/core/runtime/installVirtualList
 */

import { VirtualList } from './VirtualList.js';
import { registerBuiltin } from './builtins.js';

registerBuiltin('VirtualList', VirtualList);
