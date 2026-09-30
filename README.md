# dsh-worldbook

给 **DeepSeek Harness（dsh）** 用的酒馆式世界书。两类条目：

- **蓝灯（constant）**：每次模型调用都作为常驻背景出现在系统提示里。
- **绿灯（关键词）**：用户消息命中触发词时，在那一轮对话里插入一条背景资料消息。

附带一个装进 dsh web 设置面板的**可视化编辑器**，以及一个让 Agent 自己读写世界书的 `worldbook` 工具（说一句「记住…」就能存成条目）。

---

## 目录结构

| 目录 | 装到哪 | 作用 |
| --- | --- | --- |
| `worldbook/` | `<你的 agent preset>/plugins/worldbook/` | **引擎**（agent 侧）：注册常驻提示段、`worldbook` 工具、`agent/pre-step` 关键词注入 |
| `worldbook-editor/` | `~/.dsh/profiles/<profile>/plugins/worldbook-editor/` | **编辑器**（web 侧）：提供 `/worldbook` 页面与 `/worldbook/api`，并在设置面板挂一个分区 |
| `examples/worldbook.example.json` | 复制成你的 `worldbook.json` | 示例数据，含蓝灯／绿灯／停用三种形态 |

两个插件共用同一个 `worldbook.json`，彼此独立：只装引擎也能用（靠 Agent 工具维护），只装编辑器等于一个顺手的世界书文件编辑器。

---

## 安装

### 1. 引擎（agent 侧）

把 `worldbook/` 整个目录拷进你的 preset，例如 `~/.dsh/.agent-presets/tavern/plugins/worldbook/`，然后在 preset 的 `agent.cordis.yml` 里加一行：

```yaml
- id: worldbook
  name: './plugins/worldbook/index.js'
  config:
    path: './worldbook.json'
    sectionOrder: 420
```

- `name` 以 `./` 开头 → 相对 **preset 目录**解析，插件跟着 preset 走，不用额外装 npm 包。
- `config.path` 同样相对 preset 目录；省略则默认 `./worldbook.json`。
- `sectionOrder` 决定常驻段在系统提示里的排序，默认 `420`（数值越小越靠前）。
- 这条 row 不发布任何服务、不需要 isolate realm：它只消费宿主的 `systemPrompt` 与 `tools` 注册表，并监听 `agent/pre-step` 瀑布。

preset 里的内联插件在**进程启动时**加载，装完需要重启 dsh。

### 2. 编辑器（web 侧）

把 `worldbook-editor/` 拷进 profile 的 `plugins/` 目录，例如 `~/.dsh/profiles/web/plugins/worldbook-editor/`，然后在同一个 profile 的 `cordis.patch.yml` 里加：

```yaml
- insert:
    - id: worldbook-editor
      name: './plugins/worldbook-editor/index.mjs'
```

重启 dsh（或该 profile 配了 `patchReload: live` 时热载），打开 `http://127.0.0.1:3080/worldbook`，或在 **设置 → 世界书** 里看到它。

### 世界书文件的路径解析

引擎与编辑器顺序一致，取第一个命中的：

1. `config.path`（引擎在 preset row 里给，编辑器在 patch entry 里给）
2. 环境变量 `DSH_WORLDBOOK_PATH`
3. 默认 `~/.dsh/.agent-presets/tavern/worldbook.json`

编辑器吃的是**绝对路径**最稳；相对路径按进程工作目录解析。

---

## 数据格式

`worldbook.json` 就是一个对象包一个 `entries` 数组：

```json
{
  "entries": [
    {
      "id": "entry-machine-setup",
      "title": "本机环境",
      "content": "ComfyUI 在 E:\\woyao，端口 8188。",
      "constant": true,
      "enabled": true,
      "keys": [],
      "repeat": "once",
      "caseSensitive": false
    }
  ]
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 必填，非空、全局唯一 |
| `title` | string | 必填，非空 |
| `content` | string | 必填，非空；注入时的正文 |
| `constant` | boolean | `true` = 蓝灯常驻；否则为绿灯 |
| `keys` | string[] | 绿灯的触发词；`constant !== true` 时至少一个非空 |
| `caseSensitive` | boolean | 默认 `false` |
| `repeat` | `"once"` \| `"always"` | 默认 `once` |
| `enabled` | boolean | 默认 `true`；`false` 表示停用 |

校验是**严格**的：非法结构直接抛错，不会静默修复或丢弃未知字段。手写文件时给 `worldbook.json` 配上编辑器里的 JSON 校验，比事后猜错在哪快得多。

---

## Agent 工具：`worldbook`

引擎注册的工具，模型可直接调用：

| op | 必填参数 | 行为 |
| --- | --- | --- |
| `list` | — | 列出全部条目（含 modes、关键词） |
| `get` | `id` | 读取单条全文与当前 `revision` |
| `add` | 视条目而定 | 追加条目；`id` 省略时自动生成 |
| `update` | `id` + `expectedRevision` | 按 id 改字段（省略的字段保持原样） |
| `remove` | `id` + `expectedRevision` | 删除条目 |
| `reload` | — | 立即重读文件并刷新内存快照 |

改／删之前先 `get` 拿 `revision`，再把它当 `expectedRevision` 传回；版本不一致会明确报「版本冲突」而不是覆盖别人的修改。

---

## 编辑器

- 左侧条目列表：搜索框过滤（标题／正文／关键词），四个筛选页签（全部／蓝灯／绿灯／停用）。
- 右侧表单：标题、激活方式（蓝灯·常驻／绿灯·关键词）、关键词、区分大小写、触发频率（每会话首次命中／每次新消息命中）、启用开关、删除。
- 顶部：**重新读取**（放弃本页草稿）与**保存更改**（`Ctrl+S` 同效）。有未保存修改时关闭页面会拦一下。
- 保存走乐观锁：文件被别人（或 Agent）改过就返回 409，页面上给提示并保留你的草稿，让你重新读取后再合并。
- 备注：修改在保存后才落盘；蓝灯段在**下次模型调用**时读到新内容，已经进入历史对话的背景资料不会从历史里抹掉。

---

## 并发与安全语义

- **修订号**：文件内容的 SHA-256。引擎、编辑器、以及所有协作写入者共用同一个修订号做乐观锁。
- **写锁**：每次写盘前用 `open(path, 'wx')` 抢一个 `worldbook.json.lock`。抢不到就明确失败，绝不偷锁、绝不静默覆盖。
- **原子替换**：写临时文件 → `fsync` → `rename` 覆盖，读到的永远是完整文件。
- **二次校验**：持锁后以及替换前各再读一次修订号，能抓到不守规矩的外部改动。
- **编辑器 HTTP 面**：`PUT /worldbook/api` 要求同源（校验 `Origin` 与 `sec-fetch-site`）、`Content-Type: application/json`、请求体 ≤ 1 MiB；写盘前先备份 `worldbook.json.bak`；响应带 `no-store` 与 `nosniff`，编辑器页面带 CSP。
- 编辑器只监听本机 dsh web 服务器，不额外开端口。

---

## 触发语义细节

- 命中判定基于**本轮进入的 user 消息文本**；插件自己插入的合成消息不参与匹配（不会自我触发)。
- 关键词是**纯子串包含**，不做分词、不支持正则；`caseSensitive: false` 时两侧都转小写再比。
- `repeat: once`：同一个 agent 内，同一**版本**的条目只注入一次。「版本」是该条目对象的 JSON 哈希 —— 条目内容被改动后，哈希变了，可以再次注入。
- `repeat: always`：只要命中就注入。
- 合成消息紧跟触发它的那条用户消息之后插入，`source.kind` 为 `plugin`，视觉上与用户消息区分开。
- 蓝灯段与绿灯匹配都会在**每次模型调用前重读文件**，所以手改 `worldbook.json` 立即生效（除非你改的是插件配置里的路径）。

---

## 常见问题

**编辑器 404 / 设置里没有「世界书」**：确认 `worldbook-editor/` 放进了 profile 的 `plugins/`、patch 里的相对路径对得上、profile 名没错（`~/.dsh/profiles/<name>/`），然后重启 dsh。

**改了文件不生效**：蓝灯与绿灯都会重读文件；只有改插件配置（`config.path`、`sectionOrder`）才需要重启。

**保存报 409**：文件被其他页面或 Agent 改过，点「重新读取」合并后重存。

**提示世界书被锁定**：有写入者没释放 `worldbook.json.lock`。确认没有正在写的进程后删掉这个残留文件即可。

**条目明明命中却不注入**：检查 `enabled` 是否为 `false`、`keys` 是否写成了别的分词、`repeat: once` 是否在本会话已经触发过；`get` 一下看看到底存的是什么。

---

## License

MIT © 2026 libolunm

---

## English summary

A tavern-style **world book** for DeepSeek Harness (dsh). Two halves:

- `worldbook/` — the engine, mounted inside an agent preset via `agent.cordis.yml`. It renders `constant` entries as a standing system-prompt section, injects keyword-matched entries as a synthetic message on `agent/pre-step`, and registers a `worldbook` read/write tool.
- `worldbook-editor/` — a same-origin web editor served by the dsh web server at `/worldbook`, mounted as a settings section through the profile's `cordis.patch.yml`.

Both halves share one `worldbook.json` (SHA-256 revision for optimistic locking, exclusive `.lock` file, atomic temp-write + rename). Path resolution: `config.path` → `DSH_WORLDBOOK_PATH` → `~/.dsh/.agent-presets/tavern/worldbook.json`. MIT licensed.
