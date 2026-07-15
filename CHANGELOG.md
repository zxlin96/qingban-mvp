# 轻伴 MVP 变更日志

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
