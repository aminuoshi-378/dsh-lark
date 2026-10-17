/**
 * Pure helpers behind the `lark_cli` tool: version comparison, JSON envelope
 * parsing, exit-code classification, and model-facing rendering.
 *
 * Everything here is side-effect free so `test/smoke.mjs` can drive it from
 * tables without a real CLI, a network, or a harness context.
 * @module dsh-lark-cli/runner
 */
import {
  CONFIRMATION_FLAG,
  EXIT_ALREADY_AUTHENTICATED,
  EXIT_CONFIRMATION_REQUIRED,
  EXIT_SUCCESS,
  RENDER_MAX_CHARS,
  type LarkIdentity,
} from './config.js';
import { LARK_CLI_ERROR } from './errors.js';

/** `error` object of a failing lark-cli envelope. */
export interface LarkErrorBody {
  type?: string;
  subtype?: string;
  code?: string | number;
  message?: string;
  hint?: string;
  action?: string;
  risk?: string;
  missing_scopes?: readonly string[];
  granted_scopes?: readonly string[];
  console_url?: string;
  [key: string]: unknown;
}

/** Parsed `--format json` envelope (`{ok, identity, data, meta}` / `{ok:false, error}`). */
export interface LarkEnvelope {
  ok?: boolean;
  identity?: string;
  data?: unknown;
  meta?: unknown;
  error?: LarkErrorBody;
  [key: string]: unknown;
}

/** One classified call outcome. */
export interface LarkResult {
  kind: 'ok' | 'confirmation' | 'error';
  exitCode: number;
  envelope?: LarkEnvelope;
  identity?: string;
  /** Model-facing text; already truncated to the render cap. */
  text: string;
  /** Error code for `kind: 'error'`; always {@link LARK_CLI_ERROR}. */
  errorCode?: string;
}

/** Rendering options for {@link classifyExit}. */
export interface ClassifyOptions {
  /** Model-facing character cap; defaults to {@link RENDER_MAX_CHARS}. */
  maxChars?: number;
}

/**
 * Parse one JSON envelope, tolerating surrounding whitespace.
 * @param text - raw stream text.
 * @returns the envelope, or `undefined` when the text is not an lark-cli envelope.
 */
export function parseEnvelope(text: string): LarkEnvelope | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  // Any plain JSON object counts: most subcommands wrap their payload in
  // `{ok, identity, data, meta}`, but a few (e.g. `auth status --json`) return
  // the payload itself with a top-level `identity`. Non-JSON output keeps the
  // raw-text path instead.
  return parsed as LarkEnvelope;
}

/**
 * Compare two dotted versions numerically (no dependency, no prerelease rules).
 * @param a - left version.
 * @param b - right version.
 * @returns negative when `a < b`, positive when `a > b`, zero when equal.
 */
export function compareVersions(a: string, b: string): number {
  const left = a.trim().split(/[.+-]/u);
  const right = b.trim().split(/[.+-]/u);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = Number.parseInt(left[index] ?? '0', 10);
    const rightPart = Number.parseInt(right[index] ?? '0', 10);
    const leftValue = Number.isNaN(leftPart) ? 0 : leftPart;
    const rightValue = Number.isNaN(rightPart) ? 0 : rightPart;
    if (leftValue !== rightValue) return leftValue - rightValue;
  }
  return 0;
}

/**
 * Extract the first `x.y.z` version from `lark-cli --version` output.
 * @param text - probe output, e.g. `lark-cli version 1.0.97`.
 * @returns the version string, or `undefined` when none is present.
 */
export function parseVersion(text: string): string | undefined {
  const match = /\d+\.\d+\.\d+/u.exec(text);
  return match?.[0];
}

/**
 * Build the explicit environment layered on the harness-scrubbed parent base.
 * Credentials are never injected: lark-cli reads its own keychain/config.
 * @param defaultAs - identity to pin, when configured.
 * @returns explicit child environment entries.
 */
export function buildEnv(defaultAs?: LarkIdentity): Record<string, string> {
  const env: Record<string, string> = {
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: '1',
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: '1',
  };
  if (defaultAs !== undefined) env.LARKSUITE_CLI_DEFAULT_AS = defaultAs;
  return env;
}

/**
 * Validate model-supplied arguments before they become a spawn argv.
 * @param argv - candidate argument vector.
 * @returns a model-facing rejection reason, or `undefined` when usable.
 */
export function validateArgv(argv: readonly string[] | undefined): string | undefined {
  if (!Array.isArray(argv) || argv.length === 0) {
    return 'argv must be a non-empty array of lark-cli arguments, e.g. ["docs","+fetch","--url","<url>"]';
  }
  for (const [index, value] of argv.entries()) {
    if (typeof value !== 'string') return `argv[${index}] must be a string`;
    if (value.length === 0) return `argv[${index}] is empty; drop empty arguments instead of padding the vector`;
    if (/[\r\n]/u.test(value)) {
      return `argv[${index}] contains a newline; pass one argument per array element and never a whole shell command line`;
    }
  }
  return undefined;
}

/**
 * Cap the model-facing text and say how to narrow the next call.
 * @param text - rendered result.
 * @param maxChars - character cap.
 * @returns the capped text, with a truncation note when anything was dropped.
 */
export function truncateRender(text: string, maxChars: number = RENDER_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length} characters in total, first ${maxChars} shown. Narrow the result with --jq / --page-size, or read the spilled full output when a path is reported.]`;
}

/** Serialize losslessly, falling back to a string form for exotic values. */
function toJson(value: unknown): string {
  if (value === undefined) return 'null';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Join non-empty stream texts. */
function joinStreams(...streams: string[]): string {
  return streams.map((stream) => stream.trim()).filter((stream) => stream.length > 0).join('\n');
}

/** Render a successful call. */
function renderSuccess(
  envelope: LarkEnvelope | undefined,
  raw: string,
  note: string | undefined,
): string {
  const identity = typeof envelope?.identity === 'string' ? envelope.identity : undefined;
  const header = `[identity: ${identity ?? 'unknown'}] ok${note === undefined ? '' : ` (${note})`}`;
  const body = envelope === undefined
    ? raw.trim().length > 0 ? raw.trim() : '(no output)'
    : toJson(envelope.data === undefined ? { ...envelope, ok: undefined, identity: undefined } : envelope.data);
  const meta = envelope?.meta;
  const hasMeta = typeof meta === 'object' && meta !== null && Object.keys(meta).length > 0;
  return hasMeta ? `${header}\n${body}\nmeta: ${toJson(meta)}` : `${header}\n${body}`;
}

/** Render one upstream error body as label lines. */
function errorLines(error: LarkErrorBody): string[] {
  const lines: string[] = [];
  const head = [error.type, error.subtype, error.code === undefined ? undefined : `code ${String(error.code)}`]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ');
  if (head.length > 0) lines.push(head);
  if (typeof error.message === 'string' && error.message.length > 0) lines.push(`message: ${error.message}`);
  if (typeof error.action === 'string' && error.action.length > 0) lines.push(`action: ${error.action}`);
  if (typeof error.hint === 'string' && error.hint.length > 0) lines.push(`hint: ${error.hint}`);
  if (Array.isArray(error.missing_scopes) && error.missing_scopes.length > 0) {
    lines.push(`missing_scopes: ${error.missing_scopes.join(', ')}`);
  }
  if (typeof error.console_url === 'string' && error.console_url.length > 0) {
    lines.push(`console_url: ${error.console_url}`);
  }
  return lines;
}

/** Render a failed call. */
function renderFailure(exitCode: number, envelope: LarkEnvelope | undefined, raw: string): string {
  const header = exitCode < 0
    ? 'lark-cli terminated before exiting (the process ended on a signal)'
    : `lark-cli failed (exit ${exitCode})`;
  const error = envelope?.error;
  const lines = error === undefined ? [header] : [header, ...errorLines(error)];
  const output = raw.trim();
  // Repeat the raw stream only when the envelope did not already explain itself;
  // otherwise the JSON would just duplicate the rendered lines.
  const explained = error !== undefined
    && (typeof error.message === 'string' || typeof error.hint === 'string' || typeof error.type === 'string');
  if (output.length > 0 && !explained) lines.push(output);
  if (lines.length === 1) lines.push('(no output)');
  return lines.join('\n');
}

/** Render the high-risk confirmation gate as an instruction, never as a failure. */
function renderConfirmation(envelope: LarkEnvelope | undefined, raw: string): string {
  const error = envelope?.error;
  const lines = [
    'CONFIRMATION REQUIRED (exit 10): lark-cli refused a high-risk write and nothing was executed.',
  ];
  if (error !== undefined) {
    if (typeof error.risk === 'string' && error.risk.length > 0) lines.push(`risk: ${error.risk}`);
    lines.push(...errorLines({ ...error, code: undefined }));
  } else {
    const output = raw.trim();
    if (output.length > 0) lines.push(output);
  }
  lines.push(
    `Next: show the user the action and its risk, ask for explicit approval, then call lark_cli again with the SAME argv plus the confirmation flag from hint (usually "${CONFIRMATION_FLAG}"). Never add it silently.`,
  );
  return lines.join('\n');
}

/**
 * Classify one finished run into success, confirmation gate, or failure.
 * @param exitCode - process exit code (`-1` when the process died on a signal).
 * @param stdout - collected stdout text.
 * @param stderr - collected stderr text.
 * @param options - rendering options.
 * @returns the classified, render-ready result.
 */
export function classifyExit(
  exitCode: number,
  stdout: string,
  stderr: string,
  options: ClassifyOptions = {},
): LarkResult {
  const maxChars = options.maxChars ?? RENDER_MAX_CHARS;
  if (exitCode === EXIT_CONFIRMATION_REQUIRED) {
    const envelope = parseEnvelope(stdout) ?? parseEnvelope(stderr);
    return {
      kind: 'confirmation',
      exitCode,
      ...(envelope === undefined ? {} : { envelope }),
      ...(typeof envelope?.identity === 'string' ? { identity: envelope.identity } : {}),
      text: truncateRender(renderConfirmation(envelope, joinStreams(stdout, stderr)), maxChars),
    };
  }
  if (exitCode === EXIT_SUCCESS || exitCode === EXIT_ALREADY_AUTHENTICATED) {
    const envelope = parseEnvelope(stdout);
    // Defensive: an `ok:false` body under exit 0 means upstream behaviour drifted.
    if (envelope !== undefined && envelope.ok === false) {
      return {
        kind: 'error',
        exitCode,
        envelope,
        text: truncateRender(renderFailure(exitCode, envelope, joinStreams(stdout, stderr)), maxChars),
        errorCode: LARK_CLI_ERROR,
      };
    }
    return {
      kind: 'ok',
      exitCode,
      ...(envelope === undefined ? {} : { envelope }),
      ...(typeof envelope?.identity === 'string' ? { identity: envelope.identity } : {}),
      text: truncateRender(
        renderSuccess(
          envelope,
          joinStreams(stdout, stderr),
          exitCode === EXIT_ALREADY_AUTHENTICATED ? 'exit 3: already authenticated, idempotent no-op' : undefined,
        ),
        maxChars,
      ),
    };
  }
  const envelope = parseEnvelope(stderr) ?? parseEnvelope(stdout);
  return {
    kind: 'error',
    exitCode,
    ...(envelope === undefined ? {} : { envelope }),
    ...(typeof envelope?.identity === 'string' ? { identity: envelope.identity } : {}),
    text: truncateRender(renderFailure(exitCode, envelope, joinStreams(stdout, stderr)), maxChars),
    errorCode: LARK_CLI_ERROR,
  };
}
