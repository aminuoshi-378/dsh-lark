/**
 * Failure vocabulary for `dsh-lark-cli`.
 *
 * `LarkCliError` extends the harness error so the tool layer keeps a routable
 * `code` and the model still sees every actionable fact — the registry only
 * projects `name`/`code` of the error, so hints, missing scopes, and console
 * URLs must be baked into the message itself.
 * @module dsh-lark-cli/errors
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';

/** The configured executable could not be resolved on PATH. */
export const LARK_CLI_MISSING = 'LARK_CLI_MISSING';

/** The installed lark-cli is older than the supported command surface. */
export const LARK_CLI_VERSION_TOO_OLD = 'LARK_CLI_VERSION_TOO_OLD';

/** lark-cli ran and reported a failure (upstream error envelope or non-zero exit). */
export const LARK_CLI_ERROR = 'LARK_CLI_ERROR';

/** The call was cancelled or exceeded its own deadline. */
export const LARK_CLI_ABORTED = 'LARK_CLI_ABORTED';

/** The model supplied arguments that cannot be turned into an argv vector. */
export const LARK_CLI_INVALID_ARGV = 'LARK_CLI_INVALID_ARGV';

/** One routable lark-cli failure. */
export class LarkCliError extends HarnessError {
  /**
   * @param message - model-facing text; must carry every actionable fact.
   * @param code - one of the exported `LARK_CLI_*` codes.
   * @param options - original failure, when available.
   */
  constructor(message: string, code: string = LARK_CLI_ERROR, options?: ErrorOptions) {
    super(message, code, options);
    this.name = 'LarkCliError';
  }
}
