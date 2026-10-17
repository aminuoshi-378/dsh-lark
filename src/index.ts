/**
 * `dsh-lark-cli` — Feishu/Lark access for DeepSeek Harness.
 *
 * Shape: the official `lark-cli` is the execution backend, a single generic
 * `lark_cli` tool is the execution channel, and the bundled `lark-*` skills
 * carry every piece of domain knowledge. Credentials never enter this plugin:
 * lark-cli owns its own login state and keychain.
 * @module dsh-lark-cli
 */
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import { SKILL_PROVIDER_NAME } from './config.js';
import { registerSkillProvider } from './skills.js';
import { createLarkCliTool, TOOL_NAME, type LarkCliToolOptions } from './tool.js';

export { Config, DEFAULT_EXECUTABLE, DEFAULT_MIN_VERSION } from './config.js';
export type { Config as LarkCliConfig, LarkIdentity } from './config.js';
export {
  LarkCliError,
  LARK_CLI_ABORTED,
  LARK_CLI_ERROR,
  LARK_CLI_INVALID_ARGV,
  LARK_CLI_MISSING,
  LARK_CLI_VERSION_TOO_OLD,
} from './errors.js';
export {
  buildEnv,
  classifyExit,
  compareVersions,
  parseEnvelope,
  parseVersion,
  truncateRender,
  validateArgv,
  type LarkEnvelope,
  type LarkErrorBody,
  type LarkResult,
} from './runner.js';
export { parseSkill } from './skills.js';
export { createLarkCliTool, TOOL_NAME, type LarkCliToolOptions } from './tool.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'lark-cli';

/** Capability seams this plugin consumes. */
export const inject: string[] = ['tools', 'subprocess', 'skills'];

/** Absolute path of the bundled skills directory. */
const SKILL_ROOT = fileURLToPath(new URL('../skills', import.meta.url));

/**
 * Register the `lark_cli` tool and the bundled lark skills.
 * @param ctx - plugin context carrying the tool, subprocess, and skill seams.
 * @param config - volatile plugin config; every field is re-read per call.
 */
export function apply(ctx: Context, config: import('./config.js').Config): void {
  const resolveOptions = (): LarkCliToolOptions => ({
    executable: config.executable.get(),
    nativeExecutable: config.nativeExecutable.get(),
    minVersion: config.minVersion.get(),
    timeoutMs: config.timeoutMs.get(),
    maxOutputBytes: config.maxOutputBytes.get(),
    spillMaxBytes: config.spillMaxBytes.get(),
    defaultAs: config.defaultAs.get(),
  });

  ctx.tools.register(createLarkCliTool(ctx, resolveOptions));
  registerSkillProvider(ctx, SKILL_ROOT);
  ctx.logger(SKILL_PROVIDER_NAME).info(`registered the ${TOOL_NAME} tool`);
}
