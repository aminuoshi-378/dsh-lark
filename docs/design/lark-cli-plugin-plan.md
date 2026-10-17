# dsh-lark-cli 插件实现方案

> 目标：为 DeepSeek Harness（dsh）提供飞书接入插件，设计原则——
> **lark-cli 作为后端执行 + skills 教模型如何使用**。
> 本文是实施级方案，不含完整实现代码，只到「文件清单 + 关键签名 + 命令 + 验收」粒度。

## 1. 已确认决策

| 决策项 | 结论 |
|---|---|
| 执行形态 | 专用 `lark_cli` 工具（`defineTool` + `ctx.subprocess` spawn lark-cli），**不做**纯 shell 路线 |
| 技能范围 | v1 搬 P0 核心 9 个：`lark-shared`、`lark-doc`、`lark-im`、`lark-calendar`、`lark-task`、`lark-drive`、`lark-sheets`、`lark-base`、`lark-wiki`（wiki 为知识库场景必需，见 §7.7） |
| 项目位置 | `D:/Code/projects/dsh-lark-cli`，包名 `dsh-lark-cli`，cordis 插件名/id `lark-cli` |
| 交付范围 | 插件仓库 + 装载进 `~/.dsh/profiles/web/` + 重启真实会话验收 |

## 2. 架构总览

```
模型
 ├─ skill 工具 / 技能目录（dsh 原生）
 │    └─ 8 个 lark-* 技能：教「什么场景、跑什么命令、要注意什么」
 └─ lark_cli 工具（本插件注册）
      ├─ 参数：argv[] + 可选 stdin（不做 23 域结构化 action 面）
      ├─ 执行：ctx.subprocess.resolveExecutable → spawn → 收集 stdout/stderr
      ├─ 语义：注入干净环境变量、解析 JSON 信封、退出码分流（0 / 3 / 10 / 其他）
      └─ 后端：lark-cli（官方 CLI，凭据与登录态由它自管，插件不碰密钥）
                          └─ 飞书 OpenAPI
```

三条边界：
- **知识在技能**：命令怎么拼、身份选哪个、错误怎么恢复，全在 `skills/`，插件代码不含业务判断。
- **执行在工具**：工具只做「安全执行 + 信封解析 + 错误分类」，不做领域路由。
- **凭据在 lark-cli**：`~/.lark-cli/config.json` + 系统 keychain，插件零凭据配置，不做 appId/appSecret 管理。

## 3. 关键设计决策

### 3.1 为什么是泛型 argv，而不是 23 域结构化 action

- lark-cli 有 23 个业务域、数百个命令，且优先级是 `+shortcut` > typed command > `api` 裸调；结构化 action 面等于把 CLI 命令表再抄一遍，必然随 CLI 版本腐烂。
- 技能的 references 里本来就写满了 `lark-cli docs +fetch --url ...` 这类命令；让模型「把命令行切词成 argv」是零信息损耗的映射，改造量最小。
- 工具的增值点在**执行通道**而非参数建模：不过 shell（无转义/注入问题）、argv 强类型校验、收集截断、signal 透传、信封解析、错误码保留。

### 3.2 退出码分流（契约见下表）

| 退出码 | 含义 | 工具行为 |
|---|---|---|
| 0 | 成功，stdout 为 JSON 信封 `{ok:true,identity,data,meta}` | 解析并渲染；非 JSON 输出（`--format text`）原样返回文本 |
| 3 | `auth login` 幂等「已登录」 | 有 JSON 信封按信封走；无信封按成功返回并附注 |
| 10 | `high-risk-write` 确认门禁 | **不抛错**，返回结构化结果 `confirmationRequired: true`（含 action/risk/message/hint），教模型先问用户、同意后把 `--yes` 追加到原 argv 重试 |
| 其他非 0 | 失败，stderr 为错误信封 `{ok:false,error:{type,subtype,code,message,hint,missing_scopes}}` | 抛 `LarkCliError extends HarnessError`，message 拼入 hint、missing_scopes、console_url（工具层只保留 name/code，所以可操作信息必须进 message） |

补充：退出码 0 但信封 `ok === false` 时按错误处理（防御上游行为漂移）；`signal` 已 abort 时抛 `LARK_CLI_ABORTED`。

### 3.3 工作目录与环境变量

- **cwd**：取 `exec.agent?.session.header.cwd`（会话工作区根，与 bash 工具同源），缺失时回退 `process.cwd()`。理由：lark-cli 的 `--file`/`--output` 只接受 **cwd 下相对路径**，cwd 必须与会话工作区一致，技能里的相对路径才成立。
- **env**：`ctx.subprocess` 的父环境默认已脱敏（剥离凭据形状变量与 `DSH_*`），显式传入的条目会保留。本插件注入：
  - `LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1`
  - `LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1`
  - `LARKSUITE_CLI_DEFAULT_AS=<defaultAs>`（仅当配置了 `defaultAs`）
- 不注入 access token：凭据由 lark-cli 自己从 keychain/config 读取。

### 3.4 技能供货方式

仿 `dsh-skill-office`（`@deepseek-ai/dsh-skill-office/lib/index.js:54-96`）：插件 `apply()` 里
`ctx.skills.registerProvider(() => provider)`，provider 的 `list()/get()` 从包内 `skills/` 目录读文件。
- candidate 带 `rank: BUNDLED_SKILL_RANK`（600）、`source: 'bundled'`、`resourceBase: {kind:'directory', path}`、`locator`。
- `resourceBase` 会让 dsh 在技能内容外套 `<skill_resources>Base directory for this skill: <path></skill_resources>`，模型据此按相对路径 Read references。
- rank 600 保证用户级技能（~/.dsh/skills rank 400、~/.agents/skills rank 500）可覆盖同名技能。
- 单个技能文件缺失时 warn 并跳过，不让插件激活失败。

## 4. 文件树

```
D:/Code/projects/dsh-lark-cli/
├── package.json                  # dsh.bundle.patch + optional peerDeps + files:[dist,cordis.yml,skills]
├── cordis.yml                    # bundle patch：insert 一行 id: lark-cli
├── tsconfig.json                 # 照抄 dsh-web-search-tavily（ES2022/NodeNext 或 bundler/strict）
├── .gitignore                    # node_modules/ dist/ *.tgz
├── .npmrc                        # verify-deps-before-run=false（@deepseek-ai/* 不在公开 registry）
├── README.md                     # 中文：它是什么、装什么、怎么用、限制
├── README-en.md                  # 英文，内容与中文一致
├── CHANGELOG.md                  # 只记架构级/不兼容改动
├── docs/
│   ├── design/
│   │   └── lark-cli-plugin-plan.md      # 本文
│   └── changelog/
│       └── YYYYMMDD-HHmm-001.md         # 会话级细粒度记录
├── skills/                       # 9 个 lark-* 技能快照
│   ├── lark-shared/{SKILL.md,references/*.md}
│   ├── lark-doc/{SKILL.md,references/*.md,references/genres/*.md}
│   ├── lark-im/…
│   ├── lark-calendar/…
│   ├── lark-task/…
│   ├── lark-drive/…
│   ├── lark-sheets/…
│   ├── lark-base/{SKILL.md,references/*.md}
│   └── lark-wiki/{SKILL.md,references/*.md}
├── src/
│   ├── index.ts                  # name / inject / Config / apply
│   ├── config.ts                 # 常量与默认值
│   ├── tool.ts                   # defineTool 定义（schema/output/execute）
│   ├── runner.ts                 # 纯函数：版本比较、信封解析、退出码分类、渲染截断
│   ├── errors.ts                 # LarkCliError + 错误码常量
│   └── skills.ts                 # 技能 provider（读包内 skills/）
├── test/
│   ├── smoke.mjs                 # 纯函数表驱动 + 错误类身份断言（无网络）
│   └── live.mjs                  # 手工验收：真实 spawn lark-cli --version / auth status
└── node_modules/@deepseek-ai/    # 手工 junction（不提交）
```

## 5. 阶段 0：骨架与依赖

### 5.1 package.json 要点

```json
{
  "name": "dsh-lark-cli",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "exports": { ".": { "default": "./dist/index.js" } },
  "files": ["dist", "cordis.yml", "skills"],
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit", "test": "node test/smoke.mjs" },
  "dependencies": { "@deepseek-ai/schemastery": "~3.18.4" },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/dsh-llm": "*",
    "@deepseek-ai/dsh-subprocess": "*",
    "@deepseek-ai/dsh-skill": "*"
  },
  "peerDependenciesMeta": { "…": { "optional": true } },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.6.0" },
  "dsh": { "bundle": { "patch": "./cordis.yml" } },
  "engines": { "node": ">=22.0.0" }
}
```

（peerDependencies 全部 optional；不要冒用 `@deepseek-ai/` scope。）

### 5.2 cordis.yml

```yaml
- insert:
    - id: lark-cli
      name: 'dsh-lark-cli'
      config: {}
```

### 5.3 junction（关键，决定 instanceof 是否成立）

PowerShell 逐个创建，目标统一指向 harness 同一份 realpath：

```powershell
$targets = 'cordis','schemastery','dsh-tools','dsh-llm','dsh-subprocess','dsh-skill'
$base = 'D:\dev-cache\node_cache\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai'
New-Item -ItemType Directory -Force -Path 'D:\Code\projects\dsh-lark-cli\node_modules\@deepseek-ai' | Out-Null
foreach ($t in $targets) {
  New-Item -ItemType Junction -Path "D:\Code\projects\dsh-lark-cli\node_modules\@deepseek-ai\$t" -Target "$base\$t"
}
```

验收：`node -e "import('@deepseek-ai/dsh-llm').then(m=>console.log(path.realpathSync(require.resolve(...))))"` 或在 smoke 里断言 `new LarkCliError(...) instanceof HarnessError === true`。

### 5.4 阶段出口

`npm run build` + `npm run typecheck` 通过；`dist/index.js` 可被 `import`；smoke 空跑（仅身份断言）。

## 6. 阶段 1：lark_cli 工具

### 6.1 Config（`src/config.ts`）

```ts
export const Config = z.object({
  executable: z.string().default('lark-cli').volatile(),
  minVersion: z.string().default('1.0.96').volatile(),
  timeoutMs: z.number().step(1).min(1).default(60_000).volatile(),
  maxOutputBytes: z.number().step(1).min(1).default(512_000).volatile(),
  spillMaxBytes: z.number().step(1).min(1).default(64 * 1024 * 1024).volatile(),
  defaultAs: z.union(['user', 'bot'] as const).volatile(),
})
```

全部 volatile：改配置下一调用即生效，无需重启。

### 6.2 工具定义（`src/tool.ts`）

```ts
defineTool({
  name: 'lark_cli',
  description:
    'Run an official lark-cli (Feishu/Lark) subcommand and return its JSON envelope. ' +
    'Pass the command as argv without the leading "lark-cli" (e.g. ["docs","+fetch","--url","<url>"]). ' +
    'Read the lark-shared and product skills (lark-doc, lark-im, lark-calendar, lark-task, ' +
    'lark-drive, lark-sheets, lark-base) for exact syntax, identity (--as user|bot) and safety rules. ' +
    'Exit code 10 means a high-risk write requires explicit user confirmation: ask the user, ' +
    'then retry with the suggested confirmation flag appended.',
  parameters: {
    argv: { type: 'array', required: true, items: { type: 'string' },
            description: 'lark-cli arguments, e.g. ["im","+send-text","--chat-id","oc_..."]' },
    stdin: { type: 'string', description: 'Optional bytes written to stdin (for @- style data input).' },
  },
  output: {
    schema: { type: 'object', additionalProperties: false,
      properties: {
        ok: { type: 'boolean', required: true },
        exitCode: { type: 'number' },
        text: { type: 'string', required: true },
        confirmationRequired: { type: 'boolean' },
      } },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  timeoutMs: cfg.timeoutMs,
  isConcurrencySafe: () => false,
  async execute(args, exec) { … },
})
```

### 6.3 execute 流程

1. `argv` 防御：非空数组、元素均为字符串；拒绝含换行的元素（防误把整条命令行当单参数）。
2. `const exe = await ctx.subprocess.resolveExecutable(cfg.executable)`；失败 → `LARK_CLI_MISSING`（message 给安装命令 `npm install -g @larksuite/cli`）。
3. 版本门禁（闭包缓存，per-process 只查一次）：spawn `--version`，正则取 `\d+\.\d+\.\d+`，低于 `minVersion` → `LARK_CLI_VERSION_TOO_OLD`（message 给 `lark-cli update`）。
   版本检查失败（spawn 异常）→ 不阻断本次调用，只在结果文本里附警告。
4. `ctx.subprocess.spawn({ argv: [exe, ...argv], cwd, graceMs: 3_000, signal: exec.signal,
   stdio: { stdin: args.stdin !== undefined ? { data: args.stdin } : 'ignore',
            stdout: { maxBytes: cfg.maxOutputBytes, spill: { maxBytes: cfg.spillMaxBytes } },
            stderr: { maxBytes: 32_000 } },
   env: buildEnv(cfg) })`
   - `cwd = exec.agent?.session.header.cwd ?? process.cwd()`
5. `const outcome = await handle.done`；`exitCode = outcome.exitCode ?? -1`。
6. 读取 `handle.collected.stdout.readFrom(0)` / `stderr.readFrom(0)`。
7. 分流（见 §3.2）：`classify(exitCode, stdout, stderr)` → `{kind:'ok'|'confirmation'|'error', …}`。
8. 渲染文本：`[identity: user] exit 0` + 信封 data 的压缩 JSON（或原始文本）；超过 `RENDER_MAX_CHARS = 60_000` 时截断并提示「用 `--jq` 收窄字段或分页拉取」；`truncated.spillPath` 存在时把路径告知模型（可 Read）。

### 6.4 纯函数（`src/runner.ts`，全部可单测）

- `parseEnvelope(text): Envelope | undefined` — 容忍前后空白；失败返回 undefined（走原文路径）。
- `classifyExit(exitCode, stdout, stderr): Result` — 覆盖 0/3/10/其他/信号。
- `compareVersions(a, b): number` — 数值分段比较，不引依赖。
- `buildEnv(cfg): NodeJS.ProcessEnv`。
- `truncateRender(text, maxChars): string`。

### 6.5 错误类（`src/errors.ts`）

```ts
export class LarkCliError extends HarnessError {}   // 从 @deepseek-ai/dsh-llm 导入 HarnessError
export const LARK_CLI_MISSING = 'LARK_CLI_MISSING';
export const LARK_CLI_VERSION_TOO_OLD = 'LARK_CLI_VERSION_TOO_OLD';
export const LARK_CLI_ERROR = 'LARK_CLI_ERROR';      // 上游错误信封
export const LARK_CLI_ABORTED = 'LARK_CLI_ABORTED';
```

message 里必须自带可操作信息：`hint`、`missing_scopes`、`console_url`（工具层只保留 name/code，UI 与模型看不到挂载字段）。

### 6.6 阶段出口

typecheck/build 通过；smoke 表驱动用例全绿（信封 ok/error/exit10/非 JSON/exit3/空输出、版本比较、渲染截断）；错误类身份断言通过。

## 7. 阶段 2：技能移植

### 7.1 复制

```bash
SRC="<上游技能快照目录>"
DST="D:/Code/projects/dsh-lark-cli/skills"
for s in lark-shared lark-doc lark-im lark-calendar lark-task lark-drive lark-sheets lark-base lark-wiki; do
  cp -r "$SRC/$s" "$DST/$s"
done
```

（快照基线：lark-cli 1.0.97。后续刷新：`lark-cli update` 后重跑复制 + 重做 §7.2 改造。）

### 7.2 frontmatter 改造

| 原字段 | 处理 |
|---|---|
| `name` / `description` | 原样保留（dsh 必填字段，均已具备） |
| `metadata.requires`（内联 JSON 串） | 保留（dsh 透传不解析）；在 README 注明「dsh 不强制技能依赖，路由靠 description」 |
| `metadata.cliHelp` | 保留 |
| `metadata.ai.*` 等宿主标识字段 | 删除（宿主标识无意义，且避免误导） |
| 其他（`allowed-tools` 等） | 若出现则删除 |

### 7.3 正文最小改造

**lark-shared/SKILL.md**（唯一必须重写的文件）：在「通用准则」最前插入一节：

```markdown
## 在 dsh 中执行（lark_cli 工具）

本环境不用 shell 跑命令：所有 `lark-cli <args>` 一律调用 `lark_cli` 工具，
argv 为命令切词（去掉开头的 `lark-cli`，不要引号、不要 `| && > 2>&1`、不要 `sh -c`）。
例：`lark-cli docs +fetch --url <url> --as user` → `lark_cli({argv:["docs","+fetch","--url","<url>","--as","user"]})`。
工具已注入 `LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1` 与 `LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1`，无需手动前置。
退出码 10 会被工具转成 `confirmationRequired: true` 的结构化结果：按「高风险确认」流程先问用户，
再带确认 flag（通常 `--yes`）重试，不要把它当报错。
工作目录是会话工作区根；`--file` / `--output` 等路径参数一律写工作区下的相对路径。
```

同时改掉该文件里「命令前加 `LARKSUITE_CLI_NO_...`」的 shell 写法为「工具已自动注入」。

**其余 7 个 SKILL.md**：正文无需改动（命令示例作为 argv 规格仍然有效），只做 §7.2 的 frontmatter 清理。

**references 机械审计**（复制后执行，逐条修）：

```bash
grep -rn -E '\| *jq|LARKSUITE_CLI_|\| *grep|2>&1|&&|\|\||\$\(|sh -c|```bash' skills/
```

处置规则：
- 管道/重定向/`&&` → 拆成多次调用；筛选改用 `--jq` 参数（lark-cli 原生支持）。
- 环境变量前缀 → 删除（工具已注入）。
- `bash` 代码块内的多步脚本 → 改写成步骤列表 + 对应 argv 示例。
- 工程量评估：若命中数 < 50 条，逐条手改；若更多，在 lark-shared 增加一条「所有 shell 组合语法一律拆解」的总规则并在 README 记录未逐条清理的占比。

### 7.4 技能 provider（`src/skills.ts`）

```ts
const SKILL_NAMES = ['lark-shared','lark-doc','lark-im','lark-calendar','lark-task','lark-drive','lark-sheets','lark-base','lark-wiki'];

// apply 时：逐个读 <pkg>/skills/<name>/SKILL.md，解析 frontmatter 的 name/description
// 失败则 warn 跳过（不阻断插件激活）
ctx.skills.registerProvider(() => ({
  name: 'lark-cli',
  async list() { return catalog; },              // catalog: candidates（rank 600, source bundled, resourceBase, locator）
  async get(candidate) { return { ...candidate, content: readFileSync(candidate.locator, 'utf8') }; },
}));
```

包内路径用 `import.meta.url` 定位（`new URL('../skills', import.meta.url)`），保证 link: 装载下也正确。

### 7.5 工具与技能互相指引

- 工具 description 末句：*"Read the lark-shared / product skills first"*。
- lark-shared 首节写明工具契约。
- 每个产品技能首段保留原「何时使用」并补一句「执行统一走 `lark_cli` 工具」。

### 7.6 阶段出口

9 个技能文件齐全；`node -e` 跑 provider 的 list/get 冒烟（9 条 candidate、content 非空、description 非空）；references 审计清单清零或有总规则兜底。

### 7.7 知识库（Wiki）场景的完整链路（为什么必须含 lark-wiki）

「访问飞书知识库文档」有两种含义，覆盖情况不同：

| 场景 | 链路 | 依赖技能 | P0 是否覆盖 |
|---|---|---|---|
| 读一篇知识库文档（已有 `/wiki/<token>` 链接） | `drive +inspect --url` 解包 → 按 `type` 路由 → `docs +fetch` 读内容 | lark-shared（token 路由 reference）+ lark-doc + lark-drive | 是（原 8 个即可） |
| 浏览知识库：列空间、看节点树、按结构找资料 | `wiki +space-list --as user` → `wiki +node-list --space-id <数字 id>` | **lark-wiki** | 原方案**否**，已补入 |
| 知识库内创建/移动/复制/删除节点、管理成员 | `wiki +node-create` / `+move` / `+node-copy` / `+member-*` | **lark-wiki** | 原方案**否**，已补入 |
| 按主题检索并归集到知识库、整体盘点整理 | lark-drive 的 `topic_move_collector` / `knowledge_organize` workflow | lark-wiki 指引 + lark-drive | 是（两 skill 均在 P0） |

关键点：
- `lark-shared/references/lark-wiki-token-routing.md` 只解决「wiki URL → 底层对象 token」，**不覆盖浏览与节点管理**。
- `lark-wiki/SKILL.md` 里的硬规则（知识空间必须显式 `--as user`、`--space-id` 必须先从 `wiki +node-get`/`space-list` 解析出数字 id、`+node-list` 的 `--parent-node-token` 必须是 wiki node token）没有技能就必然踩坑。
- 体量：lark-wiki 仅 14 个文件（1 SKILL.md + 13 references），加入 P0 总文件数从 263 → 277，成本可忽略；它引用的 lark-drive workflow 文件已在 lark-drive 内，依赖闭合。

## 8. 阶段 3：装载与验收

### 8.1 三处接线

1. `~/.dsh/profiles/web/package.json`
   - `dependencies` 增加 `"dsh-lark-cli": "link:D:/Code/projects/dsh-lark-cli"`
   - `dsh.profile.bundles` 追加 `"dsh-lark-cli"`
2. `~/.dsh/profiles/web/cordis.patch.yml` 追加（**新行，不受整行替换影响**）：

```yaml
- id: lark-cli
  name: 'dsh-lark-cli'
  config:
    executable: lark-cli
    timeoutMs: 60000
```

3. 重启 `dsh web`（先确认现有进程与端口 8080）。

### 8.2 验收清单

| # | 验收项 | 通过标准 |
|---|---|---|
| A1 | 激活 | 启动日志无 `did not activate`；`--dump-config` 出现 lark-cli 行 |
| A2 | 技能目录 | 会话中能看到 8 个 `lark-*` 技能（问「列出你的技能」或看 skill 目录消息） |
| A3 | 工具身份 | 「用 lark_cli 查飞书登录身份」→ `argv:["auth","status"]`，返回 `identity: user` + 用户名 |
| A4 | 真实读操作 | `argv:["calendar","+agenda","--as","user"]` 或 `["task","+get-my-tasks","--as","user"]` 返回真实数据 |
| A5 | 错误分类 | `argv:["definitely-not-a-command"]` → 工具结果保留 `LARK_CLI_ERROR` code，message 含 hint |
| A6 | 高风险门禁（可选） | 对一次性文件跑 `drive +delete` → 返回 `confirmationRequired: true`；带 `--yes` 重试成功 |
| A7 | 非 JSON 输出 | `argv:["--version"]` → 原样文本返回，不误判失败 |

A6 涉及真实删除，需用户提供可丢弃文件并显式同意。

### 8.3 回滚

删除 profile 两处改动（dependencies/bundles/cordis.patch.yml 行）→ 重启。插件仓库与工作区不受影响。

## 9. 阶段 4：文档

- `README.md` / `README-en.md`：定位、安装（含 junction 步骤）、配置项表、技能清单、限制、刷新流程。
- `CHANGELOG.md`：首次落地记一条（架构级）。
- `docs/changelog/YYYYMMDD-HHmm-001.md`：本次会话的改动文件清单与验证记录。
- `docs/design/lark-cli-plugin-plan.md`：本文（实施中如有偏离，在文末追加「偏差记录」）。

## 10. 测试计划

`test/smoke.mjs`（`node:assert/strict`，无网络、无真实 CLI）：

1. **身份**：`new LarkCliError('x', LARK_CLI_ERROR) instanceof HarnessError === true`。
2. **信封**：ok 信封、error 信封（含 missing_scopes/console_url）、exit 10 信封、`code:0` 陷阱（不得判成功）、非 JSON 文本、空 stdout。
3. **退出码**：0/3/10/1/信号 null 的表驱动断言。
4. **版本**：`1.0.96 < 1.0.97`、`1.0.9 < 1.0.10`、`1.0.96 == 1.0.96`、非法串。
5. **渲染**：超过 60k 字符截断且附提示；spillPath 透出。
6. **argv 防御**：空数组、含换行元素、非字符串元素。

`test/live.mjs`（手工，`node test/live.mjs`）：真实 spawn `--version` 与 `auth status`，打印 resolution 路径与身份，用于 A3 前置排障。

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Windows 下 `lark-cli.cmd` 无法被 `ctx.subprocess` 直接 spawn | 工具完全不可用 | 阶段 1 先做 10 行 spike 实测 `resolveExecutable('lark-cli')` + spawn；失败则把 `executable` 配成真实 exe（`D:\dev-cache\node_cache\node_modules\@larksuite\cli\bin\lark-cli.exe`）并写进 README |
| web profile 沙箱策略拦截 spawn/网络 | 调用报沙箱错误 | 阶段 3 首测看错误类型；必要时在 profile 为该插件声明沙箱豁免或提示用户调整（不改全局默认） |
| 技能 references 含 shell 组合语法，模型照搬导致参数错误 | 调用失败率升高 | §7.3 机械审计 + lark-shared 总规则 + A5 验收 |
| 快照技能与 lark-cli 版本漂移 | 命令参数过期 | 工具已压制 `_notice`；README 写刷新流程（`lark-cli update` → 重搬 → 重做改造）；`_notice.deprecated_command` 仍在 JSON 里，模型可见 |
| 输出过大挤占上下文 | 会话质量下降 | 64KB stderr / 512KB stdout 收集 + 60k 渲染截断 + `--jq` 指引 |
| 大 JSON 数据输入（`@-`/stdin）支持不完整 | 个别写入命令受限 | v1 支持 `stdin` 参数；若 lark-cli 的 `@-` 语义不匹配，v1 README 注明改用 `--data` 内联或临时相对路径文件 |
| 退出码 10 被模型当错误 | 破坏高风险确认流程 | 工具返回结构化 `confirmationRequired`（不抛错）+ lark-shared 显式规则 + A6 验收 |
| 用户未登录 / 只配 bot | 部分能力空成功 | lark-shared 已有「bot 查用户资源返回空成功」警示；A3/A4 用 user 身份验收 |

## 12. 后续演进（不在 v1）

1. **技能扩展**：P1 五个（slides/markdown/contact/approval/meeting）+ 4 个转发壳；P2 其余（含 mail/okr/attendance/whiteboard/event/apps/openapi-explorer/skill-maker/workflow）。
2. **运行时代理**：技能 provider 改为 `lark-cli skills list/read` 动态获取，彻底消除快照漂移（需加 TTL 缓存与降级到快照）。
3. **设置页**：仿 `dsh-client-ui-settings-web-search` 做配置卡（executable/timeout/defaultAs），本部署未装该伴侣包，优先级低。
4. **启动探活**：apply 时异步跑一次 `auth status` 并写日志，便于快速判断连接状态。
5. **结构化 action 面**：仅对高频域（doc/im/task）做可选强类型封装，作为 argv 的辅助入口。

---

## 附：执行契约对应关系

| 宿主连接器通用形态 | dsh-lark-cli | 说明 |
|---|---|---|
| `cli.json` init/versionCheck | 工具内版本门禁 + README 安装说明 | 宿主无连接器生命周期 API，需自实现 |
| `auth` 两步（config init + auth login） | 不实现，交给用户手动跑 `lark-cli` / 技能里教 | 凭据与登录态由 CLI 自管 |
| `status` + statusMatchJson | 工具调用 `auth status` | 模型按需查询 |
| 28 个 skills 快照 | 8 个 P0 快照 + provider 注册 | 同一形态，缩小首批范围 |
| 宿主 Bash 调 CLI | `lark_cli` 工具（argv） | 更受控：无 shell、信封解析、错误码保留 |
| 设置页（appId/appSecret） | 无 | 密钥不进插件配置 |

---

## 变更记录

- **2026-10-17 修订 1**：P0 技能 8 → 9，补入 `lark-wiki`。原因：原 P0 只能读「已有链接的知识库文档」，无法浏览知识空间/节点树、无法在知识库内建节点——而这正是「访问飞书知识库」的常用入口。lark-wiki 仅 14 个文件，依赖的 lark-drive workflow 参考已在 P0 内，成本可忽略。同步新增 §7.7 场景覆盖表。
- **2026-10-17 说明**：不采用「全量搬运上游全部 28 个技能」的策略，理由见评审记录（体量 513 个 md / 目录上下文成本 / lark-event、lark-apps 等不适配 dsh 同步工具模型 / dsh 不解析 metadata.requires 导致壳技能误导 / 快照漂移面）；保留 P0→P1→P2 增量路线。

---

## 偏差记录（2026-10-17 实施后）

按本方案落地时产生的偏离，均为实施中实测驱动，已验证项见 `docs/changelog/20261017-1507-001.md`。

1. **Windows shim 由「文档兜底」升级为「代码内置解析」（§11 风险 1）**
   实测 `spawnSync('D:/dev-cache/node_cache/lark-cli.cmd')` 返回 `EINVAL`，而 `.../@larksuite/cli/bin/lark-cli.exe` 正常。`ctx.subprocess.resolveExecutable('lark-cli')` 在 Windows 按 PATHEXT 会解析到 `lark-cli.CMD`，因此新增：
   - 配置项 `nativeExecutable`（默认空）；
   - 解析到 `.cmd` / `.bat` 时，先在 shim 附近向上 4 层探测 `node_modules/@larksuite/cli/bin/lark-cli.exe`，再回退到显式配置；
   - 两者都不可用时抛 `LARK_CLI_MISSING`，message 给出候选绝对路径。

2. **错误码由 4 个扩到 5 个（§6.5）**
   新增 `LARK_CLI_INVALID_ARGV`（argv 防御失败，与上游错误区分）；超时与调用方取消复用 `LARK_CLI_ABORTED`，message 区分「did not finish within N ms」与「cancelled by the caller」。

3. **不设 `defineTool.timeoutMs`（§6.2）**
   volatile 配置在工具定义时只能读一次，工具级 timeout 会固化为启动值。改为工具体内按调用读取 `timeoutMs`，用 `composeSignal(exec.signal, deadline)` 触发终止，使配置改动下一次调用即生效。

4. **`parseEnvelope` 放宽为「任意 JSON 对象」**
   `lark-cli auth status --json` 返回的是顶层 payload（`appId` / `brand` / `identities` / `identity`，**没有** `ok` 字段）。按「必须含 `ok` 或 `error`」判定会退化成原文输出、丢失身份。现在任何 JSON 对象都按信封处理：`ok` 缺省不算失败，`identity` 提升到结果首行，`data` 缺省时渲染去掉 `ok` / `identity` 的其余字段。

5. **技能 references 审计走兜底分支（§7.3）**
   9 个技能共 432 处命中（`lark-im` 92、`lark-drive` 92、`lark-sheets` 87、`lark-base` 62、`lark-calendar` 33、`lark-wiki` 20、`lark-task` 18、`lark-doc` 16、`lark-shared` 12），远超 50 条阈值。按方案采用总规则：`lark-shared` 的「在 dsh 中执行」明确要求拆解管道/重定向/`&&`/`$()`、筛选改用 `--jq`；只逐条改写了 `lark-shared` 自身两处 `LARKSUITE_CLI_NO_*` 前缀写法。README「已知限制」记录未逐条改写比例（约 100%）。

6. **新增 `test/tool.mjs`（§10 未列）**
   在 smoke（纯函数）与 live（探活）之外补一层：用独立 cordis Context 挂 `dsh-subprocess-local`，真实驱动 `createLarkCliTool` 的 `execute`，覆盖 A3 / A4 / A5 / A7 与 argv 防御，无需模型会话。A2 用 smoke 里的 stub context 断言（9 条 candidate + 正文可读）替代。

7. **profile 接线用 junction，未跑 `pnpm add`（§8.1）**
   `~/.dsh/profiles/web` 是 pnpm 工作区（含 `pnpm-lock.yaml`），`pnpm add link:` 会重新解析整棵依赖树并可能触碰私有 registry。改为：`package.json` 照方案登记 link 依赖与 bundle（保持声明一致），`node_modules/dsh-lark-cli` 用 junction 落地（与既有 `dsh-web-search-tavily` 的 symlink 等价）。锁文件因此未更新，重新 `pnpm install` 时会自动补齐。

8. **A6（退出码 10 真实写入）未验收**
   需要用户提供的可丢弃对象与显式同意。工具侧行为已由 smoke 的表驱动用例覆盖（信封 / 无信封两种形态），通道侧留待用户确认后补测。

9. **`defaultAs` 维持「未配置不注入」（§3.3）**
   未改为默认 `user`：避免覆盖 `lark-cli` 自身配置（本机为 `auto`）。

