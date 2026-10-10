# 更新日志

本文件记录 `dsh-worldbook` 的版本变更。

## [1.1.0] - 2026-10-07

适配 dsh 的 session format v4，并补了两个健壮性改进。

### 修复

- **会话格式 v4 适配（关键）**：关键词注入的合成消息 `source.kind` 由 `plugin` 改为生产者自有的 `plugin:worldbook`。dsh 升级到 session format v4 之后，旧写法 `{ kind: 'plugin', plugin: 'worldbook' }` 会被行准入校验直接拒绝（`format v4 message requires a producer-owned source kind`），在调用模型之前就把整轮对话带走。详见 `worldbook/index.js` 顶部的 `SOURCE` 常量与注释。

### 新增

- **`onlyProviders` 字段**：蓝灯（`constant: true`）条目可带一个可选的 `onlyProviders` 字符串数组；只有当前模型的 provider 命中时才注入，未命中则跳过该条目。用于把某个常驻背景限定在特定模型 / provider 之下。

### 改进

- **写锁失效回收**：写盘锁现在带失效期——超过 120 秒未被刷新的 `.lock` 会被视为「写入者中途死亡」而回收一次并重试；存活的锁仍会明确报错、绝不偷锁。此前进程被杀残留的锁文件会永久阻塞后续所有写入，只能手工删除。
- **注入异常隔离**：关键词注入的合成消息构造与插入被包进 try/catch，注入失败只跳过本轮并记日志，不再可能把整轮对话带走。

### 说明

- 引擎路径解析保持 `config.path` → 环境变量 `DSH_WORLDBOOK_PATH` → 默认 `./worldbook.json` 的顺序不变。
- 编辑器（`worldbook-editor/`）本次无改动，仍为 `1.0.0`。

---

## [1.0.0] - 2026-09-30

首个发布版本：酒馆式世界书引擎（常驻蓝灯 + 关键词绿灯 + `worldbook` 工具）+ 同源网页编辑器。
