/**
 * Snapshots one unit's starting position.
 * @param {object} state - Explicit stylesheet collections, hashes and text.
 * @returns {object} The result.
 */
export function captureUnitBaseline(state) {
  return {
    sourceKeys: new Set(state.sourcesCache.keys()),
    rawGlobalCSS: new Set(state.rawGlobalCSS),
    variables: { ...state.cssVariables },
    hashes: new Set(state.addedHashes),
    scopedStylesLength: state.scopedStyles.length,
    sourceInfoLength: state.rawGlobalCSSSourceInfo.length,
    scopedRulesLength: state.scopedRules.length,
  };
}

/**
 * Collects append-only stylesheet changes since a snapshot.
 * @param {object} state - Explicit stylesheet collections, hashes and text.
 * @param {object} baseline - Previously captured baseline.
 * @returns {object} The result.
 */
export function sliceUnitContribution(state, baseline) {
  return {
    sources: [...state.sourcesCache.entries()].filter(([file]) => !baseline.sourceKeys.has(file)),
    rawGlobalCSS: [...state.rawGlobalCSS].filter((css) => !baseline.rawGlobalCSS.has(css)),
    sourceInfo: state.rawGlobalCSSSourceInfo.slice(baseline.sourceInfoLength),
    variables: Object.entries(state.cssVariables).filter(([name, value]) => baseline.variables[name] !== value),
    hashes: [...state.addedHashes].filter((hash) => !baseline.hashes.has(hash)),
    scopedStyles: state.scopedStyles.slice(baseline.scopedStylesLength),
    scopedRules: state.scopedRules.slice(baseline.scopedRulesLength),
  };
}

/**
 * Checks scope-hash conflicts before replay.
 * @param {object} state - Explicit stylesheet collections, hashes and text.
 * @param {object} contribution - Previously captured contribution.
 * @returns {boolean} The result.
 */
export function canApplyUnitContribution(state, contribution) {
  if (!contribution) return false;
  return !contribution.hashes.some((hash) => state.addedHashes.has(hash));
}

/**
 * Replays collections and returns the updated scoped stylesheet.
 * @param {object} state - Explicit stylesheet collections, hashes and text.
 * @param {object} contribution - Previously captured contribution.
 * @returns {string} The result.
 */
export function applyUnitContribution(state, contribution) {
  for (const [file, content] of contribution.sources) {
    state.sourcesCache.set(file, content);
  }
  for (const css of contribution.rawGlobalCSS) {
    state.rawGlobalCSS.add(css);
  }
  for (const info of contribution.sourceInfo) {
    state.rawGlobalCSSSourceInfo.push(info);
  }
  for (const [name, value] of contribution.variables) {
    state.cssVariables[name] = value;
  }
  for (const hash of contribution.hashes) {
    state.addedHashes.add(hash);
  }
  state.scopedStyles += contribution.scopedStyles;
  for (const rule of contribution.scopedRules) {
    state.scopedRules.push(rule);
  }
  return state.scopedStyles;
}
