import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const socket = createServer();
await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const directory = await mkdtemp(join(tmpdir(), 'seerr pack trial '));
const log = createWriteStream(join(directory, 'host.log'));
const app = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    CONFIG_DIRECTORY: directory,
    PORT: String(port),
    HOST: '127.0.0.1',
    LOG_LEVEL: 'error',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
app.stdout.pipe(log);
app.stderr.pipe(log);
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(app.exitCode, null, `Application exited; see ${directory}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/status`);
      if (response.ok && (await response.json()).version) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for migrations and the HTTP listener. */
    }
    await delay(500);
  }
  assert.ok(ready, `Application did not start; see ${directory}`);
  const page = await fetch(`http://127.0.0.1:${port}/login`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/);
  const denied = await fetch(`http://127.0.0.1:${port}/api/v1/request/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ mediaId: 1, mediaType: 'movie' }] }),
  });
  assert.ok(
    [401, 403].includes(denied.status),
    'Batch requests require authentication'
  );
  console.log(
    'PASS: production server, fresh database, web interface, API schema and authenticated batch route'
  );
  console.log(`Trial logs: ${directory}`);
} finally {
  app.kill();
  const exited = new Promise((resolve) => app.once('exit', resolve));
  await Promise.race([exited, delay(5000)]);
  if (app.exitCode === null) app.kill('SIGKILL');
  log.end();
}
