/**
 * Manual acceptance probe for a real host: resolves the lark-cli executable the
 * same way the plugin does on Windows (real binary over `.cmd` shim), then runs
 * `--version` and `auth status`.
 *
 * Nothing here is part of `npm test`: it needs a logged-in lark-cli.
 * Run with `node test/live.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Where npm keeps the native launcher for `@larksuite/cli`, relative to a `node_modules` root. */
const NATIVE_RELATIVE = ['node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe'];

/**
 * List PATH candidates for a bare command, in PATHEXT order.
 * @param {string} command - bare command name.
 * @returns {string[]} absolute candidate paths that exist.
 */
function pathCandidates(command) {
  const entries = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const found = [];
  for (const entry of entries) {
    if (entry.length === 0) continue;
    for (const extension of extensions) {
      const candidate = resolve(entry, command + extension);
      if (existsSync(candidate) && statSync(candidate).isFile()) found.push(candidate);
    }
  }
  return found;
}

/**
 * Walk up from a shim looking for the native launcher.
 * @param {string} shim - resolved `.cmd` / `.bat` path.
 * @returns {string | undefined} the native binary, when present.
 */
function nativeBesideShim(shim) {
  let directory = dirname(shim);
  for (let depth = 0; depth <= 4; depth += 1) {
    const candidate = join(directory, ...NATIVE_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** Pick a spawnable executable: a real binary first, then a shim with a warning. */
function pickExecutable() {
  const candidates = pathCandidates('lark-cli');
  if (candidates.length === 0) {
    console.error('lark-cli was not found on PATH. Install it with: npm install -g @larksuite/cli');
    process.exit(1);
  }
  const native = candidates.find((candidate) => /\.exe$/iu.test(candidate));
  if (native !== undefined) return { executable: native, note: 'native binary on PATH' };
  const shim = candidates[0];
  const upgraded = nativeBesideShim(shim);
  if (upgraded !== undefined) return { executable: upgraded, note: `upgraded from shim ${shim}` };
  return { executable: shim, note: `WARNING: only the shell shim ${shim} was found; it cannot be spawned without a shell` };
}

/** Run one command and print its streams. */
function run(executable, argv) {
  const result = spawnSync(executable, argv, {
    encoding: 'utf8',
    env: {
      ...process.env,
      LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
      LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
    },
  });
  console.log(`\n$ ${executable} ${argv.join(' ')}`);
  if (result.error !== undefined) console.log(`  spawn error: ${result.error.code ?? result.error.message}`);
  console.log(`  exit: ${String(result.status)}`);
  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();
  if (stdout.length > 0) console.log(`  stdout: ${stdout}`);
  if (stderr.length > 0) console.log(`  stderr: ${stderr}`);
  return { stdout, status: result.status };
}

const { executable, note } = pickExecutable();
console.log(`resolved executable: ${executable} (${note})`);
run(executable, ['--version']);

const status = run(executable, ['auth', 'status', '--json', '--verify']);
try {
  const envelope = JSON.parse(status.stdout);
  console.log(`\nidentity: ${String(envelope.identity)}`);
  console.log(`envelope.ok: ${String(envelope.ok)}`);
} catch {
  console.log('\n(auth status did not return a JSON envelope; is the user signed in?)');
}
