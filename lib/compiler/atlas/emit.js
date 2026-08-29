/**
 * @file emit.js
 * @description Serializing the Atlas beside the bundle.
 *
 * The artifact follows the convention `bundle.trace.json` already established:
 * it is written next to `bundle.js` and is **never referenced by it**. An
 * application that never runs `avenx impact` downloads nothing extra, a
 * deployment that does not want the file simply does not upload it, and Atlas
 * adds zero bytes to the runtime.
 * @module lib/compiler/atlas/emit
 */

import { ATLAS_VERSION } from './AppModel.js';

/**
 * The file name the Atlas is written under, given a bundle name.
 * @param {string} outputName - The configured bundle name, e.g. `bundle`.
 * @returns {string} The artifact's file name.
 */
export function atlasFileName(outputName) {
  return `${outputName}.atlas.json`;
}

/**
 * Assembles the artifact.
 *
 * `generatedAt` is the only field that changes between two builds of unchanged
 * sources. Everything below it is sorted, so the artifact diffs cleanly in
 * review and a golden test can compare it after dropping the timestamp.
 * @param {import('./AppModel.js').AppModel} model - The model to serialize.
 * @param {object} [meta] - Extra envelope fields, such as the source directory.
 * @returns {object} The serializable artifact.
 */
export function buildAtlas(model, meta = {}) {
  const { nodes, edges, unresolved } = model.toJSON();
  return {
    atlasVersion: ATLAS_VERSION,
    generatedAt: new Date().toISOString(),
    ...meta,
    summary: {
      nodes: nodes.length,
      edges: edges.length,
      unresolved: unresolved.length,
      counts: model.counts(),
    },
    nodes,
    edges,
    unresolved,
  };
}

/**
 * Serializes the artifact to JSON text.
 * @param {import('./AppModel.js').AppModel} model - The model.
 * @param {object} [meta] - Extra envelope fields.
 * @returns {string} Pretty-printed JSON.
 */
export function serializeAtlas(model, meta = {}) {
  return JSON.stringify(buildAtlas(model, meta), null, 2);
}

/**
 * Reads an artifact back, rejecting a format this build cannot interpret.
 *
 * A newer major version may have changed what a field means, and answering an
 * impact query from a model this build misreads would be worse than refusing.
 * Unknown *fields* are tolerated; an unknown *version* is not.
 * @param {string} text - The artifact's contents.
 * @returns {object} The parsed artifact.
 * @throws {Error} When the document is not a readable Atlas.
 */
export function parseAtlas(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
    throw new Error('Not an Avenx Atlas document.');
  }
  if (typeof parsed.atlasVersion !== 'number' || parsed.atlasVersion > ATLAS_VERSION) {
    throw new Error(
      `Atlas format version ${parsed.atlasVersion} cannot be read by this build (supports up to ${ATLAS_VERSION}).`,
    );
  }
  return parsed;
}

export default { atlasFileName, buildAtlas, serializeAtlas, parseAtlas };
