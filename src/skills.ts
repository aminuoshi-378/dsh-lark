/**
 * Bundled `lark-*` skills as a `ctx.skills` provider.
 *
 * The skills are the model's entire knowledge of lark-cli: which command to run,
 * which identity to use, and which writes need approval. They are read from the
 * package's own `skills/` directory at apply time, so a `link:` install and a
 * published tarball behave identically.
 * @module dsh-lark-cli/skills
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { BUNDLED_SKILL_RANK, type SkillCandidate } from '@deepseek-ai/dsh-skill';
import { SKILL_NAMES, SKILL_PROVIDER_NAME } from './config.js';

/** Parsed SKILL.md frontmatter and body. */
interface ParsedSkill {
  name?: string;
  description: string;
  /** Instruction body with the frontmatter block removed. */
  body: string;
}

/** The leading `--- ... ---` block, when present. */
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

/** Strip one layer of matching YAML quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted =
    trimmed.length >= 2
    && ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"')));
  return quoted ? trimmed.slice(1, -1).replace(/''/gu, "'") : trimmed;
}

/**
 * Read one flat `key: value` frontmatter field. Nested maps are ignored on
 * purpose: the only two fields this provider needs are top-level scalars.
 * @param block - frontmatter text without its `---` fences.
 * @param field - top-level key.
 * @returns the unquoted value, or `undefined` when absent or non-scalar.
 */
function readField(block: string, field: string): string | undefined {
  const prefix = `${field}:`;
  for (const line of block.split(/\r?\n/u)) {
    if (!line.startsWith(prefix)) continue;
    const value = unquote(line.slice(prefix.length));
    if (value.length > 0) return value;
  }
  return undefined;
}

/**
 * Split one SKILL.md into its frontmatter fields and instruction body.
 * @param raw - file contents.
 * @param path - file path, used only in the error message.
 * @returns the parsed skill.
 * @throws when the frontmatter or its description is missing.
 */
export function parseSkill(raw: string, path: string): ParsedSkill {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (match?.[1] === undefined) throw new Error(`${path}: no YAML frontmatter`);
  const block = match[1];
  const description = readField(block, 'description');
  if (description === undefined) throw new Error(`${path}: frontmatter has no single-line description`);
  return {
    ...(readField(block, 'name') === undefined ? {} : { name: readField(block, 'name') }),
    description,
    body: raw.slice(match[0].length).trim(),
  };
}

/**
 * Register the bundled skills with the skill registry.
 *
 * A single unreadable skill is logged and skipped: a broken snapshot must never
 * stop the plugin from activating, because the tool itself stays useful.
 * @param ctx - plugin context carrying the skill registry.
 * @param assetRoot - absolute path of the package's `skills/` directory.
 */
export function registerSkillProvider(ctx: Context, assetRoot: string): void {
  const logger = ctx.logger(SKILL_PROVIDER_NAME);
  const candidates: SkillCandidate[] = [];

  for (const skillName of SKILL_NAMES) {
    const directory = join(assetRoot, skillName);
    const path = join(directory, 'SKILL.md');
    try {
      const parsed = parseSkill(readFileSync(path, 'utf8'), path);
      if (parsed.name !== undefined && parsed.name !== skillName) {
        logger.warn(`skill directory ${skillName} declares name "${parsed.name}"; using the declared name`);
      }
      candidates.push({
        name: parsed.name ?? skillName,
        description: parsed.description,
        invocation: { modelInvocable: true, userInvocable: true },
        provider: SKILL_PROVIDER_NAME,
        source: 'bundled',
        rank: BUNDLED_SKILL_RANK,
        path,
        resourceBase: { kind: 'directory', path: directory },
        locator: path,
      });
    } catch (error) {
      logger.warn(`skipping bundled skill ${skillName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (candidates.length === 0) {
    logger.warn(`no bundled lark skills were readable under ${assetRoot}`);
    return;
  }

  ctx.skills.registerProvider(() => ({
    name: SKILL_PROVIDER_NAME,
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate;
      const raw = await readFile(String(locator), { encoding: 'utf8', signal: options.signal });
      return { ...summary, content: parseSkill(raw, String(locator)).body };
    },
  }));

  logger.info(`registered ${String(candidates.length)} bundled lark skills`);
}
