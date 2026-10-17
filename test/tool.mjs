/**
 * Integration test for the real execution channel: boots a standalone cordis
 * context with the local subprocess provider, registers the plugin's tool, and
 * drives actual `lark-cli` calls (read-only only — no writes, no network writes).
 *
 * Covers plan items A3, A5, A7 and the Windows shim-to-binary upgrade.
 * Run with `node test/tool.mjs`. Needs a working lark-cli install.
 */
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local';
import {
  LarkCliError,
  LARK_CLI_ERROR,
  LARK_CLI_INVALID_ARGV,
  createLarkCliTool,
} from '../dist/index.js';

const ctx = new Context();
ctx.plugin(SubprocessLocal);
await new Promise((resolve) => setTimeout(resolve, 300));
assert.ok(ctx.subprocess !== undefined, 'the subprocess provider must be available');

const tool = createLarkCliTool(ctx, () => ({
  executable: 'lark-cli',
  nativeExecutable: '',
  minVersion: '1.0.96',
  timeoutMs: 60_000,
  maxOutputBytes: 512_000,
  spillMaxBytes: 64 * 1024 * 1024,
}));

/** Build the minimal execution context the tool body reads. */
function exec() {
  const controller = new AbortController();
  return { signal: controller.signal, callId: 'test-call', name: 'lark_cli', arguments: {} };
}

/** Run one call and return its canonical value. */
async function call(argv) {
  return tool.execute({ argv }, exec());
}

const results = [];
function record(label, detail) {
  results.push(`${label}: ${detail}`);
}

// A7 — non-JSON output must not be misread as a failure.
const version = await call(['--version']);
assert.equal(version.ok, true);
assert.match(version.text, /lark-cli version \d+\.\d+\.\d+/u);
record('A7 --version', version.text.split('\n').join(' | '));

// A3 — real identity read through the tool.
const status = await call(['auth', 'status']);
assert.equal(status.ok, true);
assert.match(status.text, /^\[identity: (user|bot|unknown)\] ok/u);
record('A3 auth status', `${status.text.length} chars, identity=${String(status.identity)}`);

// A4 — a real read-only call returns live data under the user identity.
const agenda = await call(['calendar', '+agenda', '--as', 'user']);
assert.equal(agenda.ok, true);
assert.equal(agenda.identity, 'user');
record('A4 calendar +agenda', agenda.text.split('\n')[0]);

// A5 — an unknown subcommand keeps its routable code and a usable message.
await assert.rejects(
  () => call(['definitely-not-a-command']),
  (error) => {
    assert.ok(error instanceof LarkCliError, 'a CLI failure must surface as LarkCliError');
    assert.equal(error.code, LARK_CLI_ERROR);
    assert.ok(error.message.length > 20, 'the message must carry actionable detail');
    record('A5 unknown command', `code=${error.code}, first line=${error.message.split('\n')[0]}`);
    return true;
  },
);

// argv defence — a whole command line is rejected before spawning.
await assert.rejects(
  () => call(['docs\n+fetch']),
  (error) => {
    assert.equal(error.code, LARK_CLI_INVALID_ARGV);
    record('argv newline', error.message);
    return true;
  },
);

console.log(results.join('\n'));
console.log('tool integration: ok');
