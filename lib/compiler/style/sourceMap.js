import path from 'path';

/**
 * Registers source contents without changing their path identity.
 * @param {Map<string, string>} sourcesCache - Original stylesheet contents.
 * @param {string} filePath - Source path.
 * @param {string} content - Source contents.
 * @returns {void} The result.
 */
export function registerSourceFile(sourcesCache, filePath, content) {
  sourcesCache.set(filePath, content);
}

/**
 * Records an emitted line and its original source position.
 * @param {object[]} generatedLines - Accumulated output lines.
 * @param {string} text - Line contents.
 * @param {string|null} [sourceFile] - Original path.
 * @param {number|null} [sourceLine] - One-based original line.
 * @returns {void} The result.
 */
export function appendGeneratedLine(generatedLines, text, sourceFile = null, sourceLine = null) {
  generatedLines.push({
    text,
    sourceFile: sourceFile || null,
    sourceLine: sourceLine !== null ? sourceLine : null,
  });
}

/**
 * Encodes the original CSS Source Map v3 mapping and source order.
 * @param {object[]} generatedLines - Emitted lines.
 * @param {Map<string, string>} sourcesCache - Source contents.
 * @param {object|null} config - Sources-content configuration.
 * @param {string} distDir - Output directory.
 * @param {string} [cssFileName] - Output filename.
 * @returns {object} The result.
 */
export function getSourceMap(generatedLines, sourcesCache, config, distDir, cssFileName = 'bundle.css') {
  const sourcesList = [];
  const sourceToIndex = new Map();
  // `sourcesContent: false` keeps the original stylesheet out of the map. The
  // array lines up with sources by index, so the whole key is left out.
  const includeContent = !config || config.sourcesContent !== false;

  generatedLines.forEach((line) => {
    if (line.sourceFile && !sourceToIndex.has(line.sourceFile)) {
      const relativePath = path.relative(distDir, line.sourceFile).replace(/\\/g, '/');
      sourceToIndex.set(line.sourceFile, sourcesList.length);
      sourcesList.push(relativePath);
    }
  });

  const sourcesContent = sourcesList.map((relPath) => {
    const absPath = Array.from(sourceToIndex.keys()).find(
      (key) => path.relative(distDir, key).replace(/\\/g, '/') === relPath,
    );
    return sourcesCache.get(absPath) || '';
  });

  let mappings = '';
  const state = {
    prevGenCol: 0,
    prevSourceIdx: 0,
    prevSourceLine: 0,
    prevSourceCol: 0,
  };

  generatedLines.forEach((line, idx) => {
    if (idx > 0) {
      mappings += ';';
    }

    if (line.sourceFile && line.sourceLine !== null) {
      const sourceIdx = sourceToIndex.get(line.sourceFile);
      const sourceLine0 = Math.max(0, line.sourceLine - 1);

      state.prevGenCol = 0;
      mappings += encodeMapping(0, sourceIdx, sourceLine0, 0, state);
    }
  });

  return {
    version: 3,
    file: cssFileName,
    sources: sourcesList,
    ...(includeContent ? { sourcesContent } : {}),
    names: [],
    mappings: mappings,
  };
}

/**
 * Serializes an inline source-map comment.
 * @param {object} map - CSS source map.
 * @returns {string} The result.
 */
export function inlineSourceMapComment(map) {
  const json = JSON.stringify(map);
  const base64 = Buffer.from(json).toString('base64');
  return `/*# sourceMappingURL=data:application/json;charset=utf-8;base64,${base64} */`;
}

const VLQ_BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encodes a single integer into Base64 VLQ.
 * @param {number} value
 * @returns {string}
 */
export function encodeVLQ(value) {
  let vlq = value < 0 ? (-value << 1) | 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) {
      digit |= 32;
    }
    encoded += VLQ_BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

/**
 * Encodes a 4-tuple change using previous encoder state.
 * @param {number} genCol
 * @param {number} sourceIdx
 * @param {number} sourceLine
 * @param {number} sourceCol
 * @param {object} state
 * @returns {string}
 */
export function encodeMapping(genCol, sourceIdx, sourceLine, sourceCol, state) {
  const dGenCol = genCol - state.prevGenCol;
  const dSourceIdx = sourceIdx - state.prevSourceIdx;
  const dSourceLine = sourceLine - state.prevSourceLine;
  const dSourceCol = sourceCol - state.prevSourceCol;

  state.prevGenCol = genCol;
  state.prevSourceIdx = sourceIdx;
  state.prevSourceLine = sourceLine;
  state.prevSourceCol = sourceCol;

  return encodeVLQ(dGenCol) + encodeVLQ(dSourceIdx) + encodeVLQ(dSourceLine) + encodeVLQ(dSourceCol);
}

