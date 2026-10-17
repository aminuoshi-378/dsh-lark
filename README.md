# dsh-lark-cli

[English](README-en.md) | 简体中文

一句话介绍：**让 AI 助手直接替你操作飞书**——发消息、写文档、查日程、管任务、理表格，不用离开对话窗口。

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

## 环境要求

| 项目 | 要求 |
|---|---|
| dsh 兼容版本 | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）**≥ 0.2.0-rc.2**（实际验证版本；需支持 `defineTool` / `ctx.subprocess` / `ctx.skills.registerProvider` 插件 API 与 `dsh.profile.bundles` bundle 机制） |
| 操作系统 | **Windows 10/11**（主要验证平台，内置 `.cmd` shim → `.exe` 自动探测）；**macOS / Linux** 理论可用（`lark-cli` 本身跨平台），未逐一验证 |
| Node.js | ≥ 22.0.0 |
| lark-cli | ≥ 1.0.96（`npm install -g @larksuite/cli`） |
| 网络 | 可访问飞书 OpenAPI 与 `open.feishu.cn` |

## 前置条件

1. 已安装 `lark-cli` ≥ 1.0.96：`npm install -g @larksuite/cli`。
2. 已完成 CLI 侧配置与登录（两条命令都在终端里手动跑一次）：
   - `lark-cli config init`（首次使用，配置应用）
   - `lark-cli auth login` / `lark-cli auth status`（确认身份）

插件本身不做登录，也不会替你保存 appId / appSecret。

## 安装

**推荐用 dsh 自带的插件管理命令安装**：它会自动完成依赖登记、`dsh.profile.bundles` 注册、`cordis.yml` 配置合并——三步接线全自动，装完重启即可用。以下命令在任何目录执行都可以（`--profile` 已指明目标 profile，示例为 `web`）。

### 方式一：Release tarball 安装（推荐）

```bash
dsh plugin --profile web add https://github.com/aminuoshi-378/dsh-lark/archive/refs/tags/v0.1.0.tar.gz
```

把 `v0.1.0` 换成目标版本号；各版本地址见 [Releases](https://github.com/aminuoshi-378/dsh-lark/releases) 页。安装时若 pnpm 提示需要允许构建脚本，把打印出的 key 按提示加进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 再重跑一次（详见下文「允许构建脚本」）。

### 方式二：git 仓库安装

```bash
dsh plugin --profile web add dsh-lark-cli@github:aminuoshi-378/dsh-lark#v0.1.0
```

`#` 后可写 tag（`#v0.1.0`，锁定版本，推荐）或分支（`#main`，跟踪最新）。git 来源**必须**按「允许构建脚本」一节放行 `prepare`，否则装出来没有 `dist/`。

### 允许构建脚本（git / tarball 来源需要）

pnpm 默认禁止依赖在安装时执行脚本（含本包自动构建的 `prepare`）。安装时 pnpm 会打印需要放行的 key，把它加进 `~/.dsh/profiles/web/pnpm-workspace.yaml`：

```yaml
allowBuilds:
  dsh-lark-cli: true
```

然后重跑同一条 `dsh plugin ... add` 命令即可。

### 方式三：本地源码 link 安装

适合需要修改技能或源码的场景：

```bash
git clone https://github.com/aminuoshi-378/dsh-lark.git dsh-lark-cli
cd dsh-lark-cli
npm install && npm run build

dsh plugin --profile web add "link:D:/Code/projects/dsh-lark-cli"   # 换成你的克隆目录
```

本地改动即时生效（重启 `dsh web` 后），无需重新发布。

### 方式四：Prompt 安装（让 AI 会话代为执行）

把下面这段话发给 dsh 会话里的模型：

```text
请帮我安装 dsh-lark-cli 插件：
1. 执行 dsh plugin --profile web add https://github.com/aminuoshi-378/dsh-lark/archive/refs/tags/v0.1.0.tar.gz
2. 若 pnpm 要求允许构建脚本，按输出提示把 key 加进 ~/.dsh/profiles/web/pnpm-workspace.yaml 的 allowBuilds 后重跑；
3. 重启 dsh web 后执行 dsh --profile web --dump-config 验证出现 lark-cli 条目。
```

模型会调用它的 shell 工具逐步执行。

### 验证安装成功

```bash
dsh --profile web --dump-config | grep lark-cli   # 能看到 lark-cli 条目
```

重启 `dsh web` 后，启动日志无 `did not activate` 告警，会话里就能用 `lark_cli` 工具和九个 `lark-*` 技能了。

回滚：`dsh plugin --profile web remove dsh-lark-cli`（bundles 会同步清理），再删掉 cordis.patch.yml 里对应的 id 行并重启。

## 升级到新版本

发布新版本时，按你当初的安装方式更新即可；`cordis.patch.yml` 注册无需改动，更新后重启 `dsh web` 生效。

**方式一（tarball）**：把地址里的版本号换成新的重新 add。

**方式二（git 仓库）**：把 tag 换成新的重新 add（或临时用 `#main` 跟踪最新）。

**方式三（link 源码）**：进入克隆目录 `git pull && npm install && npm run build`，重启 `dsh web`。

方式四的升级把对应命令发给模型代执行即可。**查看当前版本**：看 `~/.dsh/profiles/web/package.json` 里 `dsh-lark-cli` 的依赖描述，或 `node_modules/dsh-lark-cli/package.json` 的 `version` 字段；新版本说明见 [Releases](https://github.com/aminuoshi-378/dsh-lark/releases) 页。升级后建议在插件目录跑一次 `npm test` 确认环境正常。

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

