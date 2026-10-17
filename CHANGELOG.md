# Changelog

只记录影响多模块、架构级或不兼容的改动。会话级细粒度记录在 `docs/changelog/`。

## 0.1.0 — 2026-10-17

首个可用版本，按 `docs/design/lark-cli-plugin-plan.md` 落地：

- 新增 `lark_cli` 工具（`defineTool` + `ctx.subprocess`）：argv 强校验、可执行文件解析（含 Windows `.cmd` → `.exe` 升级）、一次性版本门禁、stdout/stderr 有界收集与落盘、退出码分流（0 / 3 / 10 / 其他）、信封解析与 60k 渲染截断。
- 新增技能 provider：随包分发 9 个 `lark-*` 技能（`lark-shared`、`doc`、`im`、`calendar`、`task`、`drive`、`sheets`、`base`、`wiki`），`rank = 600`，允许用户级同名技能覆盖。
- 技能完成 dsh 适配：清理上游 frontmatter 中的宿主特定字段（如 `metadata.ai.*`）、在 `lark-shared` 增设「在 dsh 中执行（`lark_cli` 工具）」总规则节、各产品技能补充执行通道提示。
- 装载进 `~/.dsh/profiles/web`（`dsh-lark-cli` link 依赖 + bundle + `cordis.patch.yml` 行），启动无激活失败告警。
