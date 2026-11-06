import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const prompt = 'Draw a scene using the reference images';

async function generate(t, args) {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-mcp-test-'));
  const tracePath = join(dir, 'trace.json');
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-loader', './test/fixtures/session-loader.js', 'src/mcp-server.js'],
    cwd: root,
    env: { GEMINI_TEST_TRACE_PATH: tracePath },
    stderr: 'pipe',
  });
  // Drain browser-operation logs and Node's experimental-loader warning.
  transport.stderr.resume();
  const client = new Client({ name: 'gemini-image-regression-test', version: '1.0.0' });
  t.after(async () => {
    try {
      await client.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  await client.connect(transport);
  const result = await client.callTool({
    name: 'gemini_generate_image',
    arguments: { prompt, ...args },
  });
  const trace = JSON.parse(await readFile(tracePath, 'utf8'));
  return { result, trace };
}

for (const { name, args, references, fresh } of [
  { name: 'new chat keeps one reference image', args: { newSession: true, referenceImages: ['ref.png'] }, references: ['ref.png'], fresh: true },
  { name: 'new chat keeps multiple reference images', args: { newSession: true, referenceImages: ['a.png', 'b.jpg'] }, references: ['a.png', 'b.jpg'], fresh: true },
  { name: 'existing chat keeps reference images', args: { newSession: false, referenceImages: ['ref.png'] }, references: ['ref.png'], fresh: false },
  { name: 'newSession defaults to reusing the current chat', args: { referenceImages: ['ref.png'] }, references: ['ref.png'], fresh: false },
  { name: 'new chat without references starts only once', args: { newSession: true }, references: [], fresh: true },
]) {
  test(name, { timeout: 10000 }, async (t) => {
    const { result, trace } = await generate(t, args);
    assert.notEqual(result.isError, true);
    assert.match(result.content[0].text, /generated\.png/);
    assert.deepEqual(trace.generation, {
      prompt,
      options: { fullSize: true, timeout: 180000 },
      attachments: references,
    });
    assert.deepEqual(trace.actions, [
      ...(fresh ? ['newChat'] : []),
      'modelPro',
      ...references.map((path) => `upload:${path}`),
      'generate',
      'disconnect',
    ]);
  });
}

test('failed reference upload stops generation and disconnects', { timeout: 10000 }, async (t) => {
  const { result, trace } = await generate(t, {
    newSession: true,
    referenceImages: ['ref.png', 'missing.png'],
  });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing\.png/);
  assert.match(result.content[0].text, /file_not_found/);
  assert.equal(trace.generation, null);
  assert.deepEqual(trace.actions, [
    'newChat', 'modelPro', 'upload:ref.png', 'upload:missing.png', 'disconnect',
  ]);
});
