# dsh-lark-cli

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）提供飞书 / Lark 访问能力的插件。

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

```bash
cd D:/Code/projects/dsh-lark-cli
npm install          # 只需要 typescript 与 @types/node（若依赖已就绪可跳过）
npm run build        # 产出 dist/
```

把插件挂进 profile（示例为 `web`）：

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

| 技能 | 覆盖 |
|---|---|
| `lark-shared` | 身份、认证、输出契约、高风险确认、**dsh 执行通道规则** |
| `lark-doc` | 云文档读写、附件、思维笔记 |
| `lark-im` | 消息、群聊、卡片、加急 |
| `lark-calendar` | 日程、参会人、会议室 |
| `lark-task` | 任务、清单、任务智能体 |
| `lark-drive` | 云空间文件、权限、导入导出 |
| `lark-sheets` | 电子表格结构 / 单元格 / 图表 / 透视 |
| `lark-base` | 多维表格、视图、表单、仪表盘 |
| `lark-wiki` | 知识空间、节点树、知识库成员 |

技能目录同时通过 `resourceBase` 暴露给模型，正文里的 `references/...` 可按相对路径读取。

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
