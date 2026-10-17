/**
 * The `lark_cli` tool: a safe execution channel for the official lark-cli.
 *
 * The tool owns exactly four things — argv validation, executable resolution,
 * a bounded spawn, and classification of the result. Every piece of domain
 * knowledge (which subcommand, which identity, how to recover) lives in the
 * bundled `lark-*` skills, so this file never routes by business domain.
 * @module dsh-lark-cli/tool
 */
import { statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { SubprocessOutcome } from '@deepseek-ai/dsh-subprocess';
import {
  GRACE_MS,
  NATIVE_BINARY_RELATIVE,
  NATIVE_BINARY_SEARCH_DEPTH,
  SHELL_SHIM_PATTERN,
  STDERR_MAX_BYTES,
  VERSION_PROBE_TIMEOUT_MS,
  type LarkIdentity,
} from './config.js';
import {
  LarkCliError,
  LARK_CLI_ABORTED,
  LARK_CLI_ERROR,
  LARK_CLI_INVALID_ARGV,
  LARK_CLI_MISSING,
  LARK_CLI_VERSION_TOO_OLD,
} from './errors.js';
import { buildEnv, classifyExit, compareVersions, parseVersion, validateArgv } from './runner.js';

/** Tool name as the model sees it. */
export const TOOL_NAME = 'lark_cli';

/** Fully resolved per-call settings, read from the volatile config. */
export interface LarkCliToolOptions {
  executable: string;
  nativeExecutable: string;
  minVersion: string;
  timeoutMs: number;
  maxOutputBytes: number;
  spillMaxBytes: number;
  defaultAs?: LarkIdentity | undefined;
}

/** Result of the one-shot version probe. */
type VersionProbe =
  | { kind: 'ok'; version: string }
  | { kind: 'unknown'; reason: string };

/** Per-executable probe cache: the version is stable for the host process lifetime. */
const versionProbes = new Map<string, Promise<VersionProbe>>();

/** Narrow an unknown throwable to a message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a path names an existing regular file. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Locate the native launcher that an npm-installed `@larksuite/cli` keeps next
 * to a `.cmd` shim. Windows cannot CreateProcess a script, so a shim has to be
 * replaced before spawning.
 * @param shimPath - resolved `.cmd` / `.bat` path.
 * @returns the native executable path, or `undefined` when none is present.
 */
function findNativeBinary(shimPath: string): string | undefined {
  let directory = dirname(shimPath);
  for (let depth = 0; depth <= NATIVE_BINARY_SEARCH_DEPTH; depth += 1) {
    const candidate = resolvePath(directory, ...NATIVE_BINARY_RELATIVE);
    if (isFile(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/**
 * Resolve the executable to spawn, upgrading a Windows shell shim to a real binary.
 * @param ctx - plugin context supplying the subprocess seam.
 * @param options - current settings.
 * @returns an absolute, spawnable executable path.
 */
async function resolveExecutable(ctx: Context, options: LarkCliToolOptions): Promise<string> {
  let candidate: string;
  try {
    candidate = await ctx.subprocess.resolveExecutable(options.executable);
  } catch (error) {
    throw new LarkCliError(
      `lark-cli executable "${options.executable}" was not found on PATH. Install it with "npm install -g @larksuite/cli", or set the plugin's "executable" to an absolute path. (${messageOf(error)})`,
      LARK_CLI_MISSING,
      { cause: error },
    );
  }
  if (!SHELL_SHIM_PATTERN.test(candidate)) return candidate;

  const explicit = options.nativeExecutable.trim();
  if (explicit.length > 0) {
    try {
      return await ctx.subprocess.resolveExecutable(explicit);
    } catch (error) {
      throw new LarkCliError(
        `configured "nativeExecutable" (${explicit}) is not an executable file: ${messageOf(error)}`,
        LARK_CLI_MISSING,
        { cause: error },
      );
    }
  }

  const detected = findNativeBinary(candidate);
  if (detected !== undefined) return detected;

  throw new LarkCliError(
    `lark-cli resolved to the Windows shell shim ${candidate}, which cannot be spawned without a shell. Set "executable" (or "nativeExecutable") to a real binary, e.g. "${resolvePath(dirname(candidate), ...NATIVE_BINARY_RELATIVE)}".`,
    LARK_CLI_MISSING,
  );
}

/** Run `--version` once and extract the version. */
async function probeVersion(ctx: Context, executable: string, timeoutMs: number): Promise<VersionProbe> {
  try {
    const handle = ctx.subprocess.spawn({
      argv: [executable, '--version'],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_096 }, stderr: { maxBytes: 4_096 } },
      graceMs: GRACE_MS,
      env: buildEnv(),
    });
    const timer = setTimeout(() => handle.terminate(), timeoutMs);
    let outcome: SubprocessOutcome;
    try {
      outcome = await handle.done;
    } finally {
      clearTimeout(timer);
    }
    if (outcome.exitCode !== 0) return { kind: 'unknown', reason: `--version exited ${String(outcome.exitCode)}` };
    const text = handle.collected.stdout?.readFrom(0).text ?? '';
    const version = parseVersion(text);
    return version === undefined
      ? { kind: 'unknown', reason: `unparseable --version output: ${text.trim().slice(0, 120) || '(empty)'}` }
      : { kind: 'ok', version };
  } catch (error) {
    return { kind: 'unknown', reason: messageOf(error) };
  }
}

/**
 * Enforce the version floor once per executable.
 * @param ctx - plugin context supplying the subprocess seam.
 * @param executable - resolved executable path.
 * @param options - current settings.
 * @returns a warning line when the version could not be verified.
 */
async function ensureVersion(ctx: Context, executable: string, options: LarkCliToolOptions): Promise<string | undefined> {
  const key = `${executable}@${options.minVersion}`;
  let probe = versionProbes.get(key);
  if (probe === undefined) {
    probe = probeVersion(ctx, executable, VERSION_PROBE_TIMEOUT_MS);
    versionProbes.set(key, probe);
  }
  const result = await probe;
  if (result.kind === 'unknown') {
    return `[warning] could not verify the lark-cli version (${result.reason}); continuing with the invocation anyway.`;
  }
  if (compareVersions(result.version, options.minVersion) < 0) {
    throw new LarkCliError(
      `lark-cli ${result.version} is older than the supported minimum ${options.minVersion}; run "lark-cli update" (or "npm install -g @larksuite/cli@latest") and retry.`,
      LARK_CLI_VERSION_TOO_OLD,
    );
  }
  return undefined;
}

/**
 * Fuse caller cancellation with the plugin's own deadline.
 * @param signals - signals to observe.
 * @returns the fused signal plus a disposer that detaches every listener.
 */
function composeSignal(signals: readonly AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const detachers: Array<() => void> = [];
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const forward = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', forward, { once: true });
    detachers.push(() => signal.removeEventListener('abort', forward));
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const detach of detachers) detach();
    },
  };
}

/**
 * Build the tool definition.
 * @param ctx - plugin context supplying the subprocess seam.
 * @param resolveOptions - reads the current volatile config section.
 * @returns a registry-ready tool definition.
 */
export function createLarkCliTool(
  ctx: Context,
  resolveOptions: () => LarkCliToolOptions,
): ToolDefinition {
  return defineTool({
    name: TOOL_NAME,
    description:
      'Run one official lark-cli (Feishu/Lark) subcommand and return its JSON envelope. '
      + 'Pass the command as argv WITHOUT the leading "lark-cli" (e.g. ["docs","+fetch","--url","<url>","--as","user"]). '
      + 'Read the lark-shared skill first, then the product skill that matches the task '
      + '(lark-doc, lark-im, lark-calendar, lark-task, lark-drive, lark-sheets, lark-base, lark-wiki) for exact syntax, '
      + 'identity (--as user|bot), and safety rules. Exit code 10 means a high-risk write needs explicit user '
      + 'confirmation: ask the user, then retry with the flag from the hint appended to the same argv.',
    parameters: {
      argv: {
        type: 'array',
        items: { type: 'string' },
        required: true,
        description: 'lark-cli arguments, one array element per argument, e.g. ["im","+send-text","--chat-id","oc_...","--text","hi"].',
      },
      stdin: {
        type: 'string',
        description: 'Optional bytes written to the subcommand stdin, for @- style data input.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true, description: 'Whether the command completed successfully.' },
          exitCode: { type: 'number', description: 'Process exit code; 10 means the confirmation gate refused the write.' },
          identity: { type: 'string', description: 'Identity reported by the envelope (user or bot), when present.' },
          text: { type: 'string', required: true, description: 'Model-facing rendering of the result.' },
          confirmationRequired: { type: 'boolean', description: 'True when a high-risk write needs explicit user approval.' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const options = resolveOptions();
      const argvError = validateArgv(args.argv);
      if (argvError !== undefined) throw new LarkCliError(argvError, LARK_CLI_INVALID_ARGV);

      const executable = await resolveExecutable(ctx, options);
      const versionWarning = await ensureVersion(ctx, executable, options);

      const cwd = exec.agent?.session.header.cwd ?? process.cwd();
      const deadline = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        deadline.abort();
      }, options.timeoutMs);
      const fused = composeSignal([exec.signal, deadline.signal]);

      let outcome: SubprocessOutcome;
      let stdout = '';
      let stderr = '';
      let spillPath: string | undefined;
      try {
        const handle = ctx.subprocess.spawn({
          argv: [executable, ...args.argv],
          cwd,
          stdio: {
            stdin: args.stdin === undefined ? 'ignore' : { data: args.stdin },
            stdout: { maxBytes: options.maxOutputBytes, spill: { maxBytes: options.spillMaxBytes } },
            stderr: { maxBytes: STDERR_MAX_BYTES },
          },
          graceMs: GRACE_MS,
          signal: fused.signal,
          env: buildEnv(options.defaultAs),
        });
        try {
          outcome = await handle.done;
        } finally {
          const stdoutRead = handle.collected.stdout?.readFrom(0);
          const stderrRead = handle.collected.stderr?.readFrom(0);
          stdout = stdoutRead?.text ?? '';
          stderr = stderrRead?.text ?? '';
          spillPath = stdoutRead?.spillPath;
        }
      } catch (error) {
        throw new LarkCliError(
          `lark-cli could not be started or did not settle: ${messageOf(error)}`,
          exec.signal.aborted ? LARK_CLI_ABORTED : LARK_CLI_ERROR,
          { cause: error },
        );
      } finally {
        clearTimeout(timer);
        fused.dispose();
      }

      if (exec.signal.aborted) {
        throw new LarkCliError('lark-cli call cancelled by the caller; nothing was reported.', LARK_CLI_ABORTED);
      }
      if (timedOut) {
        throw new LarkCliError(
          `lark-cli did not finish within ${options.timeoutMs} ms and was terminated. Narrow the query (--page-size, --jq), or raise the plugin's timeoutMs.`,
          LARK_CLI_ABORTED,
        );
      }

      const result = classifyExit(outcome.exitCode ?? -1, stdout, stderr);
      const notes = [versionWarning, spillPath === undefined ? undefined : `[full stdout spilled to ${spillPath}; read that file when the truncated tail is not enough.]`]
        .filter((note): note is string => note !== undefined);
      const text = notes.length === 0 ? result.text : `${result.text}\n\n${notes.join('\n')}`;

      if (result.kind === 'error') throw new LarkCliError(text, result.errorCode ?? LARK_CLI_ERROR);
      if (result.kind === 'confirmation') {
        return {
          ok: false,
          exitCode: result.exitCode,
          text,
          confirmationRequired: true,
          ...(result.identity === undefined ? {} : { identity: result.identity }),
        };
      }
      return {
        ok: true,
        exitCode: result.exitCode,
        text,
        ...(result.identity === undefined ? {} : { identity: result.identity }),
      };
    },
  });
}
