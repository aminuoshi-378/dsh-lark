# dsh-lark-cli

Feishu / Lark access for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).

Design principle: **the official `lark-cli` does the work, skills teach the model how to drive it** — execution and knowledge are separated.

- **One tool**: `lark_cli`, whose arguments are `argv` (the command split into words, without the leading `lark-cli`) plus an optional `stdin`. No shell, so no quoting, escaping, or injection surface.
- **Nine skills**: `lark-shared`, `lark-doc`, `lark-im`, `lark-calendar`, `lark-task`, `lark-drive`, `lark-sheets`, `lark-base`, `lark-wiki`, shipped with the plugin and loaded on demand.
- **Zero credentials in the plugin**: login state and secrets stay with `lark-cli` (`~/.lark-cli/config.json` plus the system keychain). Nothing is stored or forwarded here.

## Prerequisites

1. `lark-cli` >= 1.0.96 installed: `npm install -g @larksuite/cli`.
2. CLI-side setup and login done once in a terminal:
   - `lark-cli config init` (first run, configure the app)
   - `lark-cli auth login` / `lark-cli auth status` (confirm the identity)

The plugin never logs in and never stores appId / appSecret.

## Install

```bash
cd D:/Code/projects/dsh-lark-cli
npm install          # only typescript and @types/node; skip when already present
npm run build        # produces dist/
```

Wire it into a profile (`web` shown here):

1. `~/.dsh/profiles/web/package.json`
   - add `"dsh-lark-cli": "link:D:/Code/projects/dsh-lark-cli"` to `dependencies`
   - append `"dsh-lark-cli"` to `dsh.profile.bundles`
2. `~/.dsh/profiles/web/node_modules/dsh-lark-cli` must point at this repository (`pnpm install` creates it; otherwise create a directory link / junction yourself).
3. Append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: lark-cli
  name: 'dsh-lark-cli'
  config:
    executable: lark-cli
    timeoutMs: 60000
```

4. Restart `dsh web`. Verify: no `did not activate` warning on startup, and `dsh --profile web --dump-config | grep lark-cli` shows the entry.

Rollback: remove the three changes above and restart. The plugin repository and workspace are unaffected.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `executable` | `lark-cli` | Command name or absolute path, resolved through `ctx.subprocess.resolveExecutable` |
| `nativeExecutable` | empty | Windows fallback: when `executable` resolves to a `.cmd` / `.bat` (not spawnable without a shell), point this at the real `.exe`. Empty auto-detects `node_modules/@larksuite/cli/bin/lark-cli.exe` near the shim |
| `minVersion` | `1.0.96` | Older installs fail with `LARK_CLI_VERSION_TOO_OLD` (probed once per process) |
| `timeoutMs` | `60000` | Wall-clock budget per call; on expiry the child is terminated and `LARK_CLI_ABORTED` is raised |
| `maxOutputBytes` | `512000` | In-memory stdout cap; overflow keeps the tail |
| `spillMaxBytes` | `67108864` | Spill-file cap for truncated stdout; the path is reported back to the model |
| `defaultAs` | unset | Injects `LARKSUITE_CLI_DEFAULT_AS` (`user` / `bot`); unset keeps the CLI default |

Every field is volatile: a config change applies to the next call without a restart.

## Tool contract

- Arguments: `argv: string[]` (required, one array element per argument, no newlines) and `stdin?: string`.
- Exit-code routing:

| Exit | Meaning | Tool behaviour |
|---|---|---|
| 0 | success | Parses `{ok, identity, data, meta}` and renders it; non-JSON output is returned verbatim |
| 3 | `auth login` idempotent | Returned as success with an "already signed in" note |
| 10 | high-risk write confirmation gate | **Not an error**: returns `confirmationRequired: true` and tells the model to ask the user before retrying with the confirmation flag |
| other | failure | Throws `LarkCliError` (`LARK_CLI_ERROR`) whose message carries `hint` / `missing_scopes` / `console_url` |

- Exit 0 with `ok === false` is treated as a failure (defensive against upstream drift).
- Rendered text is capped at 60k characters with a `--jq` / `--page-size` hint, and the spill path is reported when present.
- The working directory is the session workspace root, so `--file` / `--output` / `@file` must be relative paths.

## Skills

| Skill | Covers |
|---|---|
| `lark-shared` | Identity, auth, output contract, high-risk approval, **the dsh execution-channel rules** |
| `lark-doc` | Docs read/write, media, mind notes |
| `lark-im` | Messages, chats, cards, urgent pings |
| `lark-calendar` | Events, attendees, meeting rooms |
| `lark-task` | Tasks, task lists, task agents |
| `lark-drive` | Drive files, permissions, import/export |
| `lark-sheets` | Sheets structure, cells, charts, pivot tables |
| `lark-base` | Bitable, views, forms, dashboards |
| `lark-wiki` | Wiki spaces, node trees, wiki members |

Each skill's directory is exposed through `resourceBase`, so `references/...` links resolve by relative path.

## Tests

```bash
npm test              # pure functions + skill snapshot + registration behaviour (offline)
npm run test:tool     # real lark-cli: auth status / calendar +agenda / error routing / argv defence
npm run test:live     # read-only probe: resolution path, --version, auth status
```

## Known limitations

- **References were not rewritten line by line**: the nine skills contain 432 hits of `| jq`, `&&`, `$(...)`, `2>&1`, and bash fences. Following the plan's engineering threshold (> 50 hits), a single governing rule in `lark-shared` ("split shell composition into multiple `lark_cli` calls, filter with `--jq`") is used instead. Roughly 100% of hits remain unchanged.
- **High-risk confirmation (exit 10) is not verified against a real write**: that needs a throwaway object the user owns plus explicit consent.
- **Skill snapshot drift**: skills are a 1.0.97 snapshot. Refresh them after a CLI upgrade using the steps below.
- **Windows with only a `.cmd` shim**: if auto-detection fails, set `nativeExecutable` explicitly (e.g. `D:/dev-cache/node_cache/node_modules/@larksuite/cli/bin/lark-cli.exe`).
- **P0 only**: the P1 skills (slides / markdown / contact / approval / meeting, ...) are not bundled.

## Refreshing the skill snapshot

```bash
lark-cli update
SRC="<upstream skill snapshot directory>"
for s in lark-shared lark-doc lark-im lark-calendar lark-task lark-drive lark-sheets lark-base lark-wiki; do
  rm -rf "skills/$s" && cp -r "$SRC/$s" skills/
done
```

Then strip host-specific frontmatter fields from upstream (e.g. `metadata.ai.*`), re-add the one-line execution-channel note after each product skill's H1, re-insert the "in dsh" section in `lark-shared`, and run `npm test && npm run test:tool`.
