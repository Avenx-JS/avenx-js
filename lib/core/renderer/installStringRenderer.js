/**
 * @file installStringRenderer.js
 * @description Puts the string renderer into the registry.
 *
 * Importing this module is what pulls the pre-IR rendering path into a bundle.
 * Nothing in the framework imports it; the compiler adds it to the entry graph
 * when at least one component in the build could not be compiled to a render
 * program, and leaves it out otherwise.
 *
 * That is the whole of the mechanism, and it is deliberately the same shape as
 * the expression interpreter's: one module whose only job is a side effect, so
 * that "is this in the bundle?" has an answer a reader can find by looking at
 * one import rather than by reasoning about reachability.
 * @module lib/core/renderer/installStringRenderer
 */

import { DomPatcher } from './domPatch.js';
import { ListManager } from './listManager.js';
import { DeferManager } from './deferManager.js';
import { TemplateRenderer } from './renderTemplate.js';
import { installStringRenderer } from './stringRenderer.js';

installStringRenderer({ DomPatcher, ListManager, DeferManager, TemplateRenderer });
