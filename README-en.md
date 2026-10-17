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

## Prerequisites

1. `lark-cli` >= 1.0.96 installed: `npm install -g @larksuite/cli`.
2. CLI-side setup and login done once in a terminal:
   - `lark-cli config init` (first run, configure the app)
   - `lark-cli auth login` / `lark-cli auth status` (confirm the identity)

The plugin never logs in and never stores appId / appSecret.

## Install

Three install options — pick one; after any of them, finish wiring with "[Mount into a profile](#mount-into-a-profile)".

### Option 1: one-shot build from the GitHub link (recommended)

Clone and build straight from GitHub, no prior local copy needed:

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install          # only typescript and @types/node
npm run build        # produces dist/
```

Or register the GitHub repo directly as a dependency (pnpm supports Git links):

```bash
# inside ~/.dsh/profiles/web
pnpm add dsh-lark-cli@github:aminuoshi-378/dsh-lark#main
```

### Option 2: build from source

Best when you plan to modify skills or source locally:

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install
npm run build
```

Then point the profile at your local directory with `link:` (see "Mount into a profile"); local edits take effect immediately with no re-publish.

### Option 3: prompt-driven install (let the AI session do it)

Paste this into a dsh chat and the model performs the install for you:

```text
Please install the dsh-lark-cli plugin for me:
1. Clone https://github.com/aminuoshi-378/dsh-lark locally;
2. Run npm install && npm run build in the repo;
3. Following the README "Mount into a profile" section, wire the plugin into
   ~/.dsh/profiles/web (package.json dependency + bundle + cordis.patch.yml);
4. Run dsh --profile web --dump-config and verify the lark-cli entry appears.
```

The model executes each step with its shell tool; writes to profile config files are outside the workspace, so it will ask for your approval first.

## Mount into a profile

After building via any option, mount the plugin into a profile (`web` shown here):

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

