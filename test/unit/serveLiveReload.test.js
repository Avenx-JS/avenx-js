import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectLiveReload, broadcastLiveReload, formatSseMessage } from '../../bin/commands/serve/liveReload.js';

const cli = { config: { server: { liveReload: true } }, liveReloadClients: [] };
const connect = () => {
  const req = new EventEmitter();
  const res = {
    frames: [],
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(frame) { this.frames.push(frame); },
  };
  connectLiveReload(cli, req, res);
  return { req, res };
};

const first = connect();
assert.equal(first.res.status, 200);
assert.deepEqual(first.res.headers, {
  'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
});
assert.deepEqual(first.res.frames, ['data: {"type":"connected"}\n\n']);

cli.buildStatus = { ok: false, diagnostics: [{ message: 'bad\nline', severity: 'error' }] };
const second = connect();
const errorFrame = 'data: {"type":"error","diagnostics":[{"message":"bad\\nline","severity":"error"}]}\n\n';
assert.deepEqual(second.res.frames, ['data: {"type":"connected"}\n\n', errorFrame]);
assert.equal(formatSseMessage('reload'), 'data: reload\n\n');

broadcastLiveReload(cli, { type: 'css' });
assert.equal(first.res.frames.at(-1), 'data: {"type":"css"}\n\n');
assert.equal(second.res.frames.at(-1), first.res.frames.at(-1));
first.req.emit('close');
const third = connect();
second.req.emit('close');
assert.deepEqual(cli.liveReloadClients, [third.res]);
broadcastLiveReload(cli, { type: 'reload' });
assert.equal(third.res.frames.at(-1), 'data: {"type":"reload"}\n\n');
assert.equal(second.res.frames.at(-1), 'data: {"type":"css"}\n\n');

cli.buildStatus = { ok: true, diagnostics: [{ message: 'warning', severity: 'warning' }] };
assert.equal(connect().res.frames.length, 1);
cli.buildStatus.ok = false;
cli.config.server.errorOverlay = false;
assert.equal(connect().res.frames.length, 1);
broadcastLiveReload({}, { type: 'ok', diagnostics: [] });
console.log('SSE frames, failed-build replay and client lifecycle passed');
