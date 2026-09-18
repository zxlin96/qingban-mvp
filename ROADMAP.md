# 轻伴 ROADMAP — 下一阶段规划

> 制定于 2026-09-18，基于 v3.4.7 现状。定位：**个人自用打磨**（发布合规暂缓，见文末）。
> 顺序：工程地基 → 数据备份 → 趋势可视化。先保数据安全，再做价值展示。

---

## 阶段一：工程地基（预计 3~5 个工作日）✅ 已完成 — v3.4.8（2026-09-18）

目标：把"人肉 MD5 校验 + 无测试"的改动风险降下来，让阶段二/三的迭代敢放手做。

### 1.1 三目录同步自动化

- 新增 `scripts/sync-web.mjs`：
  - `npm run sync`：`js/ → www/js/ → android/app/src/main/assets/public/js/`，`css/`、`index.html`、`manifest.json` 同理，仅复制有差异的文件并打印清单
  - `npm run verify`：只做 MD5 比对，不一致时退出码非零（供脚本/钩子调用）
- `build-all.ps1` 的同步步骤改为调用同一脚本（消除两套同步逻辑漂移）
- 顺带清理根目录散落的构建中间物（`test_ps.txt`、`cmd_test.txt`、`轻伴-debug_3.4.1.apk`、`轻伴-debug - 副本.apk` 等，移入 `.gitignore` 目录或删除）

### 1.2 测试基建（node:test，零新依赖）

- Node 20.6+ 原生 `node:test`，`npm test` → `node --test test/`
- 代码是 ES Modules 可直接 import；对 `window/document/indexedDB/fetch` 做轻量 stub，必要时做**最小**依赖注入重构（只为了可测，不改行为）
- 首批测试用例 = 历史Bug回归集，优先覆盖：
  - `spark-llm.js`：payload 组装（`max_tokens` 已连出两次 bug：v3.4.2/v3.4.7）、含图片时 Anthropic maxTokens、流式 stop_reason 处理
  - `app.js` 日期逻辑：`_getToday` 本地时区、凌晨 0-4 点熬夜不跨天
  - `llm-service.js`：`cleanMessages` 剥离非标字段、KV Cache 前缀失效触发（write_file 命中固定文件）、响应缓存 key
  - `chat-manager.js`：数据完整性智能过滤规则

### 1.3 回归清单文档化

- 新增 `docs/REGRESSION.md`：真机手动验收清单（跨天动画、图片识别、打卡面板、通知横幅……），发版前逐项过

**验收标准**：`npm run verify` 能抓住人为制造的三目录不一致；`npm test` 通过且包含上述 5 类历史Bug回归用例。

---

## 阶段二：数据备份与迁移（预计 2~3 个工作日）✅ 已完成 — v3.5.0（2026-09-18）

目标：数据只存在 IndexedDB 里，丢机/误清=全部记忆丢失。先上保险，再做可视化。

### 2.1 手动导出/导入

- 新增依赖：`@capacitor/filesystem`（+ 可选 `@capacitor/share`）
- **导出**：聚合 IndexedDB 全部内容（记忆文件、`diet/`、`chat/`、`.meta/*` 打卡数据）+ settings → 单个 `轻伴备份-日期.qb.json`，经 Filesystem 写入 + Share 分享；WebView 内提供 blob 下载降级路径
- **导入**：`<input type="file">` 读取 → 校验结构（版本号、文件清单）→ 预览差异 → 覆盖写入 → 重建 INDEX.md + 失效 KV 前缀缓存 + 刷新 UI
- 入口：设置页"数据备份"区

### 2.2 自动本地快照（低成本防误写）

- 跨天流程末尾把 `PROFILE.md`、`BODY_METRICS.md`、`preferences.md` 等关键记忆文件快照到 `.meta/backups/`，滚动保留最近 7 份
- AI 误删/误写记忆时可从设置页一键回滚

**验收标准**：导出 → 清空应用数据 → 导入 → 聊天历史、体重序列、习惯打卡、记忆文件全部还原；快照回滚演练通过。

---

## 阶段三：趋势可视化与周报（预计 5~8 个工作日）✅ 已完成 — v3.6.0（2026-09-18）

目标：减重是长周期行为，给用户看得见的正反馈。数据已经在文件里，缺的是"看"的方式。

### 3.1 数据层（关键设计决策）

- 现状：热量数据只存在于 AI 写的 `diet/日期.md` Markdown 里，无结构化存储
- **v1 采用容错解析器**：解析 `diet/*.md` + `BODY_METRICS.md` → 每日结构化数据 `{热量, 餐次明细, 体重}`，写 IndexedDB 侧车文件（`.meta/daily-stats.json`，参考 habits 的既有模式）。历史数据零迁移、立即出图
- **v2 视解析稳定性决定**：新增 `record_metrics` LLM 工具让 AI 写 MD 的同时双写结构化数据，提升增量可靠性
- 注意：图表数据只从 IndexedDB 读，**不注入系统提示词**，避免破坏 KV Cache 前缀命中

### 3.2 展示层（原生 SVG，不引第三方图表库）

- 新增"趋势"面板（顶栏入口，与打卡面板同级）：
  - 体重折线图（近 30 天）+ 目标线
  - 热量柱状图（近 7 天）+ 每日目标线
  - 习惯打卡热力图（`.meta/habit-checkins.json` 现成结构化数据，直接可用）
- 保持零依赖、离线可用，样式跟随现有主题系统（深色/浅色/暖色）

### 3.3 AI 周报

- 复用跨天总结的既有模式：周日跨天时生成周度复盘（热量趋势解读、体重变化归因、习惯完成率、下周建议），写入 `weekly/日期.md`
- 完成后横幅通知提示查看；「刷新习惯总结」菜单旁加「生成本周周报」

**验收标准**：老用户历史数据无需任何操作即可出图；系统提示词长度不变（KV Cache 命中率不回退）；周报在真机跨天流程中稳定生成。

---

## 暂缓项（触发条件明确再做）

| 事项 | 触发条件 |
|---|---|
| BYOK / 正规 API 接入（解决讯飞 4.2.3 合规限制） | 决定对外发布时；`spark-llm.js` 已支持 OpenAI/Anthropic 协议，改造成本可控 |
| 语音/拍照快捷记录 | 可视化上线后视记录摩擦反馈决定 |
| 主动陪伴教练（晨间问候/提醒推送） | 依赖通知系统沉淀，排期在三个阶段之后 |

## 执行约定（沿用 AGENTS.md）

- 每阶段完成后走完整发版流程：四处版本号（`js/app.js` ×2、`package.json`、`CHANGELOG.md`）+ 三目录同步 + `build-all.ps1` 出包
- 新增 js/css 文件同样受三目录同步约束（`sync-web.mjs` 会覆盖）
- 阶段一完成后，后续所有提交前先跑 `npm run verify && npm test`
