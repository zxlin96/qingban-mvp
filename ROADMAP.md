# 轻伴 ROADMAP — 下一阶段规划

> 制定于 2026-09-18，基于 v3.4.7 现状。定位：**个人自用打磨**（发布合规暂缓，见文末）。
> 顺序：工程地基 → 数据备份 → 趋势可视化 → 主动陪伴与记录提效 → 目标与进度。先保数据安全，再做价值展示，再主动触达，再目标牵引。

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

## 阶段四：主动陪伴与记录提效（预计 8~12 个工作日）✅ 已完成开发 — v3.7.0（2026-09-19），**待真机验收**

> 制定于 2026-09-19，基于 v3.6.1 现状。合并原暂缓项"主动陪伴教练"（三阶段已完成的排期时点已到）与"快捷记录"（可视化已上线，触发条件满足）。语音输入继续暂缓（见文末暂缓项表）。

目标：把"被动应答"升级为"主动触达"——通知从 WebView 内前台横幅升级为系统级可靠调度（App 被杀后仍可达）；同时降低记录摩擦、用结构化双写提升趋势数据可靠性。

### 4.1 通知底座升级（Capacitor LocalNotifications）

- 现状缺口：`notification-manager.js` 走 Web Notification API，Android WebView 壳内拿不到授权，实际只有前台横幅生效；打卡提醒靠 `setInterval` 每 2 小时轮询，App 被杀即失效
- 新增依赖 `@capacitor/local-notifications`，`notification-manager.js` **双轨适配**：Capacitor 环境走系统级通知，Web 环境降级现有 Web Notification + 应用内横幅（不破坏本地开发）
- 补齐两种调度原语：每日定点（`schedule.on: { hour, minute }`，`allowWhileIdle`）+ 一次性（`schedule.at`），替代 setTimeout / setInterval
- 启动时 reconcile：系统已注册通知与 `.meta/notifications.json` 对账，清理过期、补齐缺失
- 通知点击路由：`localNotificationActionPerformed` 监听 → 按通知类型拉起对应面板（打卡 / 趋势 / 聊天）
- 权限请求时机：首次进入"提醒设置"或首次启用提醒时请求，不启动即弹

**关键约束**：LocalNotifications 的通知内容是预置的，发送时不能跑 LLM。所有定点通知正文用**模板 + 结构化数据**（从 `.meta/daily-stats.json`、habit-checkins 拼昨日摘要），点击通知拉起 App 后再由 AI 展开个性化内容——零 LLM 调用、离线可用。

### 4.2 主动陪伴场景

- **晨间问候**（默认 8:00，可配）：通知文案模板化（昨日体重变化 + 今日打卡概况），点进来 AI 自动展开
- **打卡提醒升级**：现有 setInterval 轮询改为系统级每日定点两次（如 12:30 / 20:00），静默时段（22:00~次日 7:00）规则保留
- **晚间复盘提醒**（默认 21:30，可配）："今天还没记体重？"类模板
- 新增"提醒设置"设置区：各提醒开关 + 时间，写入现有 settings

### 4.3 接通 auto-dream 自动触发

- `shouldTrigger()`（auto-dream.js 已预留、app.js 中零调用点）接入跨天流程末尾：满足条件后台静默执行周报/月报/模式分析，完成后横幅提示
- `.meta/` 新增防重记录，避免与手动触发重复执行

### 4.4 record_metrics 结构化双写（原 3.1 v2 方案）

- 新 LLM 工具 `record_metrics`：AI 写 `diet/日期.md` 的同时提交结构化数据 `{ meals, total, weight? }`，双写到 `.meta/` 侧车
- `stats-manager.js` 读数优先级：双写结构化数据 > MD 容错解析（解析保留，兜底历史数据与 AI 漏调场景）
- 同步更新 `data/CLAUDE.md` 工具使用指南
- 沿用约束：图表数据仍不注入系统提示词，不伤 KV Cache 前缀命中

### 4.5 快捷记录通道（无语音）

- 拍照按钮增强：一键"拍餐照"模式，照片自动携带"帮我记录这餐饮食"意图发送，省去打字
- 聊天页快捷 chip：常见记录（喝水 / 加餐 / 记体重）一键填充发送

### 测试与验收

- node:test：双轨适配分支、reconcile 对账、模板文案生成、record_metrics 参数校验与优先级合并
- `docs/REGRESSION.md` 增补：通知权限流、杀 App 后定点通知、点击路由、快捷记录、双写后趋势图一致性
- 真机重点验证：Android 12+ 精确闹钟（SCHEDULE_EXACT_ALARM / allowWhileIdle）与国产 ROM 杀后台场景——LocalNotifications 属系统 AlarmManager 级调度，可靠性应显著高于现状轮询

**验收标准**：杀掉 App 后次日晨间问候仍准时弹出（真机过夜验证）；点击通知正确拉起对应面板；Web 模式（本地开发）通知行为不回退；双写上线后趋势面板对当日新记录读双写数据、对历史记录仍走 MD 解析；全量测试通过。

---

## 阶段五：目标与进度系统（预计 4~6 个工作日）

> 制定于 2026-09-20，基于 v3.7.0 现状。**开工前提：v3.7.0 已 commit + 出包 + 真机过夜验收通知通过**（避免在未验收的通知底座上叠加功能）。

目标：补上"目标牵引"层。目标数据已存在（PROFILE.md 文字：目标体重 72kg / 目标日期 2026-10-01）但只活在 AI 记忆里——产品层无目标面板、无进度计算，趋势图无目标线（3.2 节原计划的欠账），`buildCaloriesSvg` 的 `goal` 参数至今闲置。数据链路已齐（体重序列 + record_metrics 双写 + 打卡），水到渠成。

### 5.1 目标数据层（双写模式，沿用 record_metrics 模式）

- 新模块 `js/goal-manager.js`：
  - 结构化存储 `.meta/goals.json`：`{ targetWeight, targetDate, weeklyRate?, dailyCalorieGoal?, updatedAt, history: [...] }`（目标修改保留历史可追溯）
  - `setGoal()`：写 goals.json + 同步更新 `data/GOALS.md`（AI 记忆文件，进系统提示词固定前缀，KV Cache 命中不受影响）
  - `computeGoalProgress(weights, goal, todayStr)` 纯函数：当前/初始体重、进度百分比、剩余 kg、剩余天数、近 7/30 天实际速率、**预测达成日期**（按近 30 天速率线性外推，速率 ≤ 0 返回 null）、健康校验（> 1.5kg/周 过快 / < 0.2kg/周 停滞）
- 新 LLM 工具 `set_goal`：`{ targetWeight, targetDate?, weeklyRate?, dailyCalorieGoal? }` — 对话中说"目标 10 月 1 日减到 72 公斤"即可设置/更新
- `data/CLAUDE.md` 新增"目标管理"指引：围绕目标给建议，用户提到目标变化时调用 set_goal

### 5.2 目标面板（趋势面板内嵌，不新开入口）

- 趋势面板顶部新增"🎯 目标"分组：
  - 进度条（初始 → 当前 → 目标）+ 剩余 kg / 剩余天数
  - 实际速率 vs 期望速率对照 + 健康提示
  - 预测达成日期；按当前趋势无法预测时给出明确文案
- 无目标时显示引导："对话中说『目标 X 月 X 日减到 X 公斤』即可设置"

### 5.3 图表目标线（补 3.2 节欠账）

- `buildWeightSvg` 加 `goal` 参数：目标水平虚线 + y 轴范围包含目标值
- `buildCaloriesSvg` 的闲置 `goal` 参数接通：goals.json 有 `dailyCalorieGoal` 时传入画每日目标线，无则维持现状

### 5.4 周报目标维度

- 跨天周报数据段追加目标进度摘要（computeGoalProgress 输出）；提示词要求解读：本周速率 vs 期望、预计达成日期、调整建议
- 手动「生成本周周报」同样生效

### 测试与验收

- node:test：computeGoalProgress（正常/无目标/停滞/过快/增重/已达成/预测边界）、set_goal 参数校验与 history 追溯、buildWeightSvg 目标线
- `docs/REGRESSION.md` 增补：对话设置目标 → 面板出现、目标线渲染、周报目标解读、目标修改后图表即时更新

**验收标准**：对话设置目标后趋势面板出现目标分组与进度预测；体重折线含目标线；周报含目标维度解读；无目标用户视图无回退；全量测试通过。

---

## 暂缓项（触发条件明确再做）

| 事项 | 触发条件 |
|---|---|
| BYOK / 正规 API 接入（解决讯飞 4.2.3 合规限制） | 决定对外发布时；`spark-llm.js` 已支持 OpenAI/Anthropic 协议，改造成本可控 |
| 语音输入 | 快捷记录通道（4.5）已随 v3.7.0 上线，待真机使用 1~2 周的记录摩擦反馈决定；WebView 内 Web Speech API 不可用，需评估第三方语音插件质量与风险 |

## 执行约定（沿用 AGENTS.md）

- 每阶段完成后走完整发版流程：四处版本号（`js/app.js` ×2、`package.json`、`CHANGELOG.md`）+ 三目录同步 + `build-all.ps1` 出包
- 新增 js/css 文件同样受三目录同步约束（`sync-web.mjs` 会覆盖）
- 阶段一完成后，后续所有提交前先跑 `npm run verify && npm test`
