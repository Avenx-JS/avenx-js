import { isAvenxFile } from './utils.js';

/**
 * Handles Hot Module Replacement for Avenx files.
 * @param {import('vite').HmrContext} ctx
 * @returns {Array<never>|undefined}
 */
export function handleAvenxHotUpdate(ctx) {
  const { file, server } = ctx;

  if (!isAvenxFile(file)) {
    return;
  }

  console.log('[HMR]', file);

  server.ws.send({
    type: 'full-reload',
  });

  return [];
}