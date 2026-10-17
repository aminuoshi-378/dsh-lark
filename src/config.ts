/**
 * Constants, defaults, and the plugin config schema for `dsh-lark-cli`.
 *
 * Every default lives here so the schema, the executor resolution, and the tool
 * body never repeat a literal. All config fields are volatile: the loader hands
 * `apply()` stable references whose `.get()` re-reads the current section, so a
 * changed `executable` / `timeoutMs` reaches the very next call without a restart.
 * @module dsh-lark-cli/config
 */
import z from '@deepseek-ai/schemastery';
import type { Volatile } from '@deepseek-ai/cordis';

/** Bare command name resolved on PATH by default. */
export const DEFAULT_EXECUTABLE = 'lark-cli';

/**
 * Explicit native binary (absolute path) used when {@link DEFAULT_EXECUTABLE}
 * resolves to a Windows shell shim (`.cmd` / `.bat`), which cannot be spawned
 * without a shell. Empty means "auto-detect next to the shim".
 */
export const DEFAULT_NATIVE_EXECUTABLE = '';

/** Oldest lark-cli version whose command surface these skills were snapshotted against. */
export const DEFAULT_MIN_VERSION = '1.0.96';

/** Per-call wall-clock budget handed to the child process. */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** In-memory stdout cap; overflow keeps the tail. */
export const DEFAULT_MAX_OUTPUT_BYTES = 512_000;

/** Full stdout spill-file cap, so a huge payload stays readable through the filesystem. */
export const DEFAULT_SPILL_MAX_BYTES = 64 * 1024 * 1024;

/** In-memory stderr cap (diagnostics only, a tail is enough). */
export const STDERR_MAX_BYTES = 32_000;

/** Termination grace handed to the subprocess provider. */
export const GRACE_MS = 3_000;

/** Model-facing render cap in characters, well below the stdout byte cap. */
export const RENDER_MAX_CHARS = 60_000;

/** Budget for the one-shot `--version` probe. */
export const VERSION_PROBE_TIMEOUT_MS = 15_000;

/** Windows shell shims that must be replaced by a real executable before spawning. */
export const SHELL_SHIM_PATTERN = /\.(?:cmd|bat)$/iu;

/** Where an npm-installed `@larksuite/cli` keeps its native binary, relative to a `node_modules` root. */
export const NATIVE_BINARY_RELATIVE = ['node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe'];

/** How many parent directories the native-binary auto-detection walks up from the shim. */
export const NATIVE_BINARY_SEARCH_DEPTH = 4;

/** Accepted identities; `user` acts as the signed-in person, `bot` as the app itself. */
export const IDENTITY_VALUES = ['user', 'bot'] as const;

/** One accepted identity. */
export type LarkIdentity = (typeof IDENTITY_VALUES)[number];

/** Exit code for a successful command. */
export const EXIT_SUCCESS = 0;

/** Exit code for `auth login`'s idempotent "already signed in" outcome. */
export const EXIT_ALREADY_AUTHENTICATED = 3;

/** Exit code for the high-risk-write confirmation gate. */
export const EXIT_CONFIRMATION_REQUIRED = 10;

/** Flag lark-cli's own hint points at for confirming a high-risk write. */
export const CONFIRMATION_FLAG = '--yes';

/** Skill directories shipped inside this package, in catalog order. */
export const SKILL_NAMES = [
  'lark-shared',
  'lark-doc',
  'lark-im',
  'lark-calendar',
  'lark-task',
  'lark-drive',
  'lark-sheets',
  'lark-base',
  'lark-wiki',
] as const;

/** Provider label registered in `ctx.skills` and stamped on every candidate. */
export const SKILL_PROVIDER_NAME = 'lark-cli';

/** Plugin config schema. */
export const Config = z.object({
  executable: z.string().min(1).default(DEFAULT_EXECUTABLE).volatile(),
  nativeExecutable: z.string().default(DEFAULT_NATIVE_EXECUTABLE).volatile(),
  minVersion: z.string().default(DEFAULT_MIN_VERSION).volatile(),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
  maxOutputBytes: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_BYTES).volatile(),
  spillMaxBytes: z.number().step(1).min(1).default(DEFAULT_SPILL_MAX_BYTES).volatile(),
  defaultAs: z.union(IDENTITY_VALUES).volatile(),
});

/** Plugin config as seen by `apply()`. */
export interface Config {
  /** Executable name or absolute path; defaults to `lark-cli` on PATH. */
  executable: Volatile<string>;
  /** Explicit `.exe` used when {@link executable} resolves to a Windows shim; empty auto-detects. */
  nativeExecutable: Volatile<string>;
  /** Oldest accepted lark-cli version; an older install is a hard error. */
  minVersion: Volatile<string>;
  /** Per-call child-process budget in milliseconds. */
  timeoutMs: Volatile<number>;
  /** In-memory stdout cap in bytes. */
  maxOutputBytes: Volatile<number>;
  /** Spill-file cap in bytes for truncated stdout. */
  spillMaxBytes: Volatile<number>;
  /** Identity injected as `LARKSUITE_CLI_DEFAULT_AS`; absent leaves lark-cli's own default. */
  defaultAs: Volatile<LarkIdentity | undefined>;
}
