/**
 * Offline smoke tests for the pure half of `dsh-lark-cli`.
 *
 * No network, no real lark-cli, no harness context: every assertion drives a
 * table through `dist/` so the build output itself is what gets verified.
 * Run with `node test/smoke.mjs`.
 */
import assert from 'node:assert/strict';
import { strict as assertStrict } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HarnessError } from '@deepseek-ai/dsh-llm';
import {
  LarkCliError,
  LARK_CLI_ERROR,
  LARK_CLI_MISSING,
  apply,
  buildEnv,
  classifyExit,
  compareVersions,
  parseEnvelope,
  parseSkill,
  parseVersion,
  truncateRender,
  validateArgv,
} from '../dist/index.js';
import { RENDER_MAX_CHARS } from '../dist/config.js';

assertStrict.ok;
let passed = 0;
const failures = [];
const pending = [];

/**
 * Run one named assertion, sync or async.
 * @param {string} name - case label.
 * @param {() => unknown} body - assertions.
 */
function test(name, body) {
  try {
    const result = body();
    if (result instanceof Promise) {
      pending.push(result.then(() => {
        passed += 1;
      }, (error) => {
        failures.push({ name, error });
      }));
      return;
    }
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

// --- identity of the error class -------------------------------------------

test('LarkCliError is a HarnessError', () => {
  const error = new LarkCliError('x', LARK_CLI_ERROR);
  assert.ok(error instanceof HarnessError, 'LarkCliError must extend HarnessError');
  assert.equal(error.code, LARK_CLI_ERROR);
  assert.equal(error.name, 'LarkCliError');
  assert.ok(error instanceof Error);
});

test('LarkCliError keeps a custom code', () => {
  assert.equal(new LarkCliError('x', LARK_CLI_MISSING).code, LARK_CLI_MISSING);
});

// --- envelope parsing ------------------------------------------------------

test('parseEnvelope accepts a success envelope with surrounding whitespace', () => {
  const envelope = parseEnvelope('\n  {"ok":true,"identity":"user","data":{"a":1}}\n');
  assert.ok(envelope !== undefined);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { a: 1 });
});

test('parseEnvelope accepts an error envelope', () => {
  const envelope = parseEnvelope('{"ok":false,"error":{"type":"permission","code":99991}}');
  assert.equal(envelope?.error?.code, 99991);
});

test('parseEnvelope rejects non-objects, plain text and broken JSON', () => {
  assert.equal(parseEnvelope(''), undefined);
  assert.equal(parseEnvelope('lark-cli version 1.0.97'), undefined);
  assert.equal(parseEnvelope('[1,2,3]'), undefined);
  assert.equal(parseEnvelope('{oops'), undefined);
  assert.equal(parseEnvelope('{"code":0,"msg":"ok"}')?.code, 0, 'a legacy OpenAPI body is JSON, not plain text');
});

test('a payload without the ok wrapper still surfaces its identity', () => {
  const result = classifyExit(0, JSON.stringify({ brand: 'feishu', identities: {}, identity: 'user' }), '');
  assert.equal(result.kind, 'ok');
  assert.equal(result.identity, 'user');
  assert.match(result.text, /^\[identity: user\] ok/);
  assert.match(result.text, /"brand":"feishu"/);
  assert.ok(!result.text.includes('"identity"'), 'identity is hoisted into the header');
});

// --- exit-code classification ---------------------------------------------

test('exit 0 with an envelope renders identity, data and meta', () => {
  const result = classifyExit(0, '{"ok":true,"identity":"user","data":{"items":[1,2]},"meta":{"count":2}}', '');
  assert.equal(result.kind, 'ok');
  assert.equal(result.identity, 'user');
  assert.match(result.text, /^\[identity: user\] ok/);
  assert.match(result.text, /"items":\[1,2\]/);
  assert.match(result.text, /meta: \{"count":2\}/);
});

test('exit 0 without an envelope returns the raw text', () => {
  const result = classifyExit(0, 'lark-cli version 1.0.97', '');
  assert.equal(result.kind, 'ok');
  assert.match(result.text, /\[identity: unknown\] ok/);
  assert.match(result.text, /lark-cli version 1\.0\.97/);
});

test('exit 0 with empty output still renders', () => {
  const result = classifyExit(0, '', '');
  assert.equal(result.kind, 'ok');
  assert.match(result.text, /\(no output\)/);
});

test('exit 0 with ok=false is an error (defensive)', () => {
  const result = classifyExit(0, '{"ok":false,"error":{"message":"boom"}}', '');
  assert.equal(result.kind, 'error');
  assert.equal(result.errorCode, LARK_CLI_ERROR);
  assert.match(result.text, /boom/);
});

test('exit 3 is idempotent success', () => {
  const result = classifyExit(3, '', '');
  assert.equal(result.kind, 'ok');
  assert.match(result.text, /already authenticated/);
});

test('exit 10 is a confirmation gate, not a failure', () => {
  const stderr = JSON.stringify({
    ok: false,
    error: {
      type: 'high-risk-write',
      risk: 'high-risk-write',
      action: 'drive +delete --file-token boxcnXXXX',
      message: 'deleting a file is not undoable',
      hint: 'pass --yes to confirm (exit 10 without it)',
    },
  });
  const result = classifyExit(10, '', stderr);
  assert.equal(result.kind, 'confirmation');
  assert.match(result.text, /CONFIRMATION REQUIRED/);
  assert.match(result.text, /action: drive \+delete/);
  assert.match(result.text, /risk: high-risk-write/);
  assert.match(result.text, /--yes/);
});

test('exit 10 without an envelope keeps the raw text', () => {
  const result = classifyExit(10, 'blocked: high-risk-write', '');
  assert.equal(result.kind, 'confirmation');
  assert.match(result.text, /blocked: high-risk-write/);
});

test('a failing exit carries hint, scopes and console url into the message', () => {
  const stderr = JSON.stringify({
    ok: false,
    error: {
      type: 'permission_denied',
      code: 99991672,
      message: 'missing scope',
      hint: 'grant docs:doc:readonly',
      missing_scopes: ['docs:doc:readonly', 'drive:drive:readonly'],
      console_url: 'https://open.feishu.cn/app/x/auth',
    },
  });
  const result = classifyExit(1, '', stderr);
  assert.equal(result.kind, 'error');
  assert.match(result.text, /permission_denied · code 99991672/);
  assert.match(result.text, /hint: grant docs:doc:readonly/);
  assert.match(result.text, /missing_scopes: docs:doc:readonly, drive:drive:readonly/);
  assert.match(result.text, /console_url: https:\/\/open\.feishu\.cn/);
});

test('a signal termination is reported as such', () => {
  const result = classifyExit(-1, '', 'killed');
  assert.equal(result.kind, 'error');
  assert.match(result.text, /signal/);
});

// --- version handling ------------------------------------------------------

test('compareVersions orders numerically, not lexically', () => {
  assert.ok(compareVersions('1.0.96', '1.0.97') < 0);
  assert.ok(compareVersions('1.0.9', '1.0.10') < 0);
  assert.equal(compareVersions('1.0.96', '1.0.96'), 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0);
  assert.equal(compareVersions('garbage', '0.0.0'), 0);
});

test('parseVersion extracts the first dotted version', () => {
  assert.equal(parseVersion('lark-cli version 1.0.97'), '1.0.97');
  assert.equal(parseVersion('v2.3'), undefined);
});

// --- rendering -------------------------------------------------------------

test('truncateRender caps and explains', () => {
  const long = 'x'.repeat(RENDER_MAX_CHARS + 10);
  const capped = truncateRender(long);
  assert.ok(capped.length > RENDER_MAX_CHARS);
  assert.match(capped, /\[truncated: \d+ characters in total/);
  assert.equal(truncateRender('short'), 'short');
});

// --- argv defence ----------------------------------------------------------

test('validateArgv rejects unusable vectors', () => {
  assert.match(String(validateArgv([])), /non-empty array/);
  assert.match(String(validateArgv(['docs', 'bad\nvalue'])), /newline/);
  assert.match(String(validateArgv(['docs', ''])), /empty/);
  assert.match(String(validateArgv(['docs', 42])), /must be a string/);
  assert.equal(validateArgv(['docs', '+fetch', '--url', 'https://x/docx/abc']), undefined);
});

// --- environment -----------------------------------------------------------

test('buildEnv suppresses notices and pins identity only when configured', () => {
  const bare = buildEnv();
  assert.equal(bare.LARKSUITE_CLI_NO_UPDATE_NOTIFIER, '1');
  assert.equal(bare.LARKSUITE_CLI_NO_SKILLS_NOTIFIER, '1');
  assert.equal(bare.LARKSUITE_CLI_DEFAULT_AS, undefined);
  assert.equal(buildEnv('user').LARKSUITE_CLI_DEFAULT_AS, 'user');
});

// --- bundled skill snapshot ------------------------------------------------

test('every bundled skill parses with a name and description', () => {
  const root = fileURLToPath(new URL('../skills/', import.meta.url));
  const names = ['lark-shared', 'lark-doc', 'lark-im', 'lark-calendar', 'lark-task', 'lark-drive', 'lark-sheets', 'lark-base', 'lark-wiki'];
  for (const name of names) {
    const raw = readFileSync(`${root}${name}/SKILL.md`, 'utf8');
    const parsed = parseSkill(raw, name);
    assert.equal(parsed.name, name, `${name} must declare its own name`);
    assert.ok(parsed.description.length > 20, `${name} must declare a usable description`);
    assert.ok(parsed.body.length > 200, `${name} must carry an instruction body`);
    assert.ok(!parsed.body.startsWith('---'), `${name} body must not keep the frontmatter`);
  }
});

test('the lark-shared skill documents the lark_cli execution contract', () => {
  const root = fileURLToPath(new URL('../skills/', import.meta.url));
  const raw = readFileSync(`${root}lark-shared/SKILL.md`, 'utf8');
  assert.match(raw, /lark_cli/);
  assert.match(raw, /在 dsh 中执行/);
});

// --- registration with a stub context --------------------------------------

const registrations = { tools: [], providers: [] };
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const fakeContext = {
  tools: {
    register: (definition) => {
      registrations.tools.push(definition);
      return () => {};
    },
  },
  skills: {
    registerProvider: (create) => {
      registrations.providers.push(create({ signal: new AbortController().signal, invalidate() {} }));
      return () => {};
    },
  },
  logger: () => quiet,
};
const fakeConfig = Object.fromEntries(
  Object.entries({
    executable: 'lark-cli',
    nativeExecutable: '',
    minVersion: '1.0.96',
    timeoutMs: 60_000,
    maxOutputBytes: 512_000,
    spillMaxBytes: 64 * 1024 * 1024,
    defaultAs: undefined,
  }).map(([key, value]) => [key, { get: () => value }]),
);
apply(fakeContext, fakeConfig);

test('apply registers exactly one tool named lark_cli', () => {
  assert.equal(registrations.tools.length, 1);
  assert.equal(registrations.tools[0].name, 'lark_cli');
});

test('apply registers one skill provider exposing the nine bundled skills', async () => {
  assert.equal(registrations.providers.length, 1);
  assert.equal(registrations.providers[0].name, 'lark-cli');
  const candidates = await registrations.providers[0].list({});
  assert.equal(candidates.length, 9);
  const names = candidates.map((candidate) => candidate.name).sort();
  assert.deepEqual(names, ['lark-base', 'lark-calendar', 'lark-doc', 'lark-drive', 'lark-im', 'lark-shared', 'lark-sheets', 'lark-task', 'lark-wiki']);
  for (const candidate of candidates) {
    assert.equal(candidate.source, 'bundled');
    assert.equal(candidate.rank, 600);
    assert.equal(candidate.resourceBase.kind, 'directory');
    assert.ok(candidate.description.length > 10, `${candidate.name} needs a description`);
  }
});

test('the provider loads skill bodies without their frontmatter', async () => {
  const provider = registrations.providers[0];
  const candidates = await provider.list({});
  for (const candidate of candidates) {
    const definition = await provider.get(candidate, {});
    assert.ok(definition !== undefined, `${candidate.name} must load`);
    assert.ok(definition.content.length > 200, `${candidate.name} body looks empty`);
    assert.ok(!definition.content.startsWith('---'), `${candidate.name} kept its frontmatter`);
  }
  const shared = await provider.get(candidates.find((candidate) => candidate.name === 'lark-shared'), {});
  assert.match(shared.content, /lark_cli/);
});

// --- report ----------------------------------------------------------------

await Promise.all(pending);
for (const failure of failures) {
  console.error(`FAIL ${failure.name}\n  ${failure.error?.stack ?? failure.error}`);
}
console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length > 0) process.exitCode = 1;
