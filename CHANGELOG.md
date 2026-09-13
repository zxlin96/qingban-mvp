# 轻伴 MVP 变更日志

## 2026-08-31 (v3.4.7)

### 修复
- **OpenAI 格式 maxOutputTokens 配置不生效**：非流式（`spark-llm.js:372`）与流式（`:465/:466`，含代理/直连）payload 原本不传 `max_tokens`，配置无效、用服务端默认。现统一加 `max_tokens: baseMax`（`baseMax = settings.maxOutputTokens || … || 8192`），代理端点 `server.js` 透传给上游

### 优化
- **Anthropic 格式 maxTokens 简化**：`spark-llm.js:344/:612` 原 `hasImages ? Math.min(baseMax, 32768) : baseMax`，因 settings 上限已 32768，`Math.min(baseMax, 32768) === baseMax`，冗余且耦合写死数字。简化为 `const maxTokens = baseMax`，配置直接生效、无写死
- **涉及文件**：`js/spark-llm.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.6)

### 修复
- **跨天流程被砍断（21天习惯总结丢失/只剩三步）**：启动跨天时 `handleDayRollover` 被 `_withTimeout(..., 30000)` 包裹，但流程含多步大模型调用（`saveDailySummary` + `refreshHabits(21)` + 周度总结），单步 20-40s，30s 整体超时会在步骤 3（21天习惯总结）中途砍断，导致步骤 3 未完成、步骤 4/5/6（打卡报告/重建索引/清空历史）未执行，遮罩只显示 3 个步骤。就绪标记已提前（v3.4.3），跨天不再阻塞启动，故将超时放宽到 5 分钟（300s），让 6 步全部跑完
- **涉及文件**：`js/app.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.5)

### 修复
- **typing 用时不显示 + 跳动周期异常**：`.typing-wait` 是 `<span>`，被 `.typing span` 规则匹配，误设为 7×7px 圆点 + bounce 动画——文字塞不进 7px 宽度（看不到用时），且该点无 animation-delay、与第 1 点同步跳（周期奇怪）。将跳动点选择器改为 `.typing span:not(.typing-wait)`，排除文字 span
- **涉及文件**：`css/style.css` 及 `www/`、`android/app/src/main/assets/public/` 同步副本

## 2026-08-31 (v3.4.4)

### 优化
- **请求等待秒数样式统一**：将"已等待 Xs"从独立浮动黑条（`#reqStatusBar`，固定底部、黑色圆角）移至 typing 指示器气泡内——三个跳动点后跟一段小字"🖼️ 等待响应 · 3s"，与聊天气泡风格一致。`_showReqStatus()` 改为更新 `#typingIndicator` 内的 `.typing-wait`，`_hideReqStatus()` 空操作（typing 由 `hideTyping()` 统一移除）
- **涉及文件**：`js/app.js`、`css/style.css` 及 `www/`、`android/app/src/main/assets/public/` 同步副本

## 2026-08-31 (v3.4.3)

### 修复
- **跨天"启动超时"误报**：跨天（每日更新）生成昨日总结需调大模型，耗时超过 `www/index.html` 的 20s 启动看门狗时，`__qbAppReady` 尚未置位导致弹出"启动超时"横幅，但实际启动成功（总结完成后横幅被移除）。现将就绪标记（`_markAppReady()`）提前到跨天重活之前——跨天总结不再阻塞"启动就绪"判定，看门狗不再误报
- **涉及文件**：`js/app.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.2)

### 修复
- **图片+工具调用停止**：Anthropic 格式下含图片时 `max_tokens` 被硬性压到 4096，K3 thinking 模式消耗完后工具调用参数未输出完即触发 `stop_reason: max_tokens` 截断，服务层检测到后跳过工具执行。现将含图片时的上限放宽到 32K（`Math.min(baseMax, 32768)`）

### 新增
- **max_tokens 截断诊断日志**：`spark-llm.js` 的 `_streamOpenAI`/`_streamAnthropic` 返回前在 `stop_reason==max_tokens` 时打印 model/hasImages/maxTokens/contentLen/各工具 argsLen/usage；`llm-service.js` 跳过工具执行时打印 hasImages/thinkingLen/contentLen/各工具 argsLen+argsHead/usage/model，协助判断是 thinking 占满还是参数过长
- **涉及文件**：`js/spark-llm.js`、`js/llm-service.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-20 (v3.4.0)

### 优化
- **真摘要生成**：`saveDailySummary` 改为调用 LLM 生成 300-500 字真摘要，强制保留饮食/体重/打卡等关键事实数据原值；LLM 失败时降级为全文拼接，保证摘要始终可用
- **数据完整性智能过滤**：`_dataIntegrityCheck` 改为智能过滤策略，保留所有 user 消息与图片识别的 AI 回复，跳过纯文字聊天的 AI 回复，减少误报
- **涉及文件**：`js/chat-manager.js`、`js/app.js`、`js/spark-llm.js`、`js/mock-llm.js` 及 `www/js/` 同步副本

## 2026-08-12 (v3.3.0)

### 新增 — KV Cache 三层缓存优化
- **第一层：System Prompt 结构重排**：固定内容（CLAUDE.md、用户档案、身体指标、偏好、习惯等）移到提示词最前面，动态内容（当前时间、近 7 天饮食记录、打卡状态）移到后面。让 Kimi 服务端 KV Cache 的前缀部分保持稳定，提升缓存命中率
- **第二层：固定前缀内存缓存**：`LLMService` 新增 `_cachedPrefix` 机制，固定文件内容读取后缓存在内存中，后续请求直接复用，跳过 7 次 IndexedDB 读取和字符串拼接。当 `write_file` 或 `append_file` 修改固定文件时自动失效缓存
- **第三层：客户端响应缓存（LRU + TTL）**：`chat()` 方法新增响应级缓存，对 30 秒内相同的（对话历史 + 用户消息）请求直接返回缓存结果，跳过 API 调用。仅缓存无工具调用的纯文本回复，带图片/工具调用的请求不缓存
- **缓存失效机制**：`executeTool` 中的 `write_file` 和 `append_file` 自动检测是否修改固定文件，触发前缀缓存失效

### 修改
- **llm-service.js**：新增 `_buildFixedPrefix()`、`_getFixedPrefix()`、`_invalidatePrefixCache()`、`_computeResponseCacheKey()`、`_getResponseFromCache()`、`_setResponseCache()` 6 个缓存方法；重构 `buildSystemPrompt()` 使用缓存前缀 + 动态后缀结构；`chat()` 方法增加响应缓存查询和写入逻辑；`chatStream()` 方法初始化 `_pendingCacheKey` 避免缓存污染
- **同步目录**：`js/`、`www/js/`、`android/app/src/main/assets/public/js/` 三个目录均已同步

## 2026-08-12 (v3.2.0)

### 修改
- **默认非流式输出**：`sendMessage` 和 `_retryLastMessage` 均改用 `llmService.chat()`（非流式），等待完整响应后一次性显示，配合 30 次重试机制在弱网环境下更稳定
- **app.js**：移除流式回调相关代码（streamDiv、thinkingText 等），简化为 typing 指示器 → 完整回复的流程

## 2026-08-11 (v3.1.0)

### 新增
- **流式请求超时保护**：流式 fetch 添加 30 秒连接超时（AbortController）和 90 秒读取超时，防止请求无限挂起
- **流式请求自动重试**：流式 fetch 添加 3 次网络错误重试（指数退避），与非流式请求重试机制对齐
- **流式中断容错**：流式读取中断时（后台切换、网络波动），返回已接收的部分内容而非直接报错
- **LLM 服务层容错**：`chatStream` 方法添加 try-catch，检测 `stop_reason: 'error'` 时跳过工具调用直接返回
- **重试按钮**：网络中断或出错时，消息下方显示「🔄 重试」按钮，点击自动重新发送上一次消息
- **后台中断检测**：APP 从后台恢复时检测请求是否被中断，记录后台时长用于诊断

### 修改
- **spark-llm.js**：`_streamOpenAI` 和 `_streamAnthropic` 方法重构，使用 `_fetchStreamWithRetry` 和 `_readWithTimeout` 辅助方法
- **llm-service.js**：`chatStream` 方法添加 LLM 调用 try-catch 和 `stop_reason: 'error'` 检测
- **app.js**：`sendMessage` 保存消息上下文，添加 `_retryLastMessage` 和 `_appendRetryButton` 方法，后台事件监听增强
- **style.css**：新增 `.stream-retry-btn` 重试按钮样式

## 2026-08-07 (v3.0.0)

### 新增
- **习惯打卡系统**：独立面板 + 聊天联动双入口，支持 AI 推荐习惯和用户自定义习惯
- **HabitManager 模块**：新增 `habit-manager.js`，基于 IndexedDB 存储习惯列表（`.meta/habits.json`）和打卡记录（`.meta/habit-checkins.json`）
- **数量打卡**：支持带数量的打卡（如喝水 0.5L、跑步 30 分钟），同一天可多次打卡累加
- **目标与进度追踪**：每个习惯可设每日目标，面板实时显示完成进度百分比和连续打卡天数
- **习惯打卡面板**：顶栏新增打卡按钮，弹出全屏面板展示今日习惯卡片、进度条、快速打卡、添加/删除习惯
- **4 个 LLM 工具**：`checkin_habit`（对话中打卡）、`get_habit_status`（查询状态）、`suggest_habit`（推荐习惯）、`add_habit`（添加习惯）
- **系统提示词注入**：每次对话自动注入今日打卡状态，让 AI 了解用户各习惯的完成进度
- **跨天习惯日报**：跨天时自动生成昨日习惯完成情况总结
- **刷新习惯总结**：菜单新增「刷新习惯总结」按钮，手动触发习惯档案分析
- **CLAUDE.md v11**：新增习惯打卡系统使用指南，说明 4 个工具的触发场景和使用原则
- **INDEX.md v3**：新增习惯打卡数据文件路径索引

### 修改
- **app.js**：集成 HabitManager，注册 4 个 LLM 工具回调，绑定面板事件，跨天处理集成习惯日报
- **llm-service.js**：新增 4 个工具定义、executeTool 分发逻辑、buildSystemPrompt 注入今日打卡状态
- **index.html**：新增打卡面板 HTML、添加习惯表单、顶栏打卡按钮、SVG 图标
- **style.css**：新增打卡面板、习惯卡片、进度条、添加习惯表单样式

## 2026-07-08

### 修复
- **UTC 时区 bug**：`_getToday()` 从 `toISOString()`（UTC）改为本地时间 `getFullYear/getMonth/getDate`，修复凌晨 0-8 点日期差一天的问题
- **跨天检测条件**：重启检测移除 `history.length > 0` 要求，即使昨天没聊天日期变了也会推进
- **后台定时器增强**：从单一 `setInterval` 扩展为 4 层检测（60秒定时器 + 5分钟兜底 + visibilitychange + Capacitor appStateChange）

### 新增
- **熬夜不跨天**：凌晨 0-4 点不触发跨天总结，熬夜聊天仍算前一天；4 点后自动跨天。熬夜时段显示提示「🌙 还在熬夜呀？凌晨 4 点前仍然算前一天」

## 2026-07-07

### 新增
- **后台定时跨天检测**：APP 运行中每 60 秒检查日期变化，无需重启即可自动跨天总结
- **完整 Markdown 渲染**：`formatMarkdown()` 支持标题/列表/表格/代码块/引用/分割线/链接，替换原来只支持粗体和行内代码的简陋实现
- **记忆面板 Markdown**：记忆面板内容从 `<pre>` 纯文本改为 Markdown 格式化渲染

### 修复
- **rules 文件保护**：`allergies.md`、`preferences.md`、`exercise.md` 从"版本号覆盖"改为"只创建不覆盖"，防止 AI 写入的用户数据被升级覆盖

## 2026-07-06

### 新增
- **首次使用引导**：检测 `.meta/onboarded` 标记，首次打开弹出引导表单收集基本信息（昵称/性别/年龄/身高/体重/目标/过敏/偏好/运动），自动计算 BMI 和基础代谢
- **拍照菜单**：点击相机按钮弹出「拍照 / 从相册选择」菜单，拍照模式调用后置摄像头（`capture="environment"`）
- **记忆面板**：顶栏新增文件夹图标「记忆」按钮，全屏弹窗按标签页分类展示所有记忆文件，日期类用时间线卡片展示
- **对话历史持久化**：聊天记录存入 IndexedDB（`.meta/chat-history.json`），重启 APP 恢复当天对话
- **时间信息注入**：系统提示词注入当前日期、星期、8 个时段判断（深夜/早晨/上午/中午/午休/下午/晚上/夜间）及对话策略
- **健康生活建议**：CLAUDE.md 新增 7 类健康提醒规则（饮水/进食节奏/运动/睡眠/进食顺序/情绪/季节）
- **时间判断增强**：注入今天/昨天/明天的完整日期和星期，明确标注工作日/周末，防止 AI 推算错误
- **重启自动跨天**：`init()` 检测 `savedDate < today` 自动触发跨天总结
- **体重更新规则**：CLAUDE.md 新增 5 步体重记录流程，明确要求 AI 调用 `write_file` 更新 BODY_METRICS.md
- **CLAUDE.md 版本号自动升级**：系统文件头部添加 `version: N`，启动时检测版本号自动覆盖升级，无需卸载重装

### 修改
- **日期自动获取**：移除硬编码 `'2026-07-05'`，使用 `_getToday()` 获取真实日期
- **空白默认模板**：`rules/allergies.md`、`preferences.md`、`exercise.md`、`PROFILE.md`、`BODY_METRICS.md` 全部改为空白模板，等 AI 在对话中逐步填充
- **去掉同日压缩**：移除 `sendMessage()` 中的 `needsCompact` 检查，同一天内完整保留上下文
- **learned-habits.md 保护**：从"版本号覆盖"改为"只创建不覆盖"

### 移除
- **示例照片按钮**：删除底部「模拟早餐/午餐/晚餐」三个彩色按钮

## 2026-07-05

### 新增
- **讯飞 Coding Plan 集成**：创建 `server.js` 后端代理 + `spark-llm.js` 适配器，`USE_REAL_LLM` 开关切换真实模型/MockLLM
- **重置数据引导**：`showResetModal()` 弹出表单收集用户信息，`performReset()` 写入个性化 PROFILE.md 和 BODY_METRICS.md
- **自动学习机制**：创建 `profile-learner.js`，跨天时 ProfileLearner 从对话中提取 7 维度习惯（饮食/用餐场所/作息/运动/工作环境/情绪/其他），合并到 `rules/learned-habits.md`
- **习惯打卡**：跨天时 LLM 根据学习到的习惯生成个性化跟进问题
- **多照片上传**：`pendingPhoto` 改为 `pendingPhotos` 数组，支持多选、预览、单独删除
- **主题切换**：三套主题（深色科技/浅色清新/暖调米黄），CSS 变量驱动，localStorage 持久化
- **Auto Dream 图标**：新增 `#icon-dream` SVG 符号（星星图案）
- **APK 打包**：Android SDK + JDK 21 + Capacitor 环境，`spark-llm.js` 双模式（APK 直连讯飞 + 开发代理），`app-config.js` 打包 API Key，CapacitorHttp 绕过 CORS，`buildDir` 重定向解决沙箱权限

### 修改
- **调试按钮隐藏**：`rebuildIndexBtn`、`resetBtn`、`nextDayBtn` 添加 `display:none`

### 初始项目结构
- 纯前端 SPA，模拟 Claude Code 四种记忆机制
- 本地 MD 文件（IndexedDB）+ Function Calling + 上下文压缩 + Auto Dream
- MockLLM 模拟通义千问 Plus（规则引擎，无真实 LLM 调用）
- 三栏布局：文件树 / 聊天 / 上下文信息+工具日志
