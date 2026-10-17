# dsh-lark-cli

一句话：**让 AI 助手直接替你操作飞书**——发消息、写文档、查日程、管任务、理表格，不用离开对话窗口。

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供飞书 / Lark 访问能力的插件。安装后，你可以在会话里用自然语言下达指令，模型通过 `lark_cli` 工具调用官方 `lark-cli` 完成实际操作：

| 你说 | 模型做 |
|---|---|
| 「把会议纪要发到产品群」 | `lark-im` 发送消息到指定群 |
| 「按这份材料写篇 PRD 存到云文档」 | `lark-doc` 创建文档并写入 |
| 「我下周有什么会」 | `lark-calendar` 查询日程 |
| 「把这张表里的待办整理成任务」 | `lark-sheets` 读数据 → `lark-task` 建任务 |
| 「给知识库补一页 xx 说明」 | `lark-wiki` 建节点 → `lark-doc` 写内容 |

设计原则：**官方 `lark-cli` 负责执行 + 技能负责教模型怎么用**，执行与知识分离。

- **一个工具**：`lark_cli`，参数是 `argv`（命令切词，不含开头的 `lark-cli`）与可选 `stdin`。不经 shell，无引号/转义/注入问题。
- **九个技能**：`lark-shared`、`lark-doc`、`lark-im`、`lark-calendar`、`lark-task`、`lark-drive`、`lark-sheets`、`lark-base`、`lark-wiki`，随插件分发，模型按需加载。
- **零凭据配置**：登录态与密钥都由 `lark-cli` 自己管（`~/.lark-cli/config.json` + 系统 keychain），插件不存、不转发任何 token。

## 前置条件

1. 已安装 `lark-cli` ≥ 1.0.96：`npm install -g @larksuite/cli`。
2. 已完成 CLI 侧配置与登录（两条命令都在终端里手动跑一次）：
   - `lark-cli config init`（首次使用，配置应用）
   - `lark-cli auth login` / `lark-cli auth status`（确认身份）

插件本身不做登录，也不会替你保存 appId / appSecret。

## 安装

三种安装方式任选其一；装好后都需要按「[挂载进 profile](#挂载进-profile)」完成接线。

### 方式一：GitHub 链接一键构建（推荐）

直接从 GitHub 拉取并构建，不需要本地已有源码：

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install          # 只需要 typescript 与 @types/node
npm run build        # 产出 dist/
```

或者不克隆，直接把 GitHub 仓库作为依赖登记（pnpm 支持 Git 链接）：

```bash
# 在 ~/.dsh/profiles/web 下
pnpm add dsh-lark-cli@github:aminuoshi-378/dsh-lark#main
```

### 方式二：源码构建

适合需要本地修改技能或源码的场景：

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install
npm run build
```

之后在 profile 里用 `link:` 指向本地目录（见「挂载进 profile」），本地改动即时生效，无需重新发布。

### 方式三：Prompt 构建（让 AI 会话代为执行）

把下面这段话直接发给 dsh 会话里的模型，由它代为完成安装：

```text
请帮我安装 dsh-lark-cli 插件：
1. 克隆 https://github.com/aminuoshi-378/dsh-lark 到本地；
2. 在仓库目录里执行 npm install && npm run build；
3. 按 README「挂载进 profile」一节，把插件接线到 ~/.dsh/profiles/web（package.json 依赖 + bundle + cordis.patch.yml）；
4. 执行 dsh --profile web --dump-config 验证出现 lark-cli 条目。
```

模型会调用它的 shell 工具逐步执行；涉及 profile 配置文件的修改属于工作区外写入，模型会先向你请求批准。

## 挂载进 profile

三种方式构建完成后，都需要把插件挂进 profile（示例为 `web`）：

1. `~/.dsh/profiles/web/package.json`
   - `dependencies` 增加 `"dsh-lark-cli": "link:D:/Code/projects/dsh-lark-cli"`
   - `dsh.profile.bundles` 追加 `"dsh-lark-cli"`
2. `~/.dsh/profiles/web/node_modules/dsh-lark-cli` 指向本仓库（`pnpm install` 会自动建，或手动建目录链接 / junction）。
3. `~/.dsh/profiles/web/cordis.patch.yml` 追加：

```yaml
- id: lark-cli
  name: 'dsh-lark-cli'
  config:
    executable: lark-cli
    timeoutMs: 60000
```

4. 重启 `dsh web`。验收：启动无 `did not activate` 告警；`dsh --profile web --dump-config | grep lark-cli` 能看到该行。

回滚：删掉上面三处改动并重启，插件仓库与工作区不受影响。

## 配置项

| 字段 | 默认值 | 说明 |
|---|---|---|
| `executable` | `lark-cli` | 可执行名或绝对路径，经 `ctx.subprocess.resolveExecutable` 解析 |
| `nativeExecutable` | 空 | Windows 专用兜底：当 `executable` 解析到 `.cmd` / `.bat`（无法直接 spawn）时显式指定真实 `.exe`；留空则自动在 shim 附近的 `node_modules/@larksuite/cli/bin/lark-cli.exe` 探测 |
| `minVersion` | `1.0.96` | 低于此版本直接报 `LARK_CLI_VERSION_TOO_OLD`（进程内只探测一次） |
| `timeoutMs` | `60000` | 单次调用墙钟预算，超时终止并报 `LARK_CLI_ABORTED` |
| `maxOutputBytes` | `512000` | stdout 内存上限，超出保留尾部 |
| `spillMaxBytes` | `67108864` | stdout 溢出落盘上限，路径会回传给模型 |
| `defaultAs` | 未设置 | 注入 `LARKSUITE_CLI_DEFAULT_AS`（`user` / `bot`）；不设置则用 CLI 自己的默认 |

全部字段都是 volatile：改配置下一次调用即生效，不需要重启。

## 工具契约

- 参数：`argv: string[]`（必填，一个数组元素一个参数，禁止换行）、`stdin?: string`。
- 退出码分流：

| 退出码 | 含义 | 工具行为 |
|---|---|---|
| 0 | 成功 | 解析 `{ok, identity, data, meta}` 信封并渲染；非 JSON 输出原样返回 |
| 3 | `auth login` 幂等 | 按成功返回并注明「已是登录态」 |
| 10 | 高风险写确认门禁 | **不抛错**，返回 `confirmationRequired: true`，提示先问用户再追加确认 flag 重试 |
| 其他 | 失败 | 抛 `LarkCliError`（`LARK_CLI_ERROR`），message 内含 `hint` / `missing_scopes` / `console_url` |

- 退出码 0 但信封 `ok === false` 按失败处理（防御上游行为漂移）。
- 渲染上限 60k 字符，溢出提示改用 `--jq` / `--page-size`；`readFrom(0)` 拿到 spill 路径时一并告知。
- 工作目录取会话工作区根，所以 `--file` / `--output` / `@file` 必须写相对路径。

## 技能清单

插件随包分发九个技能，模型按当前任务自动加载对应技能；每个技能目录下还有 `references/` 细分文档（按相对路径按需读取），覆盖更细的命令语法与场景 playbook。

### `lark-shared` — 公共规则与认证（必读基础）

所有飞书操作的公共底座：身份选择（`--as user` / `--as bot` 的判定规则）、认证与登录状态排查、JSON 输出契约解析、高风险写操作确认门禁，以及最关键的「**在 dsh 中执行**」规则——本环境不经 shell 跑命令，所有 `lark-cli` 命令一律拆词成 `lark_cli` 工具的 `argv` 调用（管道、`&&`、重定向如何改写，`--jq` 筛选怎么用都在这一节）。首次使用任何 lark 技能前模型都会先读本技能。

### `lark-doc` — 云文档 / Docx

云文档的创建、读取、更新（含 XML 块级结构）、Markdown 双向转换、历史版本；插入与下载图片附件；思维笔记读写；白板；十余种文体的写作流派模板（PRD、周报、会议纪要、小红书、公文、研究报告等，见 `references/genres/`）；还有「创建后自动跑 workflow」的组合用法。

### `lark-im` — 即时通讯

单聊与群聊消息的收发、回复、编辑、撤回语义；按关键词搜索消息与群；群成员、群设置、话题群管理；交互卡片（Card 2.0 全量组件 schema：按钮、表单、图表、列容器、图片等）；表情回复；消息加急（应用内 / 短信 / 电话）；Feed 置顶与标签管理。

### `lark-calendar` — 日历

日程创建 / 更新 / 取消（含重复日程 RRULE）、全天与模糊时间表达、参会人管理与 RSVP 回执、忙闲查询与时段推荐、会议室查找与预定、跨日历日程转移、日程与会议（视频会议）关联。

### `lark-task` — 任务待办

任务创建 / 更新 / 完成 / 重开、子任务拆解与祖先设置、清单（tasklist）增删与成员管理、任务搜索与关联查询、协作成员与关注者、提醒与附件上传、任务智能体注册注销及其主页数据维护。

### `lark-drive` — 云空间

云盘文件的浏览 / 搜索 / 移动 / 复制 / 删除、上传与下载（含导出为 docx/sheet 等格式）、文件夹管理、快捷方式、版本历史；评论与回复（含表情回应）；权限管理（成员增删、设置查询、权限申请）；密级标签；另含多个多步工作流 playbook：知识库归集整理、专题迁移收集器、权限治理。

### `lark-sheets` — 电子表格

工作表与行列结构操作（增删、合并、冻结、分组、隐藏）、单元格读写（值 / 公式 / 样式 / 批注 / 单元格图片）、区域复制移动与排序、数据透视表、条件格式、下拉列表、图表与迷你图、浮动图片、公式校验；Excel / CSV 的导入导出。

### `lark-base` — 多维表格（Bitable）

数据表与字段管理、记录增删改查与批量操作、视图管理、分组 / 筛选 / 排序、公式与 lookup 字段、表单视图、仪表盘、自动化 workflow（含 AI 生成文本 action）、字段扩展（field extension）批量写、角色权限、模板；AppMode（Base 应用）页面与组件；`.base` 文件导入导出。

### `lark-wiki` — 知识库

知识空间列表、节点树浏览与检索、节点创建 / 移动 / 复制 / 删除、空间成员管理；以及「wiki URL → 底层对象 token」的路由规则（打开 `/wiki/` 链接时先解包成 docx/sheet/bitable 再路由到对应技能）。

> 技能目录同时通过 `resourceBase` 暴露给模型，正文里的 `references/...` 可按相对路径读取。

## 测试

```bash
npm test              # 纯函数 + 技能快照 + 注册行为（无网络、无 CLI）
npm run test:tool     # 真实 spawn lark-cli：auth status / calendar +agenda / 错误分类 / argv 防御
npm run test:live     # 只读探活：解析路径、--version、auth status
```

## 已知限制

- **recent references 未逐条改写 shell 语法**：9 个技能共 432 处出现 `| jq`、`&&`、`$(...)`、`2>&1`、bash 代码块。按 1.3 节工程量阈值（> 50 条）采用总规则兜底：`lark-shared` 的「在 dsh 中执行」明确要求把组合语法拆成多次 `lark_cli` 调用、筛选改用 `--jq`。未逐条改写的比例约 100%。
- **高风险确认（退出码 10）未做真实写入验收**：需要用户提供的可丢弃对象，属于风险操作，留待用户显式同意后验证。
- **技能快照漂移**：技能为 lark-cli 1.0.97 的快照。CLI 升级后按下面流程刷新。
- **Windows 且只有 `.cmd` shim**：自动探测失败时显式配置 `nativeExecutable`（例如 `D:/dev-cache/node_cache/node_modules/@larksuite/cli/bin/lark-cli.exe`）。
- **仅 P0 九个技能**：P1（slides / markdown / contact / approval / meeting 等）未收录。

## 刷新技能快照

```bash
lark-cli update
SRC="<上游技能快照目录>"
for s in lark-shared lark-doc lark-im lark-calendar lark-task lark-drive lark-sheets lark-base lark-wiki; do
  rm -rf "skills/$s" && cp -r "$SRC/$s" skills/
done
```

然后清理上游 frontmatter 中的宿主特定字段（如 `metadata.ai.*`）、在各产品技能 H1 后补「执行通道」一行、在 `lark-shared` 重新插入「在 dsh 中执行」一节，最后 `npm test && npm run test:tool`。
