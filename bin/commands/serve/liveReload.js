import fs from 'node:fs';
import { isErrorOverlayEnabled, overlayMessageFor } from './overlay/index.js';

const client = fs.readFileSync(new URL('./liveReload/client.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n').replace(/^(?=.)/gm, '    ');
const script = '\n<script>\n' + client + '</script>\n';

/** Returns the classic browser client loaded once at server startup. */
export function getLiveReloadScript() {
  return script;
}

/**
 * Serialises one live-reload message as an SSE frame.
 *
 * Objects are sent as JSON. `JSON.stringify` escapes every newline inside the
 * payload, so a code frame -- which is nothing but newlines -- cannot break
 * out of the single `data:` line an SSE frame allows.
 * @param {object|string} payload - The message to send.
 * @returns {string} The complete SSE frame, terminator included.
 */
export function formatSseMessage(payload) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return `data: ${data}\n\n`;
}

/** Registers a client, replaying a failed build before accepting broadcasts. */
export function connectLiveReload(cli, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(formatSseMessage({ type: 'connected' }));

  // A page loaded or refreshed while the build is broken has no way of
  // knowing that, so a failed pass is replayed to every client that
  // connects. Without this, the one reflex a developer has when the page
  // looks wrong -- reload it -- is what hides the explanation. Warnings
  // are not replayed: they would then sit on the page from the moment it
  // loads, every load, which is what makes an overlay get switched off.
  if (isErrorOverlayEnabled(cli) && cli.buildStatus && !cli.buildStatus.ok) {
    const pending = overlayMessageFor(cli.buildStatus);
    if (pending) {
      res.write(formatSseMessage(pending));
    }
  }

  cli.liveReloadClients.push(res);

  req.on('close', () => {
    cli.liveReloadClients = cli.liveReloadClients.filter((client) => client !== res);
  });
}

/** Sends one frame to the currently connected clients. */
export function broadcastLiveReload(cli, event) {
  if (cli.liveReloadClients) {
    const frame = formatSseMessage(event);
    cli.liveReloadClients.forEach((client) => client.write(frame));
  }
}
