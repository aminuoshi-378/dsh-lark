# dsh-lark-cli

English | [简体中文](README.md)

In one sentence: **let your AI assistant operate Feishu for you directly** — send messages, write docs, check schedules, manage tasks, and work spreadsheets without leaving the chat.

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin for Feishu / Lark access. Once installed, you give instructions in natural language and the model drives the official `lark-cli` through the `lark_cli` tool:

| You say | The model does |
|---|---|
| "Send the meeting notes to the product group" | `lark-im` posts the message to the chat |
| "Write a PRD from this material and save it to Docs" | `lark-doc` creates the doc and fills it in |
| "What meetings do I have next week" | `lark-calendar` queries your agenda |
| "Turn the to-dos in this sheet into tasks" | `lark-sheets` reads the data → `lark-task` creates tasks |
| "Add a page about X to the wiki" | `lark-wiki` creates the node → `lark-doc` writes the content |

Design principle: **the official `lark-cli` does the work, skills teach the model how to drive it** — execution and knowledge are separated.

- **One tool**: `lark_cli`, whose arguments are `argv` (the command split into words, without the leading `lark-cli`) plus an optional `stdin`. No shell, so no quoting, escaping, or injection surface.
- **Nine skills**: `lark-shared`, `lark-doc`, `lark-im`, `lark-calendar`, `lark-task`, `lark-drive`, `lark-sheets`, `lark-base`, `lark-wiki`, shipped with the plugin and loaded on demand.
- **Zero credentials in the plugin**: login state and secrets stay with `lark-cli` (`~/.lark-cli/config.json` plus the system keychain). Nothing is stored or forwarded here.

## Requirements

| Item | Requirement |
|---|---|
| dsh compatibility | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) **>= 0.2.0-rc.2** (verified version; requires the `defineTool` / `ctx.subprocess` / `ctx.skills.registerProvider` plugin APIs and the `dsh.profile.bundles` bundle mechanism) |
| Operating system | **Windows 10/11** (primary verified platform, with built-in `.cmd` shim → `.exe` auto-detection); **macOS / Linux** should work (`lark-cli` itself is cross-platform) but are not individually verified |
| Node.js | >= 22.0.0 |
| lark-cli | >= 1.0.96 (`npm install -g @larksuite/cli`) |
| Network | Access to the Feishu OpenAPI endpoints |

## Prerequisites

1. `lark-cli` >= 1.0.96 installed: `npm install -g @larksuite/cli`.
2. CLI-side setup and login done once in a terminal:
   - `lark-cli config init` (first run, configure the app)
   - `lark-cli auth login` / `lark-cli auth status` (confirm the identity)

The plugin never logs in and never stores appId / appSecret.

## Install

All four install options are **one-shot**: run the command inside `~/.dsh/profiles/web` and dependency registration, build artifacts, and node_modules resolution all happen at once — afterwards only one registration line in `cordis.patch.yml` plus a restart is needed. The options differ only in package source: git repo, GitHub URL, Release tarball, or model-delegated.

Unless noted, run the commands inside `~/.dsh/profiles/web`.

### Option 1: git dependency (recommended)

Register the repo as a git dependency in the profile:

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-lark-cli@github:aminuoshi-378/dsh-lark#v0.1.0
```

> How it parses: `dsh-lark-cli` is the package name (must match the repo's `package.json` `name`); `@github:user/repo#v0.1.0` installs from GitHub (`#` takes a tag or branch: `#v0.1.0`, `#main`). pnpm shallow-clones → runs the package's `prepare` script (auto-builds `dist/` via tsc) → installs what `files` declares (`dist / cordis.yml / skills`) into the profile's `node_modules`.
>
> `#v0.1.0` pins a version; `#main` tracks the latest code. Pinning is recommended.

### Option 2: Release tarball

No git needed — register the Release tarball URL directly as a tarball dependency; pnpm downloads, unpacks, auto-builds, and places it into `node_modules` in one step:

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-lark-cli@https://github.com/aminuoshi-378/dsh-lark/archive/refs/tags/v0.1.0.tar.gz
```

(Replace `v0.1.0` with the target version; URLs per release are on the [Releases](https://github.com/aminuoshi-378/dsh-lark/releases) page. Manually downloading, unpacking, and running `npm install` also works, but the one-liner is easier.)

### Option 3: local source via link

Best when you plan to modify skills or source — clone and build first, then point the profile at it:

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install && npm run build

# back in the profile directory
cd ~/.dsh/profiles/web
pnpm add dsh-lark-cli@link:<absolute path of the clone>
```

A `link:` dependency points at the local directory, so source/skill edits take effect immediately (after restarting `dsh web`) with no re-publish.

### Option 4: prompt-driven install (let the AI session do it)

Paste this into a dsh chat and the model performs the install for you (defaults to Option 1's git dependency — the easiest path):

```text
Please install the dsh-lark-cli plugin for me:
1. Inside ~/.dsh/profiles/web run
   pnpm add dsh-lark-cli@github:aminuoshi-378/dsh-lark#v0.1.0
2. Following the README "Mount into a profile" section, append the lark-cli
   entry to cordis.patch.yml;
3. Run dsh --profile web --dump-config and verify the lark-cli entry appears.
```

The model executes each step with its shell tool; writes to profile config files are outside the workspace, so it will ask for your approval first.

## Mount into a profile

After Options 1 / 2 / 4 the package is already installed at `~/.dsh/profiles/web/node_modules/dsh-lark-cli` — only registration remains; Option 3's `pnpm add` already handled both registration and linking. The finish line is the same either way:

1. Append `"dsh-lark-cli"` to `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json` (pnpm add already wrote the `dependencies` entry — no manual edit needed).
2. Append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: lark-cli
  name: 'dsh-lark-cli'
  config:
    executable: lark-cli
    timeoutMs: 60000
```

3. Restart `dsh web`. Verify: no `did not activate` warning on startup, and `dsh --profile web --dump-config | grep lark-cli` shows the entry.

Rollback: `pnpm remove dsh-lark-cli`, remove the bundles entry and the cordis.patch.yml block, then restart.

## Upgrading

When a new version is released, update according to how you installed; the `cordis.patch.yml` registration and bundles declaration never need changes — just restart `dsh web` after updating.

**Option 1 (git dependency)**: re-add with the new tag (or track main):

```bash
cd ~/.dsh/profiles/web
pnpm add dsh-lark-cli@github:aminuoshi-378/dsh-lark#<new tag>
```

**Option 2 (tarball)**: re-run `pnpm add` with the new version in the URL.

**Option 3 (link source)**: in the clone run `git pull && npm install && npm run build`, then restart `dsh web`.

For Option 4, just send the matching command to the model. **Check your version**: look at the `dsh-lark-cli` entry in the profile's `package.json`, or the `version` field of `node_modules/dsh-lark-cli/package.json`; release notes live on the [Releases](https://github.com/aminuoshi-378/dsh-lark/releases) page. After upgrading, run `npm test` once in the plugin directory to confirm the environment is healthy.

## Skills

Nine skills ship with the plugin; the model loads the relevant one per task. Each skill directory also carries `references/` sub-documents (read on demand by relative path) with finer-grained command syntax and scenario playbooks.

### `lark-shared` — shared rules & auth (required reading)

The common foundation for every Feishu operation: identity selection (`--as user` vs `--as bot`), auth and login-state troubleshooting, the JSON output contract, the high-risk write confirmation gate, and the key "**in dsh**" execution rule — no shell here; every `lark-cli` command is split into `lark_cli` tool `argv` (how to rewrite pipes / `&&` / redirections, and how to filter with `--jq`). The model reads this skill before using any other lark skill.

### `lark-doc` — cloud docs / Docx

Create, read, and update docs (including the XML block-level structure), Markdown round-trip, version history; insert and download images/attachments; mind notes; whiteboards; a dozen writing-genre templates (PRD, weekly report, meeting minutes, Xiaohongshu, official letters, research reports, ... in `references/genres/`); plus create-then-run-workflow combos.

### `lark-im` — messaging

Send / reply / edit / unsend semantics for DMs and group messages; message and chat search; group members, settings, and topic groups; interactive cards (full Card 2.0 component schema: buttons, forms, charts, columns, images, ...); reactions; urgent pings (in-app / SMS / phone call); feed pins and tag management.

### `lark-calendar` — calendar

Event create / update / cancel (including recurring RRULE events), all-day and fuzzy time expressions, attendee management and RSVP, free/busy queries and slot suggestions, meeting-room search and booking, cross-calendar event transfer, event-to-meeting (video conference) relations.

### `lark-task` — tasks

Task create / update / complete / reopen, subtask decomposition and ancestor setting, tasklist management and members, task search and related-task queries, collaborators and followers, reminders and attachment upload, task-agent registration/unregistration and homepage data.

### `lark-drive` — drive

Browse / search / move / copy / delete files, upload and download (including export to docx/sheet formats), folders, shortcuts, version history; comments and replies (with reactions); permissions (member management, settings, permission requests); secure labels; plus several multi-step playbooks: knowledge organization, topic-move collectors, permission governance.

### `lark-sheets` — spreadsheets

Sheet and row/column structure (add/remove, merge, freeze, group, hide), cell read/write (values / formulas / styles / comments / in-cell images), range copy-move-sort, pivot tables, conditional formatting, dropdowns, charts and sparklines, floating images, formula validation; Excel / CSV import and export.

### `lark-base` — Bitable

Data tables and fields, record CRUD and batch operations, views, grouping / filtering / sorting, formula and lookup fields, form views, dashboards, automation workflows (including the AI text-generation action), field-extension bulk writes, roles and permissions, templates; AppMode (Base app) pages and components; `.base` file import/export.

### `lark-wiki` — knowledge base

Wiki space list, node tree browsing and search, node create / move / copy / delete, space member management; plus the "wiki URL → underlying object token" routing rule (a `/wiki/` link is unwrapped to a docx/sheet/bitable and routed to the matching skill).

> Each skill's directory is exposed through `resourceBase`, so `references/...` links resolve by relative path.

## Tests

```bash
npm test              # pure functions + skill snapshot + registration behaviour (offline)
npm run test:tool     # real lark-cli: auth status / calendar +agenda / error routing / argv defence
npm run test:live     # read-only probe: resolution path, --version, auth status
```

