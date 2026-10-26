// app.js — 轻伴 MVP 主控制器
// 串联 FileManager / SparkLLM / LLMService / ChatManager / DietRecorder

// ===== 版本号 =====
// 每次发布修改版本号，App 启动时显示在顶栏，点击可查看 CHANGELOG
const APP_VERSION = '3.20.0';
const APP_VERSION_DATE = '2026-10-26';
// 暴露版本到全局：启动诊断横幅据此判断新包是否真的加载到了最新代码
window.__qbVersion = APP_VERSION;

// 跨天后台结算的断点续跑快照（含昨日历史快照 + 步骤状态，结算完成后删除）
const ROLLOVER_PENDING_KEY = '.meta/rollover-pending.json';
// 晚间草稿预生成标记（记录当天草稿覆盖到的 historyLen，跨天结算据此秒过摘要步骤）
const DRAFT_KEY = '.meta/daily-draft.json';

const CHANGELOG = [
  {
    ver: '3.20.0', date: '2026-10-26',
    items: [
      '新增：支持蚂蚁阿福 A1 款体脂秤（AFU-WL-TZ-A1，沃莱标准协议）— 真机日志确认 A1 与 B1 协议完全不同（FFB0/FFB1/FFB2 + 0xAC 帧），现按 GATT 树自动识别双协议；A1 流程：连接触发 FFB2 通知 → 写用户资料 → 0xD5 实时体重（锁定位）→ 0xD6 阻抗帧完成；体成分按 Segal(1988) BIA 公式本地估算（无有效阻抗时 Deurenberg 兜底，体重稳定 15s 无阻抗按仅体重收尾）；广播中解析 deviceType（0x27AC 数据），新增 9 项协议单测，全量 186 项通过'
    ]
  },
  {
    ver: '3.19.1', date: '2026-10-26',
    items: [
      '修复：真机扫描收不到任何蓝牙广播（调试日志显示 20s 回调 0 次）— 此前按 service 0xfc50 做硬件过滤，秤广播包不带该 service UUID 时结果被整体滤掉；改为全量扫描（LOW_LATENCY）+ 回调内按「名字含 AFU」匹配（openScale 判定法）+ serviceData 带 fc50 无名设备兜底；窗口 20s→30s；候选广播全留痕，超时报错区分「0 广播（查系统定位开关/重启蓝牙）」与「有广播名字不匹配（列设备名）」；新增定位服务状态诊断日志'
    ]
  },
  {
    ver: '3.19.0', date: '2026-10-25',
    items: [
      '新增：PWA 网页版适配（iOS 分享用）— 补全 manifest/图标/Apple 触屏图标，Safari「添加到主屏幕」即独立窗口全屏运行；刘海屏安全区适配与输入框 16px 防 iOS 聚焦缩放（仅浏览器环境生效，APK 不变）；Service Worker 网络优先离线兜底（仅浏览器注册）；iOS/微信首次访问显示安装引导条；非原生环境隐藏蓝牙体脂秤全部入口；「Kimi K3 全量配置」预设环境自适应 — APK 走 Coding Plan 默认，网页版直连 Kimi 开放平台（api.moonshot.cn，实测浏览器可 CORS 直连，Coding Plan 地址浏览器不通）'
    ]
  },
  {
    ver: '3.18.3', date: '2026-10-25',
    items: [
      '优化：聊天输入框上方新增「蓝牙称重」快捷按钮 — 一点即开弹窗并自动开始搜秤（免二次点击），直接进入体脂秤搜索阶段；称重进行中再点只切回现场不重置状态；浏览器网页版点击仍给出"请用 APK"提示'
    ]
  },
  {
    ver: '3.18.2', date: '2026-10-25',
    items: [
      '修复：点击「蓝牙体脂秤」菜单无反应 — 弹窗层 .file-viewer 的 CSS 默认 display:none，打开时只清了内联样式没写 flex，导致弹窗实际已创建但不可见；现与模型设置弹窗同款以内联 flex 覆盖，浏览器实测弹窗正常弹出'
    ]
  },
  {
    ver: '3.18.1', date: '2026-10-25',
    items: [
      '增强：蓝牙体脂秤全链路调试日志 — 三路输出（console / 内存环形缓冲 / .meta/scale-log.md 持久化，记忆面板可查看），覆盖扫描候选广播、GATT 树快照、每一帧收发 hex 与解析拒因、状态机每步翻转、失败现场快照（标志位+计数+最近帧）；弹窗新增「复制调试日志」按钮一键带走，异常收敛不再靠猜'
    ]
  },
  {
    ver: '3.18.0', date: '2026-10-25',
    items: [
      '新增：蓝牙体脂秤直连（蚂蚁阿福 AFU-BH-TZ-B1 · 沃莱）— 菜单新增「蓝牙体脂秤」，蓝牙直读体重+阻抗，体脂率/骨骼肌/水分/骨量/内脏脂肪按官方公式本地计算，写入 BODY_METRICS.md 后自动触发 AI 读取分析，秤内历史一并补入趋势表；29 个协议单测与 openScale 抓包帧逐字节对齐；浏览器网页版不支持蓝牙（仅 APK 可用）'
    ]
  },
  {
    ver: '3.17.0', date: '2026-10-24',
    items: [
      '优化：界面现代化清新化 — 文件查看器支持 Markdown 渲染（标题/表格/列表/引用/代码块/front-matter 日期徽标，此前为纯文本铺陈）；趋势图打磨（体重图渐变面积、热量图中位网格参照线、宏量图图例圆点化+柱顶圆角）；全局质感升级（药丸按钮微动效、卡片描边+柔和阴影、弹层毛玻璃、细滚动条、聊天气泡柔和化）'
    ]
  },
  {
    ver: '3.16.3', date: '2026-10-24',
    items: [
      '修复：打卡热力图格子挤在左上角显示不全 — v3.6.0 起格子仅 11px、只占画布宽度 30%（右侧大片空白），现按画布宽度反推格子尺寸并居中铺满，视觉与体重/热量图对齐'
    ]
  },
  {
    ver: '3.16.2', date: '2026-10-24',
    items: [
      '修复：趋势面板「三大营养素」日均被全零数据天摊薄 — 初始化写入的 0/0/0 天不画柱子却计入日均分母，导致日均与柱子标注对不上（如柱 326g 而日均合计仅 164g）；现与画柱口径一致，全零天不参与平均'
    ]
  },
  {
    ver: '3.16.1', date: '2026-10-24',
    items: [
      '安全：移除内置 Kimi API Key（原 Key 已在官方后台吊销失效）— 代码与 APK 不再携带任何密钥，API Key 改为在「设置 → 连接配置」中填写、仅存本机；浏览器开发模式不受影响（仍走本地代理）'
    ]
  },
  {
    ver: '3.16.0', date: '2026-10-24',
    items: [
      '优化：图片预识别携带辅助上下文 — 识别阶段注入用户食物种类清单（rules/food-types.md，前 1500 字）与当日对话记录（至多 2000 字），视觉模型可结合用户常吃食物与当天聊天内容更准地识别（家常菜名、上午提过的餐食不再凭空猜）；上下文构建失败自动降级为零上下文识别，不影响原流程'
    ]
  },
  {
    ver: '3.15.0', date: '2026-10-24',
    items: [
      '新增：营养分析全面加强 — 饮食记录从"仅热量"扩展为三大宏量营养素（每餐估算蛋白质/碳水/脂肪克数），当日汇总新增总营养素与「营养观察」（按食物组定性标记微量元素缺口，为补剂判断提供依据）',
      '新增：营养目标体系 — 蛋白质 1.2~1.6g/kg 等公式写入 BODY_METRICS.md「营养目标」节；对话中可问"营养分析/缺什么/要不要补剂"，AI 汇总近 7 天饮食给结论（食物优先、持续缺口才提补剂、遵医嘱）',
      '新增：record_metrics 工具支持宏量营养素双写（餐次与日总量），趋势面板新增「三大营养素（近 7 天）」堆叠柱状图（附蛋白质建议区间）',
      '新增：AI 周报新增「营养素与补剂」段 — 汇总近 7 天宏量日均与营养观察缺口，输出食物优先改善建议与补剂参考；昨日总结饮食线包含三大营养素概要',
      '优化：21 天 AutoDream 分析纳入日均蛋白质，持续偏低时给洞察提示'
    ]
  },
  {
    ver: '3.14.0', date: '2026-10-24',
    items: [
      '新增：食物种类记忆 — 新记忆文件 rules/food-types.md（主食/蛋白质/蔬菜/水果/饮品/零食加餐/外卖外食/其他分类），AI 记录饮食发现新食物自动归类追加（清单已固定注入系统提示词，无需额外读取），推荐食物优先选用户熟悉的、种类单一时温和建议多样化',
      '新增：食物种类结算兜底 — 跨天结算数据完整性检查新增第 6 项（对话中出现的新食物 vs food-types.md），遗漏时自动补写',
      '新增：记忆面板新增「食物种类」分组；food-types.md 纳入每日记忆快照（误删可回滚）'
    ]
  },
  {
    ver: '3.13.4', date: '2026-10-13',
    items: [
      '优化：设置页连接配置增加填写提示 — BASE URL 标注"不要带末尾 /chat/completions，程序会自动拼接"，模型选择组标注"需与 API 服务端模型名一致"，避免误填导致 404'
    ]
  },
  {
    ver: '3.13.3', date: '2026-10-11',
    items: [
      '修复：工具调用轮次耗尽时不再丢弃已生成内容 — chat/chatStream 兜底返回保留 finalContent 并附准确提示，文案从误导性的"处理超时"改为"已处理 N 轮工具调用但未完成"；加诊断日志记录工具调用链便于排查 AI 循环'
    ]
  },
  {
    ver: '3.13.2', date: '2026-10-10',
    items: [
      '优化：移除聊天输入框底部快捷 chip（喝水/记体重/加餐）— 精简界面，相关 HTML/CSS/JS 一并清理'
    ]
  },
  {
    ver: '3.13.1', date: '2026-10-09',
    items: [
      '新增：模型设置新增「连接配置」分组 — 可配置 API 协议格式（openai/anthropic）、请求地址 BASE URL、API Key、请求超时、重试次数、自定义请求头、上下文窗口大小，运行时切换不同大模型服务无需改代码或重新打包',
      '优化：SparkLLM 连接参数动态刷新 — 在设置 UI 修改后立即生效（每次请求前 _refreshConn），超时/重试/自定义请求头从 QINGBAN_SETTINGS 读取',
      '修复：保存设置时丢失 onDemandLoad/onDemandTokenBudget/settlement 等未在 UI 暴露的字段'
    ]
  },
  {
    ver: '3.13.0', date: '2026-10-09',
    items: [
      '新增：每日结算步骤可配置 — 菜单「结算设置」勾选需要执行的步骤（昨日摘要/数据检查/习惯刷新/打卡记录/周度总结/记忆快照/AI周报/重建索引/刷新提醒/AutoDream 共 10 项），未勾选的步骤在凌晨跨天结算时自动跳过',
      '优化：settings.js 深合并 settlement/reminders 子对象 — 旧用户存档缺新增开关时自动补默认值，不再出现 undefined'
    ]
  },
  {
    ver: '3.12.0', date: '2026-09-27',
    items: [
      '新增：昨日总结三层提前结算 — 晚间 22:00+ 静默预生成草稿、凌晨 04:05 后台对齐结算（失败 15 分钟自愈重试至 9:00）、早打开断点续跑；早上打开即可见完整问候',
      '新增：单一入口闸门（settlement-gate）— 后台重试与用户打开恢复互不冲突，杜绝双跑',
      '优化：21 天习惯分析降频 — 距上次刷新 ≥2 天且有新摘要才跑（明细中显示"无新数据，已跳过"）；重步骤超时 90s→150s + 失败自动重试 1 次；明细弹窗显示失败原因',
      '优化：结算状态条移入聊天区顶部并瘦身（高度约 28px），修复位置漂移；步骤文案转中性描述'
    ]
  },
  {
    ver: '3.11.1', date: '2026-09-26',
    items: [
      '修复：Android 安装包版本号长期不更新 — 系统安装界面/应用管理里的 versionName 自 v3.4.1 起停在旧版（版本号第五处 build.gradle 无人同步）',
      '新增：scripts/sync-android-version.mjs — package.json 自动同步 build.gradle 的 versionName/versionCode，npm run sync/verify 与 build-all.ps1 均已接入'
    ]
  },
  {
    ver: '3.11.0', date: '2026-09-26',
    items: [
      '优化：CLAUDE.md v11 → v12 无损压缩（6,242 → 3,495 字符，-44%）— 重复教学去重、示例减半、新增文件地图节引导模型主动查文件；饮食格式模板等红线一字未动',
      '优化：固定前缀纯静态化 — PROFILE/身体指标移出 KV 缓存前缀（7,602 → 4,095 字符，-46%），记体重不再失效整个缓存',
      '新增：npm run prompt:eval 行为评测集 — 10 用例真实 LLM 只比工具调用行为（含 2 个召回用例），压缩前后均全部通过',
      '清理：删除 data/CLAUDE.md 旧模板；时间判断块表格化'
    ]
  },
  {
    ver: '3.10.0', date: '2026-09-26',
    items: [
      '新增：跨天结算后台化 — 打开 APP 立即可聊天，昨日摘要/习惯总结/周报等在后台顺序执行，顶栏状态条实时显示进度（点击看明细）',
      '新增：结算断点续跑 — 结算中被杀 APP 后再次启动自动从快照恢复，昨日数据不丢',
      '优化：问候拆两段 — 先发简短问候立即可聊，结算完成后再发含昨日总结的完整问候（已开聊则只发轻提示）',
      '优化：结算完成后自动失效 KV 前缀缓存（learned-habits 等固定文件后台更新后，AI 立即感知新档案）'
    ]
  },
  {
    ver: '3.9.0', date: '2026-09-26',
    items: [
      '新增：图片两阶段发送 — 图片先单独预识别（极简提示词、不带系统提示词），识别文字并入消息后主对话纯文本处理；不再切换视觉模型、工具循环不重复编码图片、可命中响应缓存',
      '修复：每条请求双发最新用户消息 — 新增 getHistoryForRequest() 弹出末尾当前消息，历史版本每次请求都把最新消息发送两遍',
      '新增：识别阶段状态条「🔍 识别图片中」；识别失败自动回退原图直发（零回归）'
    ]
  },
  {
    ver: '3.8.0', date: '2026-09-21',
    items: [
      '新增：三套界面主题（按 design/ui-proposals.html 三方案落地，与原三主题并存，菜单循环切换）— 晨雾呼吸（清新渐变+大圆角气泡）、暗色玻璃（深空光晕+弹窗毛玻璃）、暖纸手账（纸纹底+衬线标题+纸片投影）',
      '主题细节：纯视觉层实现（CSS 变量 + 少量主题特化），不动 DOM 结构与业务逻辑；毛玻璃 backdrop-filter 渐进增强，不支持时半透明底仍可读；旧主题值异常自动回退默认'
    ]
  },
  {
    ver: '3.7.0', date: '2026-09-19',
    items: [
      '新增：通知系统升级 — 接入 Capacitor LocalNotifications 系统级调度（App 被杀后提醒仍可达），Web 环境自动降级原横幅路径，启动时与系统调度对账（reconcile）',
      '新增：主动陪伴 — 晨间问候（昨日体重/打卡回顾）、打卡提醒系统级定点两次、晚间复盘提醒，均为模板文案离线生成（零 LLM 调用）',
      '新增：提醒设置 — 菜单新入口，三个提醒的开关与时间可配置，首次开启请求通知权限；系统通知点击路由到对应面板',
      '新增：Auto Dream 自动触发 — shouldTrigger 接入跨天流程，本周无周报且数据足够时后台静默生成，防重+横幅提示',
      '新增：record_metrics 双写 — AI 写 diet/MD 后同步提交结构化热量/体重，趋势读数双写数据优先、MD 解析兜底，图表可靠性提升',
      '新增：快捷记录 — 拍餐照一键模式（拍完自动发送）+ 聊天页快捷 chip（喝水/记体重/加餐）',
      '修复：跨天总结清单被超时砍断 — LLM 重试循环叠加单步无兜底，LLM 变慢时击穿全局 5 分钟超时，清单定格、后续步骤全部未执行；新增步骤级超时（四个 LLM 步骤各 90s 兜底，超时标红不阻断），总超时放宽至 8 分钟，未完成步骤不再伪装成成功',
      '修复：功能菜单溢出 — 新增「提醒设置」后菜单 14 项超出手机视口且无滚动，底部入口不可见；菜单加高度约束与滚动'
    ]
  },
  {
    ver: '3.6.1', date: '2026-09-19',
    items: [
      '优化：顶栏瘦身 — 「Auto Dream」与日期徽章移入左侧功能菜单，顶栏仅保留 记忆/趋势/打卡 三个高频入口',
      '修复：打卡面板日期导航左右箭头不显示 — 原 rotate(90deg) 复用向下箭头导致图形转出可视区，新增左/右箭头图标直接引用'
    ]
  },
  {
    ver: '3.6.0', date: '2026-09-18',
    items: [
      '新增：趋势面板 — 顶栏新入口，体重折线（近30天）/ 热量柱状（近7天）/ 打卡热力图（近28天），原生 SVG 零依赖、配色跟随主题',
      '新增：数据解析层 stats-manager — 容错解析 diet/*.md 与 BODY_METRICS.md，缓存到 .meta/daily-stats.json（源文件签名变化自动重建），历史数据零迁移直接出图',
      '新增：AI 周报 — 每周日跨天自动生成上周周报（热量/体重/习惯数据驱动），写入 weekly/日期.md；趋势面板支持手动生成',
      '优化：图表数据不注入系统提示词，KV Cache 前缀命中不受影响'
    ]
  },
  {
    ver: '3.5.0', date: '2026-09-18',
    items: [
      '新增：数据备份 — 菜单「数据备份」，一键导出全部数据为 .qb.json（记忆/饮食/对话/打卡/设置），导入完整还原',
      '新增：记忆文件自动快照 — 每次跨天自动快照 PROFILE/身体指标/rules 等关键记忆文件，滚动保留最近 7 份',
      '新增：快照手动管理 — 面板内立即快照、查看快照列表、一键回滚（防 AI 误写记忆）',
      '新增：@capacitor/filesystem 插件（APK 内写入系统目录），Web 模式自动降级浏览器下载'
    ]
  },
  {
    ver: '3.4.8', date: '2026-09-18',
    items: [
      '新增：三目录同步自动化 scripts/sync-web.mjs（npm run sync / verify），build-all.ps1 接入同一脚本',
      '新增：测试基建 npm test（node:test 零依赖），46 个用例覆盖 max_tokens/熬夜跨天/cleanMessages/KV 缓存等历史 Bug 回归',
      '新增：docs/REGRESSION.md 真机回归清单，发版前逐项过',
      '优化：server.js 可测试化（cleanMessages 导出、启动主模块判断）；熬夜跨天逻辑提取为 ChatManager.getEffectiveToday()',
      '清理：删除孤儿 data-store.js 副本与根目录构建中间物，www/index.html 启动诊断回迁根目录'
    ]
  },
  {
    ver: '3.4.7', date: '2026-08-31',
    items: [
      '修复：OpenAI 格式 maxOutputTokens 配置不生效 — 非/流式 payload 加 max_tokens: baseMax',
      '优化：Anthropic 格式 maxTokens 简化为 baseMax — 去掉冗余 Math.min(baseMax, 32768)，消除写死数字'
    ]
  },
  {
    ver: '3.4.6', date: '2026-08-31',
    items: [
      '修复：跨天流程被 30s 超时砍断 — 21天习惯总结及后续步骤丢失，只剩三步；放宽到 5 分钟让 6 步全部跑完'
    ]
  },
  {
    ver: '3.4.5', date: '2026-08-31',
    items: [
      '修复：typing 气泡用时信息不显示 + 跳动周期异常 — .typing-wait 被 .typing span 规则误设为圆点，改为 :not(.typing-wait) 排除'
    ]
  },
  {
    ver: '3.4.4', date: '2026-08-31',
    items: [
      '优化：请求等待秒数从独立浮动黑条移至 typing 指示器气泡内 — 三个跳动点后显示"等待响应 · Xs"，与聊天界面风格统一'
    ]
  },
  {
    ver: '3.4.3', date: '2026-08-31',
    items: [
      '修复：跨天（每日更新）时"启动超时"误报 — 跨天总结调大模型耗时超过 20s 启动看门狗，但实际启动成功；将就绪标记提前到跨天重活之前，跨天总结不再阻塞启动就绪判定'
    ]
  },
  {
    ver: '3.4.2', date: '2026-08-31',
    items: [
      '修复：发送图片时工具调用停止 — Anthropic 格式含图片时 max_tokens 被压到 4096，K3 thinking 消耗完后工具参数未输出完即触发 max_tokens 截断；放宽到 32K',
      '新增：max_tokens 截断诊断日志 — 请求层与服务层打印 hasImages/thinkingLen/contentLen/各工具 argsLen 等信息，协助判断截断原因'
    ]
  },
  {
    ver: '3.4.1', date: '2026-08-21',
    items: [
      '修复：打卡面板无法显示 — habitOverlay 内联 display:none 优先级高于 .show 类选择器，改为统一内联 style.display 操作'
    ]
  },
  {
    ver: '3.4.0', date: '2026-08-20',
    items: [
      '优化：saveDailySummary 改为 LLM 生成 300-500 字真摘要，强制保留关键事实数据，失败降级全文拼接',
      '优化：_dataIntegrityCheck 智能过滤，保留 user 消息与图片识别 AI 回复，跳过纯文字聊天 AI 回复'
    ]
  },
  {
    ver: '3.3.0', date: '2026-08-12',
    items: [
      '新增：KV Cache 三层缓存优化 — System Prompt 结构重排，固定内容在前、动态内容在后，提升服务端缓存命中率',
      '新增：固定前缀内存缓存 — 跳过 7 次 IndexedDB 读取和字符串拼接，每次请求省约 50ms',
      '新增：客户端响应缓存（LRU+TTL）— 30 秒内相同问题直接返回缓存，跳过 API 调用',
      '优化：write_file/append_file 修改固定文件时自动失效前缀缓存'
    ]
  },
  {
    ver: '3.2.0', date: '2026-08-12',
    items: [
      '修改：默认使用非流式输出，sendMessage 和 _retryLastMessage 均改用 chat()，等待完整响应后一次性显示',
      '优化：非流式模式自带 30 次重试，弱网环境下比流式更稳定'
    ]
  },
  {
    ver: '3.1.0', date: '2026-08-11',
    items: [
      '新增：流式请求超时保护（30秒连接超时 + 90秒读取超时），防止请求无限挂起',
      '新增：流式请求自动重试（3次网络错误重试，指数退避）',
      '新增：流式中断容错 — 后台切换/网络波动时返回已接收内容而非报错',
      '新增：网络中断或出错时显示「🔄 重试」按钮',
      '新增：APP 从后台恢复时检测请求是否被中断'
    ]
  },
  {
    ver: '3.0.0', date: '2026-08-07',
    items: [
      '新增：习惯打卡功能 — 独立面板 + 聊天联动，支持 AI 推荐和用户自定义习惯',
      '新增：带数量记录的打卡（如喝水2L、跑步30分钟），支持目标设定和达成率统计',
      '新增：连续打卡天数（streak）和近7天完成率统计',
      '新增：4 个 LLM 工具 — checkin_habit / get_habit_status / suggest_habit / add_habit',
      '新增：AI 根据习惯档案推荐打卡习惯，用户可一键采纳',
      '新增：未完成习惯自动提醒（每2小时检查，与通知系统联动）',
      '新增：跨天时自动生成昨日打卡报告，注入新一天问候上下文',
      '新增：系统提示词注入今日打卡状态，AI 对话中可自然提及打卡进度'
    ]
  },
  {
    ver: '2.9.4', date: '2026-08-05',
    items: [
      '修复：settings.js 默认 maxOutputTokens 未同步更新（仍为 8192）',
      '新增：设置加载时自动升级旧 maxOutputTokens < 32768 到 32768',
      '修复：模型设置 UI、K3 预配置、重置默认中所有硬编码 8192 统一为 32768'
    ]
  },
  {
    ver: '2.9.3', date: '2026-08-05',
    items: [
      '优化：maxOutputTokens 16384 → 32768（32K），彻底避免 K3 thinking 模式下工具调用参数被截断'
    ]
  },
  {
    ver: '2.9.2', date: '2026-08-05',
    items: [
      '修复：上传图片后工具调用 JSON 解析失败 — K3 thinking 消耗过多 token 导致参数截断',
      '优化：maxOutputTokens 8192 → 16384，适配 K3 thinking 模式',
      '新增：stop_reason 检测 — max_tokens 截断时安全跳过工具执行，提示重试',
      '新增：executeTool JSON.parse 容错 — 参数解析失败不再崩溃，返回错误信息给 LLM'
    ]
  },
  {
    ver: '2.9.1', date: '2026-08-02',
    items: [
      '修复：多张图片上传时压缩输入栏导致无法发送 — 图片预览移至输入栏上方独立区域，支持换行和滚动'
    ]
  },
  {
    ver: '2.9.0', date: '2026-08-01',
    items: [
      '新增：流式输出 — LLM 回复逐字涌现，打字机效果带闪烁光标',
      '新增：思考过程展示 — 实时显示 K3 推理思考，可折叠查看',
      '新增：工具执行提示 — Function Calling 时显示⚙️执行状态',
      '新增：server.js 流式代理端点 /api/chat/stream（SSE 透传）',
      '修复：SSE 解析兼容 data: 和 data: 两种格式',
      '修复：Kimi K3 thinking_delta 块未正确处理'
    ]
  },
  {
    ver: '2.8.0', date: '2026-07-29',
    items: [
      '新增：send_notification 工具 — 大模型可发送提醒通知（喝水/吃饭/运动/称重/睡眠）',
      '新增：通知横幅 — 从顶部滑入，带图标和颜色区分类型，8秒自动关闭',
      '新增：延迟通知 — 支持 0-任意分钟延迟，重启后自动恢复待发通知',
      '新增：系统级通知 — 尝试调用浏览器 Notification API',
      '新增：通用进度遮罩和 Toast 通知组件'
    ]
  },
  {
    ver: '2.7.0', date: '2026-07-29',
    items: [
      '新增：刷新习惯总结 — 基于近 21 天对话重新分析并更新习惯档案',
      '优化：LLM 全量分析饮食、运动、作息等模式，标注频率和趋势',
      '优化：自动清理过时习惯条目，保留永久性信息（过敏等）',
      '修复：CLAUDE.md 版本号未更新导致 ask_user 指令不生效'
    ]
  },
  {
    ver: '2.6.0', date: '2026-07-23',
    items: [
      '新增：ask_user 工具 — 大模型可向用户提问并提供选项',
      '新增：底部弹窗交互 — 用户可点击选项或自行输入回答',
      '新增：支持跳过问题（×按钮）和自定义输入（回车提交）',
      '优化：弹窗从底部滑入，带动画效果，支持深色模式'
    ]
  },
  {
    ver: '2.5.0', date: '2026-07-23',
    items: [
      '新增：Kimi K3 全量预配置 — 一键切换所有模型到 K3',
      '新增：单次回复最大 Token 可配置（1024-32768）',
      '新增：推理强度可配置（low/medium/high/max）',
      '新增：上下文窗口大小从配置读取（支持 1M tokens）',
      '优化：模型设置 UI 更新，placeholder 统一为 K3 模型名',
      '优化：Anthropic API max_tokens 从配置动态读取'
    ]
  },
  {
    ver: '2.4.1', date: '2026-07-19',
    items: [
      '新增：查看上下文功能 — 可查看当前发给大模型的完整上下文',
      '包含：系统提示词、对话历史、工具定义、Token 估算'
    ]
  },
  {
    ver: '2.4.0', date: '2026-07-19',
    items: [
      '新增：模型设置功能 — 可配置视觉/对话/摘要模型',
      '新增：温度参数（0-1 滑块）控制回复创造性',
      '新增：最大工具调用轮数可配置（1-20）',
      '新增：历史注入天数可配置（0-30 天）',
      '新增：单文件截断字数可配置（100-5000）',
      '新增：设置持久化到 localStorage，恢复默认按钮',
      '优化：重建索引/重置数据/模拟次日增加二次确认'
    ]
  },
  {
    ver: '2.3.2', date: '2026-07-15',
    items: [
      '新增：Token 用量移入功能菜单',
      '调整：重建索引/重置数据/模拟次日取消隐藏，全部显示'
    ]
  },
  {
    ver: '2.3.1', date: '2026-07-15',
    items: [
      '修复：功能菜单按钮移到最左边，下拉菜单正常显示',
      '修复：日历月份切换箭头图标渲染'
    ]
  },
  {
    ver: '2.3.0', date: '2026-07-15',
    items: [
      '新增：左上角功能菜单（汉堡按钮），收纳主题/字体/更新日志/重置等功能',
      '新增：日期徽章可点击打开日历，查看历史聊天记录',
      '新增：日历支持月份切换，有记录的日期显示彩色圆点',
      '新增：点击日期查看当天的饮食记录和对话摘要',
      '优化：顶栏精简为 日期 + 记忆 + Auto Dream 三个按钮'
    ]
  },
  {
    ver: '2.2.1', date: '2026-07-15',
    items: [
      '移除：图片下方折叠分析区（与回复内容重复）'
    ]
  },
  {
    ver: '2.1.0', date: '2026-07-15',
    items: [
      '新增：新一天问候包含昨日总结 + 今日建议（LLM 生成）',
      '新增：系统提示词注入近 7 天饮食记录和对话摘要',
      '新增：系统提示词注入过敏、饮食偏好、运动情况文件',
      '新增：版本号显示，点击可查看更新日志',
      '修复：时区 Bug — 昨日日期计算改用本地时间',
      '修复：showNewDayWelcome 未 await 导致遮罩提前关闭'
    ]
  },
  {
    ver: '2.0.0', date: '2026-07-14',
    items: [
      '新增：每日总结机制 — 跨天自动 5 步流程',
      '新增：数据完整性检查 — LLM 审查对话遗漏',
      '新增：习惯学习 — 从对话提取作息/饮食/运动习惯',
      '新增：周度习惯总结（每 7 天自动触发）',
      '新增：跨天动效遮罩 — 月亮脉冲 + 步骤清单',
      '新增：近 7 天饮食/对话摘要动态注入系统提示词',
      '新增：图片消息双格式分离（UI 显示图片 / LLM 交互用纯文本）',
      '新增：双模型选择 — 图片用 kimi，文本用 glm'
    ]
  },
  {
    ver: '1.0.0', date: '2026-07-10',
    items: [
      '初始版本',
      '三栏布局：文件浏览器 / 聊天 / 工具日志',
      'Function Calling — read_file / write_file / search_files',
      'CLAUDE.md 系统提示词 v7',
      '本地文件记忆系统（IndexedDB 持久化）',
      '拍照识别食物 + 饮食记录',
      '体重追踪 + BMI 计算',
      '三种主题：深色 / 浅色 / 暖色'
    ]
  }
];

// 模型开关:true=真实大模型(讯飞 Coding Plan,需启动 node server.js)
//          false=模拟模型(离线,零配置)
const USE_REAL_LLM = true;

import { FileManager } from './file-manager.js';
import { MockLLM } from './mock-llm.js';
import { SparkLLM } from './spark-llm.js';
import { LLMService } from './llm-service.js';
import { ChatManager } from './chat-manager.js';
import { ProfileLearner } from './profile-learner.js';
import { DietRecorder } from './diet-recorder.js';
import { AutoDream } from './auto-dream.js';
import { NotificationManager } from './notification-manager.js';
import { HabitManager } from './habit-manager.js';
import { mdToHtml, escapeHtml } from './md-render.js';
import { IndexManager } from './index-manager.js';
import { OnDemandLoader } from './on-demand-loader.js';
import { BackupManager } from './backup-manager.js';
import { SettlementGate } from './settlement-gate.js';
import { StatsManager } from './stats-manager.js';
import { ScaleManager, recordBodyMeasurement, parseProfileMd, AfuB1, scaleLog, getScaleLog } from './scale-manager.js';

class App {
  constructor() {
    this.fm = new FileManager();
    this.llm = USE_REAL_LLM ? new SparkLLM() : new MockLLM();
    this.dietRecorder = new DietRecorder();
    this.indexManager = new IndexManager(this.fm);
    this.onDemandLoader = new OnDemandLoader(this.indexManager, this.fm);
    this.llmService = new LLMService(this.fm, this.llm, this.onDemandLoader);
    this.chatManager = new ChatManager(this.fm);
    this.autoDream = new AutoDream(this.fm, this.llm, this.onDemandLoader);
    this.profileLearner = new ProfileLearner(this.fm, this.llm, this.onDemandLoader);
    this.notificationManager = new NotificationManager(this.fm);
    this.habitManager = new HabitManager(this.fm);
    this.backupManager = new BackupManager(this.fm, APP_VERSION);
    this._settlementGate = new SettlementGate();
    this.statsManager = new StatsManager(this.fm);
    this.scaleManager = new ScaleManager(this.fm);
    this.isProcessing = false;
    this.pendingPhotos = []; // 支持多张照片
    this._askUserResolve = null; // ask_user 工具的 Promise resolve
    this.sampleFoods = [
      { label: '午餐', icon: 'icon-sun', text: '这是今天的午餐', color: '#f0a070' },
      { label: '早餐', icon: 'icon-sun', text: '拍了今天的早餐', color: '#6ee7a3' },
      { label: '晚餐', icon: 'icon-moon', text: '这是晚餐', color: '#6cb6ff' },
    ];
  }

  // 单个初始化步骤的超时保护：避免某一步永久挂起导致整个启动卡死（黑屏 + 一直「加载中」）
  async _withTimeout(promise, ms, label) {
    const p = Promise.resolve(promise);
    p.catch(() => {}); // 超时后原 promise 若再报错，不触发全局未处理 rejection 弹窗
    let timer = null;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    });
    try {
      const result = await Promise.race([p, guard]);
      clearTimeout(timer);
      return result;
    } catch (e) {
      clearTimeout(timer);
      console.warn('[Init]', e.message);
      window.__qbInitWarnings = window.__qbInitWarnings || [];
      window.__qbInitWarnings.push(e.message);
      this._initWarnings = window.__qbInitWarnings;
      return null;
    }
  }

  // 步骤级超时（区别于 _withTimeout）：超时直接抛错，由调用方步骤的 catch 捕获并标记 error，
  // 保证跨天流程单个 LLM 步骤挂起（如 SparkLLM 30 次重试循环）不会拖垮整个清单
  _stepTimeout(promise, ms, label) {
    const p = Promise.resolve(promise);
    p.catch(() => {});
    let timer = null;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s，已跳过继续后续步骤）`)), ms);
    });
    return Promise.race([p, guard]).finally(() => clearTimeout(timer));
  }

  // 浏览器/PWA 环境适配 — 原生 APK 环境直接返回，不影响现有行为。
  // html.web-env 类是 CSS 作用域开关（安全区 padding / 输入框 16px 等），见 style.css 尾部。
  // 原生判断见 _isNativeEnv（三信号兜底，APK 被误判为浏览器是最坏情形：
  // 会误加 web-env 样式并在 https://localhost 原生壳里注册 Service Worker）。
  _isNativeEnv() {
    return !!(window.Capacitor?.isNativePlatform?.()
      || window.capacitor
      || window.androidBridge);
  }

  _setupWebEnvironment() {
    if (this._isNativeEnv()) return;
    document.documentElement.classList.add('web-env');

    // 蓝牙体脂秤：浏览器（尤其 iOS Safari，无 Web Bluetooth）必然不可用，隐藏全部入口
    const menuScale = document.getElementById('menuScale');
    const quickScaleBar = document.getElementById('chatQuickBar');
    if (menuScale) menuScale.style.display = 'none';
    if (quickScaleBar) quickScaleBar.style.display = 'none';

    // 申请持久化存储：iOS「添加到主屏幕」的 Web App 本就豁免 7 天清除，此处再防系统存储压力逐出
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { /* 静默：不影响启动 */ }

    // Service Worker（网络优先/离线兜底，见 sw.js）：仅浏览器注册，APK 内资产随包更新不应被缓存
    try {
      const swAllowed = 'serviceWorker' in navigator
        && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
      if (swAllowed) navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch (e) { /* 静默 */ }

    this._maybeShowPwaInstallHint();
  }

  // iOS Safari / 微信首次访问引导：教用户「添加到主屏幕」/「在 Safari 打开」。
  // 仅浏览器非 standalone 环境显示，关闭后 localStorage 记忆不再打扰。
  _maybeShowPwaInstallHint() {
    try {
      if (localStorage.getItem('qbPwaHintClosed') === '1') return;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
      if (isStandalone) return;
      const ua = navigator.userAgent;
      let text;
      if (/MicroMessenger/i.test(ua)) {
        text = '微信内无法安装「轻伴」：点右上角「···」→ 找到「在 Safari 中打开」并用 Safari 打开本页，再按提示添加到主屏幕。';
      } else if (/iP(hone|ad|od)/i.test(ua)) {
        text = '把轻伴装到桌面：点 Safari 底部中间的「分享」按钮 ⬆️ →「添加到主屏幕」，即可像 App 一样全屏使用。';
      } else {
        return; // 桌面浏览器 / Android Chrome 有各自的安装提示机制，不打扰
      }
      const el = document.createElement('div');
      el.className = 'pwa-hint';
      const span = document.createElement('span');
      span.textContent = text;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.type = 'button';
      btn.textContent = '知道了';
      btn.addEventListener('click', () => {
        localStorage.setItem('qbPwaHintClosed', '1');
        el.remove();
      });
      el.appendChild(span);
      el.appendChild(btn);
      document.body.appendChild(el);
    } catch (e) { /* 静默：引导条失败不影响功能 */ }
  }

  async init() {
    // 浏览器/PWA 环境适配（内部自判，原生 APK 无副作用）
    this._setupWebEnvironment();
    // ===== 启动阶段追踪：每步打标记，超时横幅可显示「卡在哪一步」 =====
    window.__qbStage = 'fm.init';
    // 初始化文件存储：加超时与容错。
    // IndexedDB 卡死会让整个启动永久挂起（表现为黑屏 + 一直「加载中」），
    // 因此超时后继续启动并标记存储不可用，让界面正常显示并给出明确提示。
    try {
      await this._withTimeout(this.fm.init(), 6000, 'fm.init（IndexedDB）');
    } catch (e) {
      console.error('[App] 存储初始化失败:', e);
      this._storageError = (e && e.message) ? e.message : String(e);
    }
    const realToday = this.chatManager._getToday();

    window.__qbStage = 'initTheme';
    this.initTheme();       // 初始化主题(从 localStorage 恢复)
    window.__qbStage = 'initFontScale';
    this.initFontScale();   // 初始化字体大小(从 localStorage 恢复)
    window.__qbStage = 'bindEvents';
    this.bindEvents();
    window.__qbStage = 'registerCallbacks';
    this._registerAskUserCallback(); // 注册 ask_user 工具回调
    this._registerNotificationCallback(); // 注册 send_notification 工具回调
    this._registerHabitCallbacks(); // 注册习惯打卡工具回调
    window.__qbStage = 'notificationManager.init';
    await this._withTimeout(this.notificationManager.init(), 4000, 'notificationManager.init');
    this._startHabitReminderCheck(); // 启动未完成习惯提醒检查（前台横幅路径）
    window.__qbStage = 'syncDailyReminders';
    // 注册系统级每日定点提醒（晨间问候/打卡提醒/晚间复盘 — 权限未授予时静默跳过原生注册）
    await this._withTimeout(this._syncDailyReminders(), 8000, 'syncDailyReminders');
    window.__qbStage = 'renderFileTree';
    await this._withTimeout(this.renderFileTree(), 4000, 'renderFileTree');
    this.updateContextInfo();

    // 加载持久化的 token 用量
    window.__qbStage = 'loadTokenUsage';
    await this._withTimeout(this.chatManager.loadTokenUsage(), 4000, 'loadTokenUsage');
    this.updateTokenBar();

    // 尝试恢复上次的对话历史
    window.__qbStage = 'loadHistory';
    const saved = await this._withTimeout(this.chatManager.loadHistory(), 4000, 'loadHistory');
    window.__qbStage = 'dayRollover';
    const savedDate = saved?.date;

    // 凌晨 0-4 点不跨天：用户可能熬夜，仍然算前一天（熬夜时段 effectiveToday 为昨天）
    const effectiveToday = this.chatManager.getEffectiveToday();

    // 检测是否跨天：保存的日期早于有效今天
    // v3.10.0 起跨天结算改为后台执行：前台只做日期切换（毫秒级），用户立即可聊天；
    // 结算步骤在后台顺序执行并更新顶栏状态条（点击可查看步骤明细）
    const pendingRollover = await this._loadRolloverPending();
    if (savedDate && savedDate < effectiveToday) {
      window.__qbStage = 'handleDayRollover';
      // 跨天了 — 用保存的历史启动后台结算
      this.chatManager.currentDate = savedDate;
      this.chatManager.history = (saved.history && saved.history.length > 0) ? saved.history : [];
      // 界面已可用（结算在后台）— 先标记就绪，避免 20s 启动看门狗误报"启动超时"
      this._markAppReady();
      await this._startDayRollover(effectiveToday);
      window.__qbStage = 'renderFileTree(rollover)';
      await this._withTimeout(this.renderFileTree(), 5000, 'renderFileTree(rollover)');
    } else if (pendingRollover && pendingRollover.date < effectiveToday) {
      // 上次结算被中断（后台被杀）— live 状态已是今天，断点续跑后台队列
      console.log('[DayRollover] 检测到未完成的结算，断点续跑:', pendingRollover.date);
      this._markAppReady();
      // 恢复今天已聊的内容（中断期间用户可能已聊天）
      if (saved && saved.history && saved.history.length > 0) {
        this.chatManager.currentDate = saved.date || effectiveToday;
        this.chatManager.history = saved.history;
        this._cleanupPhotoMessages();
        this.renderChatHistory(saved.history);
      }
      this.updateDateBadge();
      this._resumeRolloverPending(pendingRollover);
      window.__qbStage = 'renderFileTree(rollover)';
      await this._withTimeout(this.renderFileTree(), 5000, 'renderFileTree(rollover)');
    } else if (saved && saved.history && saved.history.length > 0) {
      // 同一天 — 恢复历史
      this.chatManager.currentDate = saved.date || realToday;
      this.chatManager.history = saved.history;
      // 清理历史中残留的图片消息（升级前遗留的），替换为文本
      this._cleanupPhotoMessages();
      this.updateDateBadge();
      this.renderChatHistory(saved.history);
      this.updateContextInfo();
    } else {
      // 没有历史
      this.chatManager.currentDate = realToday;
      this.updateDateBadge();
    }

    // 首次使用 → 弹出引导收集基本信息
    window.__qbStage = 'fm.isFirstTime';
    const firstTime = await this._withTimeout(this.fm.isFirstTime(), 5000, 'fm.isFirstTime');
    if (firstTime) {
      this.showOnboarding();
    } else if (!saved || !saved.history || saved.history.length === 0) {
      // 非首次但没有历史 → 显示欢迎语（后台结算进行中时跳过 — 结算完成会发完整问候）
      if (!this._dayRolloverDone && !this._rolloverBgActive) this.showWelcome();
    }

    // 启动后台日期检测（每分钟检查一次，支持运行中跨天自动总结）
    this._startDayCheckTimer();
  }

  // 后台定时检测日期变化（凌晨也会触发）
  _startDayCheckTimer() {
    // 每 60 秒检查一次（APP 在前台时）——顺带做晚间草稿预生成判断
    this._dayCheckInterval = setInterval(() => {
      this._checkDayRollover();
      this._maybePregenerateDraft();
    }, 60000);

    // 方式1：浏览器 visibilitychange 事件
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._backgroundedAt = Date.now();
        this._armNightlySettlementTimer(); // 退后台时对齐凌晨 04:05 的后台结算触发
      } else {
        this._checkDayRollover();
        this._checkBackgroundInterruption();
      }
    });

    // 方式2：window focus 事件（切回 APP 时触发）
    window.addEventListener('focus', () => {
      this._checkDayRollover();
    });

    // 方式3：Capacitor App 生命周期事件（Android 原生层回调）
    if (typeof window.Capacitor !== 'undefined') {
      try {
        // 监听 resume 事件（APP 从后台恢复）
        window.Capacitor.Plugins.App?.addListener?.('appStateChange', (state) => {
          if (state.isActive) {
            this._checkDayRollover();
            this._checkBackgroundInterruption();
          } else {
            this._backgroundedAt = Date.now();
          }
        });
        window.Capacitor.Plugins.App?.addListener?.('resume', () => {
          this._checkDayRollover();
          this._checkBackgroundInterruption();
        });
      } catch (e) {
        console.log('[DayCheck] Capacitor App plugin not available');
      }
    }

    // 方式4：每 5 分钟做一次兜底检查（即使在前台也保证不漏）
    this._dayCheckFallback = setInterval(() => {
      this._checkDayRollover();
    }, 300000);

    this._markAppReady();
  }

  // 标记应用已就绪：置 __qbAppReady、隐藏启动超时横幅、提示存储错误
  // 跨天流程开始前即可调用 — 跨天总结是增值任务，不应阻塞"启动就绪"判定
  _markAppReady() {
    if (window.__qbAppReady) return; // 幂等
    window.__qbStage = 'done';
    window.__qbAppReady = true;
    if (window.__qbHideFatal) window.__qbHideFatal();
    if (this._storageError) {
      this.showToast('存储不可用', `数据可能无法读取/保存：${this._storageError}`, 'error');
    }
  }

  // 后台恢复后检查请求是否中断
  _checkBackgroundInterruption() {
    if (!this.isProcessing || !this._backgroundedAt) return;
    const bgDuration = Date.now() - this._backgroundedAt;
    this._backgroundedAt = null;

    // 后台超过 5 秒，请求可能已中断
    if (bgDuration > 5000) {
      console.log(`[BG Recovery] 后台 ${bgDuration}ms，检查请求中断`);
      // 等待 3 秒看请求是否自行恢复
      setTimeout(() => {
        if (this.isProcessing) {
          // 请求仍在进行 — 可能连接还活着，让它继续
          // _readWithTimeout 会在 90 秒后超时
          console.log('[BG Recovery] 请求仍在进行，等待超时或完成');
        }
      }, 3000);
    }
  }

  async _checkDayRollover() {
    // 只在 APP 运行中、有对话历史时才检测
    if (this._isRolloverProcessing) return;

    const realToday = this.chatManager._getToday();
    
    // 凌晨 0-4 点不跨天：用户可能熬夜，仍然算前一天
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 4) {
      // 熬夜时段：把 currentDate 强制保持为昨天，这样对话仍然算昨天的
      if (this.chatManager.currentDate < realToday) {
        // 记录一条系统提示（只提示一次）
        if (!this._lateNightNotified) {
          this._lateNightNotified = true;
          this.addMessage('system', `🌙 还在熬夜呀？凌晨 4 点前仍然算前一天（${this.chatManager.currentDate}），好好聊。4 点后会自动跨天总结。`);
        }
      }
      return;
    }

    // 过了凌晨 4 点，重置熬夜提示标记
    this._lateNightNotified = false;

    if (this.chatManager.currentDate < realToday) {
      // 日期变了 — 前台立即切到今天（清空聊天区，昨日对话已持久化），结算放后台执行
      // 进度显示在顶栏状态条，用户可继续聊天
      this._isRolloverProcessing = true;
      try {
        console.log(`[跨天检测] ${this.chatManager.currentDate} → ${realToday}`);
        document.getElementById('chatMessages').innerHTML = '';
        await this._startDayRollover(realToday);
        await this.renderFileTree();
      } catch (e) {
        console.error('[跨天检测] 失败:', e.message);
        this.addMessage('system', `⚠️ 跨天切换出错: ${e.message}。你可以继续使用，稍后重试。`);
      } finally {
        this._isRolloverProcessing = false;
      }
    }
  }

  // 清理历史中所有残留的旧格式图片消息，转换为新格式
  // 新格式: content 为纯文本(给LLM), _displayPhotos 存图片(给UI)
  _cleanupPhotoMessages() {
    let cleaned = 0;
    for (let i = 0; i < this.chatManager.history.length; i++) {
      const msg = this.chatManager.history[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const hasImage = msg.content.some(c => c.type === 'image_url');
        if (hasImage) {
          const textPart = msg.content.find(c => c.type === 'text');
          const originalText = textPart ? textPart.text : '图片消息';
          const imgs = msg.content.filter(c => c.type === 'image_url').map(c => c.image_url.url);
          // 查找下一条 AI 回复作为图片识别摘要
          let aiSummary = '';
          if (i + 1 < this.chatManager.history.length && this.chatManager.history[i + 1].role === 'assistant') {
            aiSummary = (this.chatManager.history[i + 1].content || '').slice(0, 300);
          }
          // 转为新格式：纯文本 content + _displayPhotos 保留图片给 UI
          this.chatManager.history[i] = {
            role: 'user',
            content: aiSummary
              ? `${originalText}\n[图片已识别，AI分析: ${aiSummary}]`
              : `${originalText}\n[图片消息]`,
            _displayPhotos: imgs
          };
          cleaned++;
        }
      }
    }
    if (cleaned > 0) {
      this.chatManager.saveHistory();
      console.log(`[Cleanup] 清理了 ${cleaned} 条旧图片消息，已转换为新格式（图片保留给UI显示）`);
    }
  }

  // ===== 跨天后台结算（v3.10.0，v3.12.0 三层提前结算 + 单一入口闸门）=====
  // 前台（毫秒级，正确性必须）：快照昨日状态落盘 → 日期切今天 → 清空历史 → UI 就绪 + 状态条 + 简短问候
  // 后台（顺序队列，不阻塞聊天）：昨日摘要(LLM) → 完整性检查 → 21天习惯(LLM，隔天降频) → 打卡报告
  //   → 周度总结(条件) → 记忆快照 → AI周报(周日) → 重建索引 → 提醒刷新 → Auto Dream
  // 三层提前结算：层1 晚间草稿（22:00+ 静默预生成）→ 层2 凌晨后台结算（04:05 对齐触发 + 失败 15 分钟
  //   重试至 9:00，闸门防与用户打开冲突）→ 层3 早打开兜底（断点续跑，现有）。
  // 断点续跑：前台切换前把昨日快照写入 .meta/rollover-pending.json，后台被杀时下次启动恢复结算。
  async _startDayRollover(todayStr) {
    if (!this._settlementGate.claim()) return;
    this._settlementGate.resetRounds();
    this._rolloverBgActive = true;

    const yesterdayDate = this.chatManager.currentDate;
    // 快照昨日历史（剥离 _displayPhotos 的 base64 大图防止快照膨胀；识别文字 _recognition 保留）
    const snapshotHistory = this.chatManager.history.map(({ _displayPhotos, ...rest }) => rest);

    // 前台：立即切到今天，用户可直接聊天
    this.chatManager.currentDate = todayStr;
    this.chatManager.history = [];
    this._rolloverPending = {
      date: yesterdayDate,
      history: snapshotHistory,
      startedAt: new Date().toISOString(),
      queue: { steps: [] },
    };
    try {
      await this.fm.writeFile(ROLLOVER_PENDING_KEY, JSON.stringify(this._rolloverPending));
    } catch (e) {
      console.warn('[DayRollover] 结算快照落盘失败（后台被杀时该次结算不可续跑）:', e.message);
    }
    try { await this.chatManager.clearSavedHistory(); } catch (_) {}
    this.updateDateBadge();
    this.updateContextInfo();

    // 顶栏状态条 + 简短问候（完整问候等后台摘要完成后再发）
    this._showRolloverStrip();
    this.showNewDayWelcomeQuick();
    this._runRolloverQueueInBackground({ skipDone: false });
  }

  // 断点续跑（层3）：上次结算被中断（live 状态已是今天），恢复后台队列并跳过已完成步骤
  _resumeRolloverPending(pending) {
    if (!this._settlementGate.claim()) return;
    this._rolloverBgActive = true;
    this._rolloverPending = pending;
    this._showRolloverStrip();
    this.showNewDayWelcomeQuick();
    this._runRolloverQueueInBackground({ skipDone: true });
  }

  _runRolloverQueueInBackground({ skipDone = false } = {}) {
    const pending = this._rolloverPending;
    this._rolloverSkipDone = skipDone;
    // 不阻塞调用方：后台顺序执行，逐步更新状态条
    (async () => {
      let failed = false;
      try {
        await this.handleDayRollover(pending.date, pending.history || []);
        // 收尾：固定记忆文件可能已被后台步骤更新（learned-habits 等），失效 KV 前缀缓存
        this.llmService._fixedFiles.forEach((p) => this.llmService._invalidatePrefixCache(p));
        failed = (pending.queue.steps || []).some((s) => s.status === 'error');
        // 全部成功才清除断点文件；有失败时保留供自动重试 / 下次打开续跑
        if (!failed) {
          try { await this.fm.deleteFile(ROLLOVER_PENDING_KEY); } catch (_) {}
        }
        this._finishRolloverStrip();
        // 用户还没开始聊 → 发完整新一天问候（含昨日总结）；已聊过且全部成功 → 轻提示
        if (this.chatManager.history.length === 0) {
          await this._withTimeout(this.showNewDayWelcomeFull(), 15000, 'showNewDayWelcomeFull');
        } else if (!failed) {
          this.addMessage('system', `🌅 昨日结算完成：摘要已存入 chat/${pending.date}.md，习惯档案已更新。`);
        }
      } catch (e) {
        console.error('[DayRollover] 后台结算失败:', e.message);
        failed = true;
        this._finishRolloverStrip(e.message);
      } finally {
        this._settlementGate.release();
        this._rolloverBgActive = false;
        this._dayRolloverDone = true;
        // 夜间失败自愈：4:00-9:00 窗口内 15 分钟后自动重跑失败步骤（整夜至多 2 轮）
        if (failed) {
          const scheduled = this._settlementGate.scheduleRetry(() => {
            if (this._settlementGate.claim()) {
              this._rolloverBgActive = true;
              this._showRolloverStrip();
              this._runRolloverQueueInBackground({ skipDone: true });
            }
          });
          if (scheduled) console.log('[DayRollover] 存在失败步骤，15 分钟后自动重试（窗口至 9:00）');
        }
      }
    })();
  }

  async _loadRolloverPending() {
    try {
      const raw = await this.fm.readFile(ROLLOVER_PENDING_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      return (data && data.date && data.queue) ? data : null;
    } catch (_) {
      return null;
    }
  }

  async _persistRolloverQueue() {
    if (!this._rolloverPending) return;
    try {
      await this.fm.writeFile(ROLLOVER_PENDING_KEY, JSON.stringify(this._rolloverPending));
    } catch (_) { /* 状态持久化失败不影响结算本身 */ }
  }

  // 顶栏状态条 + 步骤回调（_dtAddStep/_dtUpdateStep 供 handleDayRollover 复用，契约与原遮罩版一致）
  _showRolloverStrip() {
    const strip = document.getElementById('rolloverStrip');
    if (strip) {
      strip.style.display = 'flex';
      strip.classList.remove('done', 'error');
    }
    this._dtStepIndex = 0;
    this._dtAddStep = (text) => {
      const q = this._rolloverPending && this._rolloverPending.queue;
      if (q) {
        // 重试/续跑时复用既有步骤条目（保留 done 状态供 handleDayRollover 跳过）；全新运行则新增
        if (this._rolloverSkipDone && q.steps[this._dtStepIndex]) {
          q.steps[this._dtStepIndex].label = text;
        } else {
          q.steps.push({ label: text, status: 'running' });
          this._persistRolloverQueue();
        }
      }
      this._dtStepIndex++;
      this._updateRolloverStripText(text);
    };
    this._dtUpdateStep = (index, status, errMsg = null, note = null) => {
      const q = this._rolloverPending && this._rolloverPending.queue;
      if (q && q.steps[index]) {
        q.steps[index].status = status;
        if (errMsg !== null) q.steps[index].error = errMsg;
        if (note !== null) q.steps[index].note = note;
        this._persistRolloverQueue();
      }
      if (this._rolloverDetailOpen) this._renderRolloverDetail();
    };
    this._updateRolloverStripText('正在整理昨日数据…');
  }

  _updateRolloverStripText(text) {
    const el = document.getElementById('rolloverStripText');
    if (!el) return;
    const q = this._rolloverPending && this._rolloverPending.queue;
    const done = q ? q.steps.filter((s) => s.status === 'done').length : 0;
    el.textContent = `🌙 昨日结算中 · ${text.replace(/^正在/, '').replace(/\.\.\.$/, '')}（${done} 步完成）`;
  }

  // 结算结束：全部成功 → 淡出；有失败 → 保留状态条供点击查看明细
  _finishRolloverStrip(explicitError) {
    const strip = document.getElementById('rolloverStrip');
    if (!strip) return;
    const steps = (this._rolloverPending && this._rolloverPending.queue.steps) || [];
    const errorDetail = explicitError || steps.filter((s) => s.status === 'error').map((s) => s.label).join('、');
    const el = document.getElementById('rolloverStripText');
    if (errorDetail) {
      strip.classList.add('error');
      if (el) el.textContent = '⚠️ 昨日结算部分失败，点击查看';
      return;
    }
    strip.classList.add('done');
    if (el) el.textContent = '✓ 昨日结算完成';
    setTimeout(() => { strip.style.display = 'none'; }, 2500);
  }

  _openRolloverDetail() {
    this._rolloverDetailOpen = true;
    document.getElementById('rolloverOverlay').style.display = 'flex';
    this._renderRolloverDetail();
  }

  _renderRolloverDetail() {
    const box = document.getElementById('rolloverDetailList');
    if (!box) return;
    const steps = (this._rolloverPending && this._rolloverPending.queue.steps) || [];
    if (steps.length === 0) {
      box.innerHTML = '<div class="rollover-detail-empty">正在准备结算步骤…</div>';
      return;
    }
    const icon = (s) => (s.status === 'done' ? '✅' : s.status === 'error' ? '⚠️' : '⏳');
    box.innerHTML = steps
      .map((s) => {
        const sub = s.error
          ? `<div class="rollover-detail-sub rollover-detail-error">${s.error}</div>`
          : s.note
            ? `<div class="rollover-detail-sub">${s.note}</div>`
            : '';
        return `<div class="rollover-detail-row"><span class="rollover-detail-icon">${icon(s.status)}</span><div class="rollover-detail-body"><div>${s.label}</div>${sub}</div></div>`;
      })
      .join('');
  }

  // ===== 层1 · 晚间草稿预生成（22:00+ 静默生成当日摘要，跨天时秒过摘要步骤）=====
  async _maybePregenerateDraft() {
    try {
      if (this._rolloverBgActive || this.isProcessing) return;
      const now = new Date();
      const today = this.chatManager.currentDate;
      if (today !== this.chatManager._getToday()) return; // 熬夜时段不预生成
      let marker = null;
      try {
        marker = JSON.parse((await this.fm.readFile(DRAFT_KEY)) || 'null');
      } catch (_) {}
      if (marker && marker.date !== today) marker = null; // 旧日期的草稿标记视为无
      const decision = ChatManager.pregenerateDraftDecision({
        marker,
        historyLen: this.chatManager.history.length,
        now,
      });
      if (!decision.run) return;
      // 先写标记再生成：失败不会每分钟空转；用户继续聊（historyLen 增长）会自然触发重试
      await this.fm.writeFile(DRAFT_KEY, JSON.stringify({
        date: today,
        historyLen: this.chatManager.history.length,
        lastAttempt: now.toISOString(),
      }));
      await this._stepTimeout(
        this.chatManager.saveDailySummary(this.llm, this.chatManager.history, today, { skipIndex: true }),
        150000,
        '晚间草稿'
      );
      console.log('[晚间草稿] 今日摘要已预生成:', today);
    } catch (e) {
      console.warn('[晚间草稿] 预生成失败（不影响跨天流程）:', e.message);
    }
  }

  // ===== 层2 · 凌晨后台结算对齐触发（04:05，进程活着时最优；60s 检测兜底）=====
  _armNightlySettlementTimer() {
    if (this._nightlyTimer) clearTimeout(this._nightlyTimer);
    const now = new Date();
    const target = new Date(now);
    target.setHours(4, 5, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    this._nightlyTimer = setTimeout(() => {
      this._nightlyTimer = null;
      // 幂等：当日已结算则 _checkDayRollover 直接跳过
      this._checkDayRollover();
      this._armNightlySettlementTimer();
    }, target - now);
  }

  // 跨天处理（后台结算队列，由 _startDayRollover 驱动）：
  // 昨日摘要（从快照生成） → 数据完整性检查 → 学习习惯 → 打卡报告 → 周度总结/AI周报(条件)
  // → 记忆快照 → 重建索引 → 提醒刷新 → Auto Dream
  // v3.10.0 起：日期切换与清空历史已移到前台（_startDayRollover），此处不再操作 live 状态
  async handleDayRollover(yesterdayDate, yesterdayHistory = []) {
    // 重试/恢复时跳过已完成步骤：按队列条目索引对齐（同一夜内步骤序列确定性一致）
    const stepDone = (i) => !!(this._rolloverSkipDone && this._rolloverPending?.queue?.steps?.[i]?.status === 'done');

    // 结算步骤开关（结算开始时快照，避免中途配置变化导致步骤序列错位）
    const cfg = (window.QINGBAN_SETTINGS && window.QINGBAN_SETTINGS.settlement) || {};
    const setlOn = (key) => cfg[key] !== false;

    // 步骤 1: 保存昨日对话摘要（从快照生成 — live 历史已切今天，不能读；晚间草稿已覆盖时秒过）
    if (setlOn('dailySummary')) {
      if (this._dtAddStep) this._dtAddStep('保存昨日对话摘要');
      if (stepDone(0)) {
        if (this._dtUpdateStep) this._dtUpdateStep(0, 'done');
      } else {
        try {
          let draftHit = false;
          try {
            const marker = JSON.parse((await this.fm.readFile(DRAFT_KEY)) || 'null');
            const draftFile = marker && marker.date === yesterdayDate
              ? await this.fm.readFile(`chat/${yesterdayDate}.md`) : null;
            draftHit = !!(draftFile && marker.historyLen >= yesterdayHistory.length);
          } catch (_) {}
          if (draftHit) {
            console.log('[DayRollover] 晚间草稿已覆盖昨日全部消息，摘要步骤秒过');
          } else {
            await this._stepTimeout(this.chatManager.saveDailySummary(this.llm, yesterdayHistory, yesterdayDate), 150000, '昨日摘要');
          }
          if (this._dtUpdateStep) this._dtUpdateStep(0, 'done');
        } catch (e) {
          console.error('[DayRollover] 摘要失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(0, 'error', e.message);
        }
      }
    }

    // 步骤 2: 数据完整性检查
    if (setlOn('integrityCheck')) {
      if (this._dtAddStep) this._dtAddStep('检查数据完整性');
      if (stepDone(1)) {
        if (this._dtUpdateStep) this._dtUpdateStep(1, 'done');
      } else if (yesterdayHistory.length > 0) {
        try {
          await this._dataIntegrityCheck(yesterdayDate, yesterdayHistory);
          if (this._dtUpdateStep) this._dtUpdateStep(1, 'done');
        } catch (e) {
          console.error('[DayRollover] 数据检查失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(1, 'error', e.message);
        }
      } else {
        if (this._dtUpdateStep) this._dtUpdateStep(1, 'done');
      }
    }

    // 步骤 3: 刷新习惯总结（基于近 21 天对话摘要全量分析）
    // v3.12.0 降频：距上次成功刷新 ≥ 2 天且期间有新对话摘要才跑；失败自动重试 1 次；超时 150s
    if (setlOn('habitRefresh')) {
      if (this._dtAddStep) this._dtAddStep('刷新习惯总结（近 21 天）');
      const stepHabit = this._dtStepIndex - 1;
      if (stepDone(stepHabit)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done');
      } else if (this.profileLearner) {
        try {
          const skipInfo = await this.profileLearner.shouldSkipRefresh(yesterdayDate);
          if (skipInfo.skip) {
            console.log('[DayRollover] 习惯刷新跳过:', skipInfo.reason);
            if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done', null, '无新数据，已跳过');
          } else {
            let refreshResult;
            try {
              refreshResult = await this._stepTimeout(this.profileLearner.refreshHabits(21), 150000, '习惯刷新');
            } catch (e1) {
              console.warn('[DayRollover] 习惯刷新首次失败，10s 后重试:', e1.message);
              await new Promise((r) => setTimeout(r, 10000));
              refreshResult = await this._stepTimeout(this.profileLearner.refreshHabits(21), 150000, '习惯刷新');
            }
            console.log('[DayRollover] 习惯刷新:', refreshResult.summary);
            await this.profileLearner.markRefreshed(yesterdayDate);
            if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done');
          }
        } catch (e) {
          console.error('[DayRollover] 习惯刷新失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'error', e.message);
        }
      } else {
        if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done');
      }
    }

    // 步骤 3.5: 保存昨日打卡报告
    if (setlOn('habitReport')) {
      if (this._dtAddStep) this._dtAddStep('保存昨日打卡记录');
      const stepHabitReport = this._dtStepIndex - 1;
      if (stepDone(stepHabitReport)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepHabitReport, 'done');
      } else {
        try {
          const habitReport = await this.habitManager.generateDailyReport(yesterdayDate);
          await this.fm.writeFile(`habits/${yesterdayDate}.md`, habitReport);
          if (this._dtUpdateStep) this._dtUpdateStep(stepHabitReport, 'done');
        } catch (e) {
          console.error('[DayRollover] 打卡报告失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepHabitReport, 'error', e.message);
        }
      }
    }

    // 步骤 4 (条件): 周度习惯总结 — 每 7 天触发一次
    const needWeekly = await this._shouldRunWeeklySummary();
    if (needWeekly && setlOn('weeklyHabitSummary')) {
      if (this._dtAddStep) this._dtAddStep('总结近一个月的习惯变化');
      const stepWeekly = this._dtStepIndex - 1;
      if (stepDone(stepWeekly)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeekly, 'done');
      } else {
        try {
          await this._stepTimeout(this._weeklyHabitSummary(), 150000, '周度习惯总结');
          if (this._dtUpdateStep) this._dtUpdateStep(stepWeekly, 'done');
        } catch (e) {
          console.error('[DayRollover] 周度总结失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepWeekly, 'error', e.message);
        }
      }
    }

    // 步骤 4.5: 记忆文件自动快照（滚动保留最近 7 份，防 AI 误写丢数据）
    if (setlOn('memorySnapshot')) {
      if (this._dtAddStep) this._dtAddStep('快照记忆文件');
      const stepSnap = this._dtStepIndex - 1;
      if (stepDone(stepSnap)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepSnap, 'done');
      } else {
        try {
          await this.backupManager.snapshotMemory();
          if (this._dtUpdateStep) this._dtUpdateStep(stepSnap, 'done');
        } catch (e) {
          console.error('[DayRollover] 记忆快照失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepSnap, 'error', e.message);
        }
      }
    }

    // 步骤 4.6 (条件): AI 周报 — 昨日为周日时生成上周周报（失败自动重试 1 次）
    let yesterdayDow = -1;
    try { yesterdayDow = new Date(`${yesterdayDate}T00:00:00`).getDay(); } catch (_) {}
    if (yesterdayDow === 0 && setlOn('weeklyReport')) {
      if (this._dtAddStep) this._dtAddStep('生成 AI 周报');
      const stepWeeklyReport = this._dtStepIndex - 1;
      if (stepDone(stepWeeklyReport)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeeklyReport, 'done');
      } else {
        try {
          let report;
          try {
            report = await this._stepTimeout(this._generateWeeklyReport(yesterdayDate), 150000, 'AI 周报');
          } catch (e1) {
            console.warn('[DayRollover] AI 周报首次失败，10s 后重试:', e1.message);
            await new Promise((r) => setTimeout(r, 10000));
            report = await this._stepTimeout(this._generateWeeklyReport(yesterdayDate), 150000, 'AI 周报');
          }
          console.log('[DayRollover] AI 周报已生成:', report.path);
          if (this._dtUpdateStep) this._dtUpdateStep(stepWeeklyReport, 'done');
        } catch (e) {
          console.error('[DayRollover] AI 周报失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepWeeklyReport, 'error', e.message);
        }
      }
    }

    // 步骤 5: 重建索引
    if (setlOn('rebuildIndex')) {
      if (this._dtAddStep) this._dtAddStep('重建记忆索引');
      const stepIndex = this._dtStepIndex - 1;
      if (stepDone(stepIndex)) {
        if (this._dtUpdateStep) this._dtUpdateStep(stepIndex, 'done');
      } else {
        try {
          await this.indexManager.rebuildIndex();
          this.onDemandLoader?.invalidateIndexCache();
          if (this._dtUpdateStep) this._dtUpdateStep(stepIndex, 'done');
        } catch (e) {
          console.error('[DayRollover] 重建索引失败:', e.message);
          if (this._dtUpdateStep) this._dtUpdateStep(stepIndex, 'error', e.message);
        }
      }
    }

    // 步骤 6（已移除）: 清空历史 — v3.10.0 起移到前台（_startDayRollover 切日期时立即完成），
    // 保证用户开始聊天前 live 状态就是今天，结算与日常聊天互不干扰

    // 步骤 7 (静默): 刷新每日定点提醒 — 晨间问候文案用昨日最新数据重建
    if (setlOn('refreshReminders')) {
      try {
        await this._syncDailyReminders();
      } catch (e) {
        console.warn('[DayRollover] 每日提醒刷新失败:', e.message);
      }
    }

    // 步骤 8 (静默): Auto Dream 自动触发 — 本周无周报且数据足够时后台生成（不阻塞跨天主流程）
    if (setlOn('autoDream')) {
      this._runAutoDreamSilent(this.chatManager.getEffectiveToday());
    }

    this._dayRolloverDone = true;
  }

  // ===== 每日定点提醒（阶段四 · 主动陪伴）=====

  // 注册/刷新系统级每日定点提醒：晨间问候、打卡提醒两次、晚间复盘
  // 调用时机：App 启动、跨天流程末尾、提醒设置保存。文案为模板生成（零 LLM 调用，离线可用）
  async _syncDailyReminders() {
    const s = (window.QINGBAN_SETTINGS && window.QINGBAN_SETTINGS.reminders) || {};
    const t = NotificationManager.parseTime;
    const morning = t(s.morningTime) || { hour: 8, minute: 0 };
    const noon = t(s.habitNoonTime) || { hour: 12, minute: 30 };
    const habitEvening = t(s.habitEveningTime) || { hour: 20, minute: 0 };
    const evening = t(s.eveningTime) || { hour: 21, minute: 30 };

    const items = [];
    if (s.morningEnabled !== false) {
      const data = await this._collectMorningData();
      items.push({ key: 'morning', enabled: true, hour: morning.hour, minute: morning.minute, type: 'custom', title: '早安 ☀️', body: NotificationManager.buildMorningBrief(data) });
    }
    if (s.habitEnabled !== false) {
      items.push({ key: 'habitNoon', enabled: true, hour: noon.hour, minute: noon.minute, type: 'custom', title: '打卡提醒', body: NotificationManager.buildHabitReminderText() });
      items.push({ key: 'habitEvening', enabled: true, hour: habitEvening.hour, minute: habitEvening.minute, type: 'custom', title: '打卡提醒', body: NotificationManager.buildHabitReminderText() });
    }
    if (s.eveningEnabled !== false) {
      items.push({ key: 'evening', enabled: true, hour: evening.hour, minute: evening.minute, type: 'custom', title: '晚间复盘', body: NotificationManager.buildEveningReviewText() });
    }
    return this.notificationManager.syncDailyReminders(items);
  }

  // 收集晨间问候文案数据：昨日体重（含较前值变化）+ 昨日打卡次数
  async _collectMorningData() {
    try {
      const today = this.chatManager.getEffectiveToday();
      const yesterday = StatsManager._shiftDate(today, -1);
      const { weights } = await this.statsManager.getDailyStats();
      const upTo = weights.filter((w) => w.date <= yesterday);
      const yw = upTo.length ? upTo[upTo.length - 1] : null;
      const pw = upTo.length > 1 ? upTo[upTo.length - 2] : null;
      let checkins = [];
      try {
        checkins = JSON.parse((await this.fm.readFile('.meta/habit-checkins.json')) || '[]');
      } catch (_) { /* 打卡数据损坏时按 0 次 */ }
      const yesterdayCheckins = checkins.filter((c) => c.date === yesterday).length;
      return {
        yesterdayWeight: yw ? yw.weight : null,
        prevWeight: pw ? pw.weight : null,
        yesterdayCheckins
      };
    } catch (e) {
      console.warn('[App] 晨间数据收集失败:', e.message);
      return {};
    }
  }

  // Auto Dream 静默自动触发（每天最多检查一次；本周已有周报则跳过）
  async _runAutoDreamSilent(todayStr) {
    try {
      const raw = await this.fm.readFile('.meta/autodream.json');
      const log = raw ? JSON.parse(raw) : {};
      if (log.lastRun === todayStr) return;

      const st = await this.autoDream.shouldTrigger();
      if (!st.shouldRun || st.hasWeekReport) return;

      await this._stepTimeout(this.autoDream.run(todayStr), 600000, 'Auto Dream');
      await this.fm.writeFile('.meta/autodream.json', JSON.stringify({ lastRun: todayStr, updatedAt: new Date().toISOString() }));
      this._showNotificationBanner({ type: 'custom', title: 'Auto Dream 完成', message: '周报/月报/模式洞察已更新，可在功能菜单查看' });
      await this.renderFileTree();
    } catch (e) {
      console.warn('[AutoDream] 自动触发失败:', e.message);
    }
  }

  // ===== 提醒设置面板 =====

  showReminders() {
    const s = (window.QINGBAN_SETTINGS && window.QINGBAN_SETTINGS.reminders) || {};
    document.getElementById('remMorningEnabled').checked = s.morningEnabled !== false;
    document.getElementById('remMorningTime').value = s.morningTime || '08:00';
    document.getElementById('remHabitEnabled').checked = s.habitEnabled !== false;
    document.getElementById('remHabitNoonTime').value = s.habitNoonTime || '12:30';
    document.getElementById('remHabitEveningTime').value = s.habitEveningTime || '20:00';
    document.getElementById('remEveningEnabled').checked = s.eveningEnabled !== false;
    document.getElementById('remEveningTime').value = s.eveningTime || '21:30';
    document.getElementById('remindersOverlay').style.display = 'flex';
  }

  async _saveReminders() {
    const reminders = {
      morningEnabled: document.getElementById('remMorningEnabled').checked,
      morningTime: document.getElementById('remMorningTime').value || '08:00',
      habitEnabled: document.getElementById('remHabitEnabled').checked,
      habitNoonTime: document.getElementById('remHabitNoonTime').value || '12:30',
      habitEveningTime: document.getElementById('remHabitEveningTime').value || '20:00',
      eveningEnabled: document.getElementById('remEveningEnabled').checked,
      eveningTime: document.getElementById('remEveningTime').value || '21:30'
    };
    const anyEnabled = reminders.morningEnabled || reminders.habitEnabled || reminders.eveningEnabled;

    window.QINGBAN_SETTINGS.reminders = reminders;
    saveSettings(window.QINGBAN_SETTINGS);

    if (anyEnabled) {
      // 首次开启提醒时请求系统通知权限（原生 LocalNotifications / Web Notification 双轨）
      const perm = await this.notificationManager.requestPermission();
      if (perm === 'denied') {
        this.showToast('通知权限被拒绝', '提醒可能无法弹出，请在系统设置中允许通知', 'error');
      }
    }

    await this._syncDailyReminders();
    document.getElementById('remindersOverlay').style.display = 'none';
    this.showToast('提醒设置已保存', anyEnabled ? '系统级每日提醒已更新' : '已关闭全部提醒', 'success');
  }

  // ===== 每日结算设置面板 =====
  // 配置项 key → checkbox id 映射（与 index.html settlementOverlay 一一对应）
  static get SETTLEMENT_KEYS() {
    return [
      ['dailySummary', 'setlDailySummary'],
      ['integrityCheck', 'setlIntegrityCheck'],
      ['habitRefresh', 'setlHabitRefresh'],
      ['habitReport', 'setlHabitReport'],
      ['weeklyHabitSummary', 'setlWeeklyHabitSummary'],
      ['memorySnapshot', 'setlMemorySnapshot'],
      ['weeklyReport', 'setlWeeklyReport'],
      ['rebuildIndex', 'setlRebuildIndex'],
      ['refreshReminders', 'setlRefreshReminders'],
      ['autoDream', 'setlAutoDream']
    ];
  }

  showSettlement() {
    const s = (window.QINGBAN_SETTINGS && window.QINGBAN_SETTINGS.settlement) || {};
    for (const [key, id] of App.SETTLEMENT_KEYS) {
      const el = document.getElementById(id);
      if (el) el.checked = s[key] !== false;
    }
    document.getElementById('settlementOverlay').style.display = 'flex';
  }

  _saveSettlement() {
    const settlement = {};
    for (const [key, id] of App.SETTLEMENT_KEYS) {
      const el = document.getElementById(id);
      settlement[key] = !!(el && el.checked);
    }
    const enabledCount = Object.values(settlement).filter(v => v).length;

    window.QINGBAN_SETTINGS.settlement = settlement;
    saveSettings(window.QINGBAN_SETTINGS);

    document.getElementById('settlementOverlay').style.display = 'none';
    this.showToast('结算设置已保存', `已启用 ${enabledCount}/10 个步骤，下次跨天结算生效`, 'success');
  }

  _resetSettlement() {
    if (!confirm('确定恢复结算设置到默认（全部启用）吗？')) return;
    if (window.QINGBAN_SETTINGS) {
      delete window.QINGBAN_SETTINGS.settlement;
      saveSettings(window.QINGBAN_SETTINGS);
    }
    this.showSettlement();
  }

  // 检查是否需要执行周度总结（每 7 天一次）
  async _shouldRunWeeklySummary() {
    const allFiles = await this.fm.listFiles();
    // 找已有的周度总结文件
    const weeklyFiles = allFiles
      .filter(f => f.path.startsWith('insights/weekly-habits-'))
      .map(f => f.path)
      .sort()
      .reverse();

    if (weeklyFiles.length === 0) {
      // 没有历史总结 → 检查是否有至少 7 天的对话摘要
      const chatFiles = allFiles.filter(f => f.path.startsWith('chat/') && f.path.endsWith('.md'));
      return chatFiles.length >= 7;
    }

    // 解析上次总结的日期
    const lastFile = weeklyFiles[0];
    const match = lastFile.match(/weekly-habits-(\d{4}-\d{2})/);
    if (!match) return false;

    // 计算距今天数
    const [year, week] = match[1].split('-');
    const lastDate = new Date(parseInt(year), 0, 1 + (parseInt(week) - 1) * 7);
    const today = new Date();
    const daysDiff = Math.floor((today - lastDate) / 86400000);

    return daysDiff >= 7;
  }

  // 周度习惯总结：读取近 30 天对话摘要，合并分析，去重精简
  async _weeklyHabitSummary() {
    const allFiles = await this.fm.listFiles();

    // 收集近 30 天的对话摘要
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

    const chatFiles = allFiles
      .filter(f => f.path.startsWith('chat/') && f.path.endsWith('.md'))
      .filter(f => {
        const dateMatch = f.path.match(/(\d{4}-\d{2}-\d{2})/);
        return dateMatch && dateMatch[1] >= cutoffStr;
      })
      .sort();

    if (chatFiles.length === 0) {
      console.log('[周度总结] 没有对话摘要可分析');
      return;
    }

    // 读取所有摘要内容
    const summaries = [];
    for (const f of chatFiles) {
      const content = await this.fm.readFile(f.path);
      if (content && content.trim()) {
        const dateMatch = f.path.match(/(\d{4}-\d{2}-\d{2})/);
        summaries.push(`### ${dateMatch ? dateMatch[1] : f.path}\n${content}`);
      }
    }

    if (summaries.length === 0) return;

    // 读取现有的 learned-habits.md
    const currentHabits = await this.fm.readFile('rules/learned-habits.md') || '';

    // 读取上次的周度总结（如果有）
    const prevWeeklyFiles = allFiles
      .filter(f => f.path.startsWith('insights/weekly-habits-'))
      .sort()
      .reverse();
    const prevWeekly = prevWeeklyFiles.length > 0
      ? await this.fm.readFile(prevWeeklyFiles[0].path)
      : '';

    // 计算当前周数
    const now = new Date();
    const yearStart = new Date(now.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((now - yearStart) / 86400000 + yearStart.getDay() + 1) / 7);
    const weekLabel = `${now.getFullYear()}-${String(weekNum).padStart(2, '0')}`;

    const prompt = `你是轻伴的习惯分析助手。请分析以下近 30 天的每日对话摘要，生成一份周度习惯总结。

## 当前已知的用户习惯
${currentHabits}

## 上次周度总结
${prevWeekly || '（首次总结）'}

## 近 30 天的每日对话摘要
${summaries.join('\n\n---\n\n')}

## 任务
1. 从这些摘要中提取用户的习惯模式（饮食、运动、作息、情绪等）
2. 与"上次周度总结"对比，标注新增/变化/消失的习惯
3. 去重：相同的习惯只保留一条，合并多次观察
4. 精简：删除一次性事件和不重要的细节，只保留稳定的习惯模式
5. 如果某些习惯已经消失（连续多天未出现），标注为"可能已改变"

## 输出格式
\`\`\`markdown
# 周度习惯总结（${weekLabel}）

> 分析周期：${chatFiles[0].path.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '?'} ~ ${chatFiles[chatFiles.length - 1].path.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '?'}
> 基于摘要数：${summaries.length} 篇

## 饮食习惯
- [稳定] xxx
- [新增] xxx
- [可能已改变] xxx

## 运动习惯
...

## 作息规律
...

## 情绪与压力
...

## 本周变化总结
- 与上周相比的主要变化...

## 建议
- 基于习惯分析给出的 2-3 条建议
\`\`\`

注意：只保留稳定的习惯模式（出现 2 次以上），一次性事件不要写入。`;

    try {
      const result = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        null,
        { currentDate: this.chatManager._getToday() }
      );

      const content = result.content || '【周度总结生成失败】';
      const outputPath = `insights/weekly-habits-${weekLabel}.md`;
      await this.fm.writeFile(outputPath, content);
      console.log(`[周度总结] 已生成 ${outputPath}`);

      // 同时更新 learned-habits.md — 把周度总结中的稳定习惯合并进去
      if (prevWeekly) {
        // 有上次的周度总结 → 用新的覆盖旧的 insights 文件即可
        // learned-habits.md 已经在步骤3被 refreshHabits 全量刷新过了，不需要重复
      }
    } catch (e) {
      console.error('[周度总结] LLM 调用失败:', e.message);
      throw e;
    }
  }

  // 判定是否为图片识别消息（满足任一条件即返回 true）
  _isPhotoMessage(msg) {
    if (msg.role !== 'user') return false;
    if (typeof msg.content === 'string' && msg.content.includes('[图片已识别]')) return true;
    if (Array.isArray(msg._displayPhotos) && msg._displayPhotos.length > 0) return true;
    return false;
  }

  // 智能过滤对话文本：保留所有 user 消息全文 + 图片识别消息对应的 AI 回复，跳过文字聊天的 AI 回复
  _buildFilteredConversationText(history) {
    let lastUserIsPhoto = false;
    const parts = [];
    let userMessageCount = 0;
    let keptAiReplyCount = 0;
    let skippedAiReplyCount = 0;

    for (const msg of history) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text')?.text || '[图片消息]' : '');
        parts.push(`用户: ${text}`);
        userMessageCount++;
        lastUserIsPhoto = this._isPhotoMessage(msg);
      } else if (msg.role === 'assistant') {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (lastUserIsPhoto && content) {
          parts.push(`轻伴: ${content}`);
          keptAiReplyCount++;
        } else {
          skippedAiReplyCount++;
        }
      }
    }

    return {
      text: parts.join('\n'),
      userMessageCount,
      keptAiReplyCount,
      skippedAiReplyCount
    };
  }

  // 数据完整性检查：审查昨天对话，补充遗漏的饮食记录/体重/过敏/偏好等
  async _dataIntegrityCheck(date, history) {
    // 先检查昨天的饮食记录文件是否存在 — 按需加载或直读
    const dietPath = `diet/${date}.md`;
    let existingDiet;
    if (window.QINGBAN_SETTINGS?.onDemandLoad !== false && this.onDemandLoader) {
      const result = await this.onDemandLoader.loadForSummary({
        taskType: 'integrity_check',
        currentDate: date,
        exactDate: date
      });
      const dietFile = result.files.find(f => f.path === dietPath);
      existingDiet = dietFile ? dietFile.content : null;
    } else {
      existingDiet = await this.fm.readFile(dietPath);
    }

    // 智能过滤对话文本：保留所有 user 消息 + 图片识别的 AI 回复，跳过文字聊天的 AI 回复
    const filterResult = this._buildFilteredConversationText(history);
    const conversationText = filterResult.text;

    console.log('[数据检查] 智能过滤:', {
      date,
      userMessageCount: filterResult.userMessageCount,
      keptAiReplyCount: filterResult.keptAiReplyCount,
      skippedAiReplyCount: filterResult.skippedAiReplyCount
    });

    if (!conversationText.trim()) return;

    // 构建审查 prompt
    const fileList = await this.fm.listFiles();
    const currentDiet = existingDiet || '(无)';
    const currentMetrics = await this.fm.readFile('BODY_METRICS.md') || '(无)';
    const currentAllergies = await this.fm.readFile('rules/allergies.md') || '(无)';
    const currentPreferences = await this.fm.readFile('rules/preferences.md') || '(无)';
    const currentFoodTypes = await this.fm.readFile('rules/food-types.md') || '(无)';
    const currentExercise = await this.fm.readFile('rules/exercise.md') || '(无)';

    const prompt = `请审查以下昨天的对话记录，检查是否有应该记录但遗漏的数据。

## 昨天日期
${date}

## 昨天对话
${conversationText}

## 当前已有的文件内容

### diet/${date}.md（饮食记录）
${currentDiet}

### BODY_METRICS.md（身体指标）
${currentMetrics}

### rules/allergies.md（过敏忌口）
${currentAllergies}

### rules/preferences.md（饮食偏好）
${currentPreferences}

### rules/food-types.md（食物种类）
${currentFoodTypes}

### rules/exercise.md（运动情况）
${currentExercise}

## 检查任务
请检查对话中是否提到了以下信息但尚未记录到对应文件中：
1. **饮食记录**：用户提到吃了什么/喝了什么，但 diet/${date}.md 里没有 → 需要补充
2. **体重数据**：用户提到体重数字，但 BODY_METRICS.md 里没有这一天记录 → 需要更新
3. **过敏/忌口**：用户提到新的过敏或忌口，但 allergies.md 里没有 → 需要更新
4. **饮食偏好**：用户提到口味/习惯，但 preferences.md 里没有 → 需要更新
5. **运动情况**：用户提到运动/能力/限制，但 exercise.md 里没有 → 需要更新
6. **食物种类**：对话中出现新食物（尤其图片识别结果），但 food-types.md 对应分类里没有 → 需要更新

## 输出格式
请用 JSON 格式输出检查结果，列出需要更新的文件和内容：
\`\`\`json
{
  "updates": [
    {
      "file": "diet/${date}.md",
      "action": "create 或 append",
      "content": "需要写入或追加的完整内容",
      "reason": "为什么需要更新"
    }
  ]
}
\`\`\`

如果没有需要更新的内容，返回 {"updates": []}。`;

    try {
      const result = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        null,
        { currentDate: date }
      );

      // 解析 JSON
      let updates = [];
      try {
        const jsonMatch = result.content.match(/```json\s*([\s\S]*?)```/) || result.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
          updates = parsed.updates || [];
        }
      } catch (e) {
        console.error('[数据检查] JSON 解析失败:', e.message);
      }

      // 执行更新
      for (const update of updates) {
        if (!update.file || !update.content) continue;
        try {
          if (update.action === 'create') {
            await this.fm.writeFile(update.file, update.content);
            console.log(`[数据检查] 创建 ${update.file}: ${update.reason}`);
          } else if (update.action === 'append') {
            await this.fm.appendFile(update.file, '\n\n' + update.content);
            console.log(`[数据检查] 追加 ${update.file}: ${update.reason}`);
          } else {
            // 默认覆盖写入
            await this.fm.writeFile(update.file, update.content);
            console.log(`[数据检查] 更新 ${update.file}: ${update.reason}`);
          }
        } catch (e) {
          console.error(`[数据检查] 写入 ${update.file} 失败:`, e.message);
        }
      }

      console.log(`[数据检查] 完成，更新了 ${updates.length} 个文件`);
    } catch (e) {
      console.error('[数据检查] LLM 调用失败:', e.message);
    }
  }

  // 新一天问候 — 包含昨日总结和今日建议
  // 简短问候 — 前台立发（不等后台结算），让用户知道 App 已就绪、结算进行中
  showNewDayWelcomeQuick() {
    const today = this.chatManager.currentDate;
    const hour = new Date().getHours();
    let greeting;
    if (hour < 9) greeting = '早上好';
    else if (hour < 12) greeting = '上午好';
    else if (hour < 14) greeting = '中午好';
    else if (hour < 18) greeting = '下午好';
    else greeting = '晚上好';
    this.addMessage('assistant', `${greeting}！今天是 **${today}**，新的一天开始了 🌿\n\n正在为你整理昨日总结和今日建议，请稍候...`);
  }

  // 组合版：简短问候 + 完整问候（保留原入口，供非后台结算场景使用）
  async showNewDayWelcome() {
    this.showNewDayWelcomeQuick();
    await this.showNewDayWelcomeFull();
  }

  // 完整问候（含昨日总结和今日建议）— 后台结算完成后调用（此时昨日摘要文件已生成）
  async showNewDayWelcomeFull() {
    const today = this.chatManager.currentDate;
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yp = (n) => String(n).padStart(2, '0');
    const yesterdayDate = `${yesterday.getFullYear()}-${yp(yesterday.getMonth() + 1)}-${yp(yesterday.getDate())}`;

    try {
      // 读取昨天的数据 — 按需加载或直读
      let yesterdayChat, yesterdayDiet;
      if (window.QINGBAN_SETTINGS?.onDemandLoad !== false && this.onDemandLoader) {
        const result = await this.onDemandLoader.loadForSummary({
          taskType: 'new_day_welcome',
          currentDate: today,
          exactDate: yesterdayDate
        });
        yesterdayChat = result.files.find(f => f.path === `chat/${yesterdayDate}.md`)?.content || '';
        yesterdayDiet = result.files.find(f => f.path === `diet/${yesterdayDate}.md`)?.content || '';
      } else {
        yesterdayChat = await this.fm.readFile(`chat/${yesterdayDate}.md`) || '';
        yesterdayDiet = await this.fm.readFile(`diet/${yesterdayDate}.md`) || '';
      }
      const bodyMetrics = await this.fm.readFile('BODY_METRICS.md') || '';
      const profile = await this.fm.readFile('PROFILE.md') || '';
      const habits = await this.fm.readFile('rules/learned-habits.md') || '';
      const exercise = await this.fm.readFile('rules/exercise.md') || '';

      // 构建 LLM prompt
      const prompt = `请根据以下数据，为用户生成一份简洁的「昨日总结」和「今日建议」。

## 用户档案
${profile}

## 昨天日期
${yesterdayDate}

## 昨天对话摘要
${yesterdayChat || '(昨天没有对话记录)'}

## 昨天饮食记录
${yesterdayDiet || '(昨天没有饮食记录)'}

## 身体指标
${bodyMetrics}

## 运动情况
${exercise}

## 已学习的生活习惯
${habits}

## 输出要求
请用以下格式输出（不要超过 300 字）：

### 📊 昨日总结
- 饮食：[昨天吃了什么、总热量、蛋白质/碳水/脂肪概要、是否超标]
- 运动：[昨天是否有运动]
- 体重：[最新体重和变化趋势]
- 亮点：[做得好的地方，用鼓励的语气]

### 💡 今日建议
- 饮食：[2-3 条具体建议，基于昨天的饮食情况；若昨日记录有「营养观察」缺口（如无奶制品/蔬果少），优先建议对应食物]
- 运动：[1-2 条建议，考虑用户的运动能力和限制]
- 提醒：[1 条温馨提醒，比如喝水、注意某事]

语气要像朋友一样亲切自然，不要用说教的口吻。如果昨天没有数据，可以跳过昨日总结，直接给今日建议。`;

      const result = await this.llm.chat(
        [{ role: 'user', content: prompt }],
        null,
        { currentDate: today }
      );

      const summaryContent = result.content || `${greeting}！今天是 **${today}**，新的一天开始了 🌿\n\n有什么我可以帮你的？可以拍照记录饮食，或者聊聊今天的计划。`;

      // 替换刚才的占位消息
      const messages = document.getElementById('chatMessages');
      const lastMsg = messages.lastElementChild;
      if (lastMsg) {
        lastMsg.remove();
      }
      this.addMessage('assistant', summaryContent);

      // 保存到历史
      this.chatManager.history = [{
        role: 'assistant',
        content: summaryContent,
        timestamp: Date.now()
      }];
      await this.chatManager.saveHistory();
    } catch (e) {
      console.error('[新一天总结] 生成失败:', e.message);
      // 失败时用基础问候替换占位消息
      const messages = document.getElementById('chatMessages');
      const lastMsg = messages.lastElementChild;
      if (lastMsg) {
        lastMsg.remove();
      }
      const fallback = `${greeting}！今天是 **${today}**，新的一天开始了 🌿\n\n昨天的对话已自动归档。\n\n有什么我可以帮你的？可以拍照记录饮食，或者聊聊今天的计划。`;
      this.addMessage('assistant', fallback);
    }
  }

  // ===== 主题切换 =====
  // v3.8.0: 按 design/ui-proposals.html 三方案新增 fresh/glass/paper 三主题（纯视觉层，与原三主题并存）
  static THEMES = ['dark', 'light', 'warm', 'fresh', 'glass', 'paper'];
  static THEME_LABELS = {
    dark: '深色科技', light: '浅色清新', warm: '暖调米黄',
    fresh: '晨雾呼吸', glass: '暗色玻璃', paper: '暖纸手账'
  };

  initTheme() {
    const saved = localStorage.getItem('qingban-theme');
    // 防御：旧版本/异常值回退默认主题，避免 setTheme 设出无变量定义的 data-theme
    this.setTheme(App.THEMES.includes(saved) ? saved : 'dark');
  }

  // ===== 字体大小 =====
  initFontScale() {
    const saved = parseFloat(localStorage.getItem('qingban-font-scale')) || 1;
    this.setFontScale(saved);
  }

  setFontScale(scale) {
    document.documentElement.style.setProperty('--font-scale', scale);
    localStorage.setItem('qingban-font-scale', String(scale));
    this.currentFontScale = scale;
    // 更新按钮显示
    const btn = document.getElementById('fontBtn');
    if (btn) {
      const labels = { 0.85: 'A⁻', 1: 'A', 1.15: 'A⁺', 1.3: 'A⁺⁺' };
      btn.textContent = labels[scale] || 'A';
      btn.title = `字体大小: ${this._fontScaleLabel(scale)}（点击调整）`;
    }
    // 更新选中状态
    document.querySelectorAll('.font-size-opt').forEach(opt => {
      opt.classList.toggle('active', parseFloat(opt.dataset.scale) === scale);
    });
  }

  _fontScaleLabel(scale) {
    if (scale <= 0.85) return '小';
    if (scale <= 1) return '标准';
    if (scale <= 1.15) return '大';
    return '特大';
  }

  toggleFontPopover() {
    const popover = document.getElementById('fontPopover');
    popover.classList.toggle('show');
  }

  setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('qingban-theme', theme);
    this.currentTheme = theme;
    // 更新按钮 tooltip
    const btn = document.getElementById('themeBtn');
    if (btn) btn.title = `主题: ${App.THEME_LABELS[theme]}（点击切换）`;
  }

  cycleTheme() {
    const idx = App.THEMES.indexOf(this.currentTheme || 'dark');
    const next = App.THEMES[(idx + 1) % App.THEMES.length];
    this.setTheme(next);
    this.addMessage('system', `已切换到「${App.THEME_LABELS[next]}」主题`);
  }

  // ===== 事件绑定 =====
  bindEvents() {
    // 发送消息
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    // 中文输入法（IME）状态追踪
    let isComposing = false;
    input.addEventListener('compositionstart', () => { isComposing = true; });
    input.addEventListener('compositionend', () => {
      isComposing = false;
    });

    sendBtn.addEventListener('click', () => this.sendMessage());

    input.addEventListener('keydown', (e) => {
      // keyCode 229 = IME 正在组合输入，绝不拦截
      if (e.keyCode === 229) {
        return;
      }
      // IME composing 时不处理任何快捷键
      if (isComposing || e.isComposing) {
        return;
      }
      // Enter 发送消息（Shift+Enter 换行）
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    input.addEventListener('input', () => this.autoResize(input));


    // 拍照上传 — 点击弹出选择菜单
    const photoBtn = document.getElementById('photoBtn');
    const fileInput = document.getElementById('fileInput');
    photoBtn.addEventListener('click', () => this.showPhotoMenu());
    fileInput.addEventListener('change', (e) => this.handlePhotoUpload(e));

    // 功能菜单 — 点击展开/关闭
    document.getElementById('menuBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('menuDropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
    });
    document.getElementById('menuDropdown').addEventListener('click', (e) => e.stopPropagation());

    // 菜单项 — 主题切换
    document.getElementById('menuTheme').addEventListener('click', () => {
      this.cycleTheme();
      document.getElementById('menuDropdown').style.display = 'none';
    });

    // 菜单项 — 字体大小
    document.getElementById('menuFont').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('menuDropdown').style.display = 'none';
      this.toggleFontPopover();
    });
    document.getElementById('fontPopover').addEventListener('click', (e) => e.stopPropagation());
    document.querySelectorAll('.font-size-opt').forEach(opt => {
      opt.addEventListener('click', () => {
        const scale = parseFloat(opt.dataset.scale);
        this.setFontScale(scale);
      });
    });
    document.addEventListener('click', () => {
      document.getElementById('fontPopover').classList.remove('show');
    });

    // 菜单项 — 查看上下文
    document.getElementById('menuContext').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showContext();
    });
    document.getElementById('closeContext').addEventListener('click', () => {
      document.getElementById('contextOverlay').style.display = 'none';
    });
    document.getElementById('contextOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'contextOverlay') {
        document.getElementById('contextOverlay').style.display = 'none';
      }
    });

    // 菜单项 — 模型设置
    document.getElementById('menuSettings').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showSettings();
    });
    document.getElementById('closeSettings').addEventListener('click', () => {
      document.getElementById('settingsOverlay').style.display = 'none';
    });
    document.getElementById('settingsOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'settingsOverlay') {
        document.getElementById('settingsOverlay').style.display = 'none';
      }
    });
    document.getElementById('setTemperature').addEventListener('input', (e) => {
      document.getElementById('setTemperatureVal').textContent = parseFloat(e.target.value).toFixed(1);
    });
    document.getElementById('settingsSave').addEventListener('click', () => this._saveSettings());
    document.getElementById('settingsReset').addEventListener('click', () => this._resetSettings());
    document.getElementById('presetK3').addEventListener('click', () => this._applyPresetK3());

    // 菜单项 — 提醒设置（阶段四 · 主动陪伴）
    document.getElementById('menuReminders').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showReminders();
    });
    document.getElementById('closeReminders').addEventListener('click', () => {
      document.getElementById('remindersOverlay').style.display = 'none';
    });
    document.getElementById('remindersOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'remindersOverlay') {
        document.getElementById('remindersOverlay').style.display = 'none';
      }
    });
    document.getElementById('remindersSave').addEventListener('click', () => this._saveReminders());

    // 菜单项 — 蓝牙体脂秤（AFU-BH-TZ-B1 沃莱）
    document.getElementById('menuScale').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.openScalePanel();
    });
    document.getElementById('scaleCloseBtn').addEventListener('click', () => this.closeScalePanel());
    document.getElementById('scaleOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'scaleOverlay' && !this.scaleManager.isBusy()) {
        this.closeScalePanel();
      }
    });
    document.getElementById('scaleStartBtn').addEventListener('click', () => this.startWeighing());
    document.getElementById('scaleCancelBtn').addEventListener('click', () => {
      this.scaleManager.stopSession('stopped').catch(() => {});
    });
    document.getElementById('scaleCopyLogBtn').addEventListener('click', () => this._copyScaleLog());
    // 输入框上方快捷按钮：点开即自动开始搜秤（进入搜索阶段）
    document.getElementById('quickScaleBtn').addEventListener('click', () => {
      scaleLog('I', 'UI：快捷按钮「蓝牙称重」点击');
      this.openScalePanel(true);
    });

    // 菜单项 — 每日结算设置
    document.getElementById('menuSettlement').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showSettlement();
    });
    document.getElementById('closeSettlement').addEventListener('click', () => {
      document.getElementById('settlementOverlay').style.display = 'none';
    });
    document.getElementById('settlementOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'settlementOverlay') {
        document.getElementById('settlementOverlay').style.display = 'none';
      }
    });
    document.getElementById('settlementSave').addEventListener('click', () => this._saveSettlement());
    document.getElementById('settlementReset').addEventListener('click', () => this._resetSettlement());

    // ===== Ask User 弹窗事件 =====
    document.getElementById('askUserClose').addEventListener('click', () => this._resolveAskUser(null));
    document.getElementById('askUserSubmit').addEventListener('click', () => this._submitAskUserCustom());
    document.getElementById('askUserInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._submitAskUserCustom();
      }
    });

    // 菜单项 — Token 用量
    document.getElementById('menuToken').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      const bar = document.getElementById('tokenBar');
      bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
    });

    // 菜单项 — 更新日志
    document.getElementById('menuChangelog').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showChangelog();
    });
    document.getElementById('closeChangelog').addEventListener('click', () => {
      document.getElementById('changelogOverlay').style.display = 'none';
    });
    document.getElementById('changelogOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'changelogOverlay') {
        document.getElementById('changelogOverlay').style.display = 'none';
      }
    });

    // 菜单项 — 重建索引
    document.getElementById('menuRebuild').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      if (confirm('确定要重建 INDEX.md 索引文件吗？\n\n这会重新扫描所有 MD 文件并更新索引，不会删除任何数据。')) {
        this.rebuildIndex();
      }
    });

    // 菜单项 — 刷新习惯总结
    document.getElementById('menuRefreshHabits').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      if (confirm('确定要刷新习惯总结吗？\n\n这将读取近 21 天的对话记录，让 AI 重新分析并更新你的习惯档案。\n已有习惯档案会被覆盖更新。')) {
        this.refreshHabits();
      }
    });

    // 菜单项 — 重置数据
    document.getElementById('menuReset').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      if (confirm('确定要重置所有数据吗？\n\n这将清除全部对话历史、饮食记录、身体指标等数据，且无法恢复！')) {
        this.resetData();
      }
    });

    // 菜单项 — 模拟次日
    document.getElementById('menuNextDay').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      if (confirm('确定要模拟次日吗？\n\n这将触发跨天总结流程，保存当前对话并开始新的一天。')) {
        this.advanceDay();
      }
    });

    // 菜单项 — 数据备份
    document.getElementById('menuBackup').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this._openBackupPanel();
    });
    document.getElementById('closeBackup').addEventListener('click', () => {
      document.getElementById('backupOverlay').style.display = 'none';
    });
    document.getElementById('backupOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'backupOverlay') {
        document.getElementById('backupOverlay').style.display = 'none';
      }
    });
    document.getElementById('backupExportBtn').addEventListener('click', () => this._exportBackup());
    document.getElementById('backupImportBtn').addEventListener('click', () => {
      document.getElementById('backupImportInput').click();
    });
    document.getElementById('backupImportInput').addEventListener('change', (e) => this._importBackupFile(e.target));
    document.getElementById('backupSnapshotBtn').addEventListener('click', () => this._snapshotNow());
    document.getElementById('backupSnapshotList').addEventListener('click', (e) => this._onSnapshotListClick(e));

    // 跨天结算状态条 + 步骤明细弹窗
    document.getElementById('rolloverStrip').addEventListener('click', () => this._openRolloverDetail());
    document.getElementById('closeRollover').addEventListener('click', () => {
      document.getElementById('rolloverOverlay').style.display = 'none';
      this._rolloverDetailOpen = false;
    });
    document.getElementById('rolloverOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'rolloverOverlay') {
        document.getElementById('rolloverOverlay').style.display = 'none';
        this._rolloverDetailOpen = false;
      }
    });

    // 顶栏 — 趋势面板
    document.getElementById('trendBtn').addEventListener('click', () => this._openTrendPanel());
    document.getElementById('closeTrend').addEventListener('click', () => {
      document.getElementById('trendOverlay').style.display = 'none';
    });
    document.getElementById('trendOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'trendOverlay') {
        document.getElementById('trendOverlay').style.display = 'none';
      }
    });
    document.getElementById('trendWeeklyBtn').addEventListener('click', () => this._onWeeklyReportClick());

    // 菜单项 — 日历（日期徽章已从顶栏移入功能菜单）
    document.getElementById('menuCalendar').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.showCalendar();
    });
    document.getElementById('closeCalendar').addEventListener('click', () => {
      document.getElementById('calendarOverlay').style.display = 'none';
    });
    document.getElementById('calendarOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'calendarOverlay') {
        document.getElementById('calendarOverlay').style.display = 'none';
      }
    });
    document.getElementById('calPrevMonth').addEventListener('click', () => this._calendarNav(-1));
    document.getElementById('calNextMonth').addEventListener('click', () => this._calendarNav(1));

    // 历史记录查看器关闭
    document.getElementById('closeHistory').addEventListener('click', () => {
      document.getElementById('historyOverlay').style.display = 'none';
    });
    document.getElementById('historyOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'historyOverlay') {
        document.getElementById('historyOverlay').style.display = 'none';
      }
    });

    // 记忆面板
    document.getElementById('memoryBtn').addEventListener('click', () => this.showMemory());
    document.getElementById('closeMemory').addEventListener('click', () => {
      document.getElementById('memoryOverlay').classList.remove('show');
    });
    document.getElementById('memoryOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'memoryOverlay') {
        document.getElementById('memoryOverlay').classList.remove('show');
      }
    });

    // 菜单项 — Auto Dream — 生成周报/月报/模式分析（已从顶栏移入功能菜单）
    document.getElementById('menuAutoDream').addEventListener('click', () => {
      document.getElementById('menuDropdown').style.display = 'none';
      this.runAutoDream();
    });

    // 打卡面板
    document.getElementById('habitBtn').addEventListener('click', () => this.showHabitPanel());
    document.getElementById('closeHabit').addEventListener('click', () => {
      document.getElementById('habitOverlay').style.display = 'none';
    });
    document.getElementById('habitOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'habitOverlay') {
        document.getElementById('habitOverlay').style.display = 'none';
      }
    });
    document.getElementById('habitPrevDay').addEventListener('click', () => this._habitNavDay(-1));
    document.getElementById('habitNextDay').addEventListener('click', () => this._habitNavDay(1));
    document.getElementById('habitAddBtn').addEventListener('click', () => this._showHabitAddForm());
    document.getElementById('closeHabitAdd').addEventListener('click', () => {
      document.getElementById('habitAddOverlay').style.display = 'none';
    });
    document.getElementById('habitAddOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'habitAddOverlay') {
        document.getElementById('habitAddOverlay').style.display = 'none';
      }
    });
    document.getElementById('habitAddConfirm').addEventListener('click', () => this._confirmAddHabit());
    document.getElementById('habitSuggestBtn').addEventListener('click', () => this._loadHabitSuggestions());
    // 图标选择器
    document.querySelectorAll('.habit-icon-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.habit-icon-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });
    // 自定义打卡弹窗
    document.getElementById('closeHabitCustomCheckin').addEventListener('click', () => {
      document.getElementById('habitCustomCheckinOverlay').style.display = 'none';
    });
    document.getElementById('habitCustomCheckinOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'habitCustomCheckinOverlay') {
        document.getElementById('habitCustomCheckinOverlay').style.display = 'none';
      }
    });
    document.getElementById('habitCustomConfirm').addEventListener('click', () => this._confirmCustomCheckin());

    // 关闭文件查看器
    document.getElementById('closeViewer').addEventListener('click', () => {
      document.getElementById('fileViewer').classList.remove('show');
    });
    document.getElementById('fileViewer').addEventListener('click', (e) => {
      if (e.target.id === 'fileViewer') {
        document.getElementById('fileViewer').classList.remove('show');
      }
    });
  }

  // 构建图片预识别的辅助上下文：用户食物种类清单 + 当日对话记录
  // 供视觉模型结合"用户平时吃什么、今天聊了什么"识别图片（家常菜名、上午提过的餐食不再凭空猜）
  // 任一部分读取失败只跳过该部分，全部为空时返回空串 — 识别仍按原极简提示词进行
  async _buildRecognitionContext() {
    const parts = [];
    try {
      const foodTypes = await this.fm.readFile('rules/food-types.md');
      // 全部分类均为"(暂无记录)"的初始模板不注入，避免浪费 token
      const hasEntry = foodTypes && foodTypes.split('\n').some(l => /^- /.test(l) && !l.includes('暂无记录'));
      if (hasEntry) {
        parts.push(`【用户食物种类清单（识别时优先对照）】\n${foodTypes.substring(0, 1500)}`);
      }
    } catch (_) { /* 清单读取失败不影响识别 */ }
    try {
      // 当前图片消息在识别完成后才入历史（addUserPhotoMessage），此处不会自引用
      const history = this.chatManager.getHistory().filter(m => m.role !== 'system');
      const MAX_CHARS = 2000;
      const lines = [];
      let total = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        const text = typeof history[i].content === 'string' ? history[i].content.trim() : '';
        if (!text) continue;
        const line = `${history[i].role === 'user' ? '用户' : 'AI'}: ${text}`;
        if (total + line.length > MAX_CHARS) break;
        lines.unshift(line);
        total += line.length;
      }
      if (lines.length > 0) parts.push(`【今日对话记录】\n${lines.join('\n')}`);
    } catch (_) { /* 历史读取失败不影响识别 */ }
    return parts.join('\n\n');
  }

  // ===== 发送消息 =====
  // overrideText：非空时以该文本直接发送（体脂秤同步等系统触发路径），不读输入框、不带图片
  async sendMessage(overrideText = null) {
    if (this.isProcessing) {
      this.showToast('上一条还在处理中', '请稍候，或等待自动恢复后重试', 'info');
      return;
    }

    const input = document.getElementById('messageInput');
    const text = overrideText !== null ? String(overrideText) : input.value.trim();
    const hasPhotos = overrideText === null && this.pendingPhotos.length > 0;
    this._reqIsImg = hasPhotos;
    const sentPhotos = hasPhotos ? [...this.pendingPhotos] : [];
    if (!text && !hasPhotos) return;

    // 构建用户消息
    let userContent;
    const photos = hasPhotos ? [...this.pendingPhotos] : [];
    if (hasPhotos) {
      // 有图片(支持多张) — 先显示用户消息，图片预识别放到 setProcessing 之后（状态条可显示「识别图片中」）
      this.addMessage('user', text || '', photos);
      this.pendingPhotos = [];
      this.clearPhotoPreview();
    } else {
      // 纯文字
      this.addMessage('user', text);
    }

    if (overrideText === null) {
      input.value = '';
      this.autoResize(input);
    }
    this.setProcessing(true);

    // 显示 typing 指示器（等待完整响应）
    this.showTyping();

    let recognition = '';
    if (hasPhotos) {
      // 两阶段发送第一阶段：图片单独发给视觉模型预识别（极简提示词 + 辅助上下文：食物清单/当日对话），
      // 识别文字并入消息后主对话保持纯文本 — 不再每轮工具调用重复编码图片、不切换视觉模型、可命中响应缓存
      this._reqStage = 'recognizing';
      this._showReqStatus();
      let recogContext = '';
      try { recogContext = await this._buildRecognitionContext(); } catch (_) { /* 上下文构建失败按零上下文识别 */ }
      try {
        recognition = await this.llm.recognizeImages(photos, recogContext ? { context: recogContext } : {});
      } catch (e) {
        console.warn('[sendMessage] 图片预识别失败，回退为原图+文字直发:', e.message);
      }
      if (recognition) {
        userContent = text ? `${text}\n[图片识别] ${recognition}` : `[图片识别] ${recognition}`;
      } else {
        // 预识别失败/为空 — 回退旧行为：图片数组直发（视觉模型接管，行为同旧版）
        const parts = [];
        if (text) parts.push({ type: 'text', text });
        for (const photo of photos) parts.push({ type: 'image_url', image_url: { url: photo } });
        userContent = parts;
      }
      this.chatManager.addUserPhotoMessage(text || '', photos, recognition);
    } else {
      userContent = text;
      this.chatManager.addUserMessage(text);
    }

    // 保存上下文用于网络中断后重试（userContent 已含识别文字，重试不会重复识别）
    this._lastSendContext = { userContent, sentPhotos: photos };

    // 同一天内不压缩上下文，避免单天对话产生遗忘感
    // 上下文压缩改为仅在跨天(advanceDay)时通过存档+清空来处理

    try {
      // 调用流式 LLM 服务（实时渲染，首字即出；自带重试/中断恢复）
      const result = await this._streamRender(userContent);

      // 记录到对话历史
      this.chatManager.addAssistantMessage(result.content);

      // 如果之前发了图片，把历史中的图片消息替换为文本摘要
      if (sentPhotos.length > 0) {
        this.chatManager.replaceLastPhotoMessage(result.content);
      }

      // 记录 token 用量
      if (result.usage) {
        await this.chatManager.recordTokenUsage(result.usage);
        this.updateTokenBar();
      }
      // 记录当前模型
      if (result.model) {
        this._currentModel = result.model;
        this.updateTokenBar();
      }

      // 更新工具日志
      this.renderToolLog(result.toolCalls);

      // 更新文件树（文件可能已被修改）
      await this.renderFileTree();

      // 网络中断时继续显示重试按钮
      if (result.content && result.content.includes('网络中断')) {
        const lastMsg = document.querySelector('#chatMessages .message.assistant:last-child');
        this._appendRetryButton(lastMsg);
      }
    } catch (err) {
      this.hideTyping();
      const lastMsg = document.querySelector('#chatMessages .message.assistant:last-child');
      if (lastMsg && lastMsg.classList.contains('streaming')) {
        this._updateStreamingMessage(lastMsg, '出错了：' + err.message, '', true, '');
        this._appendRetryButton(lastMsg);
      } else {
        this.addMessage('assistant', `出错了：${err.message}`);
        this._appendRetryButton(null);
      }
    }

    this.setProcessing(false);
    this.updateContextInfo();
  }

  // 添加重试按钮到消息元素
  _appendRetryButton(target) {
    if (!target) {
      target = document.querySelector('#chatMessages .message.assistant:last-child');
    }
    if (!target) return;
    // 避免重复添加
    if (target.querySelector('.stream-retry-btn')) return;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn accent stream-retry-btn';
    retryBtn.textContent = '🔄 重试';
    retryBtn.style.cssText = 'margin-top:8px;font-size:13px;padding:4px 16px;';
    retryBtn.onclick = () => this._retryLastMessage();
    target.appendChild(retryBtn);
    this._scrollToBottom();
  }

  // 网络中断/后台中断后重试上一次消息
  async _retryLastMessage() {
    if (!this._lastSendContext || this.isProcessing) return;

    const { userContent } = this._lastSendContext;

    // 移除历史中最后一条 assistant 消息（可能是部分内容或错误）
    const history = this.chatManager.getHistory();
    if (history.length > 0 && history[history.length - 1].role === 'assistant') {
      this.chatManager.history.pop();
      this.chatManager.saveHistory();
    }

    // 移除 UI 中最后一条 assistant 消息
    const messages = document.getElementById('chatMessages');
    const lastAssistant = messages.querySelector('.message.assistant:last-child');
    if (lastAssistant) lastAssistant.remove();

    // 重新执行 LLM 请求（非流式）
    this.setProcessing(true);
    this.showTyping();

    try {
      const result = await this._streamRender(userContent);

      this.chatManager.addAssistantMessage(result.content);

      if (result.usage) {
        await this.chatManager.recordTokenUsage(result.usage);
        this.updateTokenBar();
      }
      if (result.model) {
        this._currentModel = result.model;
        this.updateTokenBar();
      }

      this.renderToolLog(result.toolCalls);
      await this.renderFileTree();

      // 网络中断时继续显示重试按钮
      if (result.content && result.content.includes('网络中断')) {
        const lastMsg = document.querySelector('#chatMessages .message.assistant:last-child');
        this._appendRetryButton(lastMsg);
      }
    } catch (err) {
      this.hideTyping();
      this.addMessage('assistant', `出错了：${err.message}`);
      this._appendRetryButton(null);
    }

    this.setProcessing(false);
    this.updateContextInfo();
  }

  // ===== 蓝牙体脂秤（AFU-BH-TZ-B1 · 沃莱）=====
  // 流程：蓝牙直读体重+阻抗 → 本地按官方公式算体成分 → 写入 BODY_METRICS.md
  // → 以「[体脂秤同步]」用户消息触发一轮对话，AI 经系统提示词注入读到新数据并分析

  // autoStart：输入框上方快捷按钮点开时直接进入搜索阶段（免二次点击）
  openScalePanel(autoStart = false) {
    const overlay = document.getElementById('scaleOverlay');
    // 称重进行中：只把弹窗调回前台，不重置状态（实时体重/状态继续显示）
    if (this.scaleManager.isBusy()) {
      overlay.style.display = 'flex';
      return;
    }
    // 与 settingsOverlay 同款：.file-viewer 的 CSS 默认 display:none，
    // 须以内联 flex 覆盖（此前只清内联值导致弹窗"点了没反应"）
    overlay.style.display = 'flex';
    document.getElementById('scaleStatus').textContent = '支持蚂蚁阿福 AFU-BH-TZ-B1（沃莱代工）。点击开始后，赤脚站上秤并保持静止，直到提示完成。';
    document.getElementById('scaleLive').style.display = 'none';
    document.getElementById('scaleResult').style.display = 'none';
    document.getElementById('scaleCancelBtn').style.display = 'none';
    const startBtn = document.getElementById('scaleStartBtn');
    startBtn.disabled = false;
    startBtn.textContent = '🔗 开始称重';
    if (!this.scaleManager.isAvailable()) {
      document.getElementById('scaleStatus').textContent = '⚠️ 当前环境不可用：浏览器网页版不支持蓝牙，请在轻伴 APK 中使用此功能。';
      startBtn.disabled = true;
      return;
    }
    if (autoStart && !this.scaleManager.isBusy()) {
      this.startWeighing();
    }
  }

  async closeScalePanel() {
    if (this.scaleManager.isBusy()) {
      await this.scaleManager.stopSession('stopped').catch(() => {});
    }
    document.getElementById('scaleOverlay').style.display = 'none';
  }

  async startWeighing() {
    if (this.scaleManager.isBusy()) return;
    const statusEl = document.getElementById('scaleStatus');
    const liveEl = document.getElementById('scaleLive');
    const liveVal = document.getElementById('scaleLiveValue');
    const resultEl = document.getElementById('scaleResult');
    const startBtn = document.getElementById('scaleStartBtn');
    const cancelBtn = document.getElementById('scaleCancelBtn');
    startBtn.disabled = true;
    cancelBtn.style.display = '';
    resultEl.style.display = 'none';
    scaleLog('I', '── UI：用户点击「开始称重」');

    try {
      const raw = await this.scaleManager.startSession({
        onStatus: (stage, detail) => { statusEl.textContent = detail; },
        onLiveWeight: (kg) => {
          liveEl.style.display = '';
          liveVal.textContent = kg.toFixed(1);
        },
        onHistory: () => {}
      });

      // 本地计算体成分：沃莱 A1 由 scale-manager 直接带回 Segal 估算结果；
      // B1（若接到）在此用官方公式计算 —— 秤只给体重+阻抗
      const profile = parseProfileMd(await this.fm.readFile('PROFILE.md'));
      let bodyFat = raw.bodyFatPercent != null ? raw.bodyFatPercent : null;
      let comp = raw.composition || null;
      if (bodyFat === null && raw.impedanceOhm) {
        bodyFat = AfuB1.bodyFatPercent(raw.weightKg, profile.heightCm, profile.age, profile.sex, raw.impedanceOhm);
        if (bodyFat !== null) {
          comp = AfuB1.bodyComposition(profile.sex, profile.age, profile.heightCm, raw.weightKg, bodyFat);
        }
      }
      scaleLog('I', `体成分计算: 阻抗=${raw.impedanceOhm ?? '无'} 体脂率=${bodyFat ?? '—'} 来源=${raw.bodyFatPercent != null ? raw.source + '(秤端公式)' : 'B1公式/跳过'}`, {
        profile: { sex: profile.sex, age: profile.age, heightCm: profile.heightCm }
      });
      const meas = {
        weightKg: raw.weightKg, impedanceOhm: raw.impedanceOhm,
        bodyFatPercent: bodyFat, composition: comp, timestamp: raw.timestamp
      };

      // 落盘（含秤内历史补录），AI 下一轮对话经系统提示词即可读到
      const rec = await recordBodyMeasurement(this.fm, meas, profile, new Date(), raw.historyRecords || []);
      await this.renderFileTree();

      // 结果卡片
      const diffStr = rec.diff === null ? '首次记录'
        : `${rec.diff > 0 ? '+' : ''}${rec.diff.toFixed(1)}kg（上次 ${(rec.prevWeight || 0).toFixed(1)}kg）`;
      let html = `⚖️ <b>${meas.weightKg.toFixed(1)}kg</b>　${diffStr}`;
      if (bodyFat !== null) {
        html += `<br>体脂率 <b>${bodyFat.toFixed(1)}%</b>（阻抗 ${Math.round(meas.impedanceOhm)}Ω）`;
        if (comp) {
          html += `<br>骨骼肌 ${comp.skeletalMusclePercent.toFixed(1)}% · 水分 ${comp.waterPercent.toFixed(1)}% · 骨量 ${comp.boneMassKg.toFixed(2)}kg`
            + (comp.visceralFatIndex != null ? ` · 内脏脂肪 ${comp.visceralFatIndex}` : '');
        }
      } else {
        html += '<br>（本次未测到阻抗，体脂率待下次赤脚测量）';
      }
      html += `<br><span style="color:var(--muted2);">已写入 BODY_METRICS.md${(raw.historyRecords || []).length > 0 ? `，补录秤内历史 ${raw.historyRecords.length} 条` : ''}</span>`;
      resultEl.innerHTML = html;
      resultEl.style.display = '';
      liveEl.style.display = 'none';
      statusEl.textContent = '同步完成 ✓ 正在请 AI 分析本次数据…';

      // 稍作停留后收起弹窗并触发 AI 分析
      setTimeout(() => {
        this.closeScalePanel();
        this._triggerScaleAnalysis(meas, rec);
      }, 2600);
    } catch (err) {
      const msg = err && err.message ? err.message : '称重失败';
      scaleLog('E', `UI 捕获称重失败: ${msg}`);
      statusEl.innerHTML = `❌ ${msg}<br><span style="color:var(--muted2);font-size:12px;">详细过程见「复制调试日志」（或记忆面板 .meta/scale-log.md），反馈问题时请一并附上</span>`;
      liveEl.style.display = 'none';
    } finally {
      cancelBtn.style.display = 'none';
      startBtn.disabled = false;
      startBtn.textContent = '🔗 再称一次';
    }
  }

  // 一键复制体脂秤调试日志（反馈问题用；三路日志中的内存缓冲即完整内容）
  async _copyScaleLog() {
    const text = getScaleLog();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      // WebView 剪贴板 API 不可用时退回 execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (_) { ok = false; }
    }
    this.showToast(ok ? '调试日志已复制' : '复制失败', ok ? '内容较长，可直接粘贴反馈；持久化副本在记忆面板 .meta/scale-log.md' : '请到「记忆」面板打开 .meta/scale-log.md 查看复制', ok ? 'success' : 'info');
    scaleLog('I', `UI：复制调试日志（${ok ? '成功' : '失败'}，${text.length} 字符）`);
  }

  // 称重完成后自动触发 AI：以用户消息形式注入，AI 读取 BODY_METRICS.md 分析
  _triggerScaleAnalysis(meas, rec) {
    scaleLog('I', `UI：触发 AI 分析（addedRow=${rec.addedRow}，prevWeight=${rec.prevWeight ?? '无'}）`);
    const diffStr = rec.diff === null ? '首次记录'
      : `${rec.diff > 0 ? '+' : ''}${rec.diff.toFixed(1)}kg（上次 ${(rec.prevWeight || 0).toFixed(1)}kg）`;
    const lines = [
      '[体脂秤同步] 刚完成一次蓝牙称重，数据已由系统写入 BODY_METRICS.md（体重趋势表与最新数据区均已更新，无需再写入）：',
      `- 体重：${meas.weightKg.toFixed(1)}kg（较上次：${diffStr}）`
    ];
    if (meas.bodyFatPercent != null) {
      lines.push(`- 体脂率：${meas.bodyFatPercent.toFixed(1)}%（阻抗 ${Math.round(meas.impedanceOhm)}Ω）`);
      const c = meas.composition;
      if (c) {
        const seg = [
          `骨骼肌率 ${c.skeletalMusclePercent.toFixed(1)}%`,
          `水分率 ${c.waterPercent.toFixed(1)}%`,
          `骨量 ${c.boneMassKg.toFixed(2)}kg`
        ];
        if (c.visceralFatIndex != null) seg.push(`内脏脂肪指数 ${c.visceralFatIndex}`);
        lines.push(`- ${seg.join(' / ')}`);
      }
    }
    lines.push('', '请读取 BODY_METRICS.md 中的最新数据，结合近 7 天饮食记录，给我这次称重的分析与建议（体重趋势怎么看、体脂/肌肉变化、饮食或运动要不要调整）。');
    this._sendWhenIdle(lines.join('\n'));
  }

  // 等当前对话处理完再发（体脂秤触发路径用，避免与用户正在进行的对话撞车）
  async _sendWhenIdle(msg, maxWaitMs = 30000) {
    const start = Date.now();
    while (this.isProcessing && Date.now() - start < maxWaitMs) {
      await new Promise(r => setTimeout(r, 600));
    }
    this.sendMessage(msg);
  }

  // 创建流式消息容器
  _createStreamingMessage() {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'message assistant streaming';
    div.innerHTML = '<span class="stream-cursor">▋</span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  // 流式调用 LLM 并实时渲染（被 sendMessage / _retryLastMessage 复用）
  async _streamRender(userContent) {
    let bubble = null, fullText = '', thinking = '', curTool = '';
    const onText = (chunk, full) => {
      fullText = full; curTool = '';
      if (!bubble) {
        // 首个字到达：取消看门狗（避免误报"无响应"）、隐藏状态条、切到流式气泡
        if (this._processingWatchdog) { clearTimeout(this._processingWatchdog); this._processingWatchdog = null; }
        this._hideReqStatus();
        this.hideTyping();
        bubble = this._createStreamingMessage();
      }
      this._updateStreamingMessage(bubble, fullText, thinking, false, curTool);
      this._scrollToBottom();
    };
    const onTool = (name) => {
      curTool = name;
      if (!bubble) { this.hideTyping(); bubble = this._createStreamingMessage(); }
      this._updateStreamingMessage(bubble, fullText, thinking, false, curTool);
      this._scrollToBottom();
    };
    const onThinking = (chunk, full) => {
      thinking = full;
      if (bubble) this._updateStreamingMessage(bubble, fullText, thinking, false, curTool);
    };
    const result = await this.llmService.chatStream(
      userContent,
      // 末尾的当前用户消息由 userContent 携带，不重复发送（修复历史版本每条请求双发最新消息的问题）
      this.chatManager.getHistoryForRequest(),
      { currentDate: this.chatManager.currentDate },
      onText, onTool, onThinking
    );
    this.hideTyping();
    if (bubble) {
      bubble.classList.remove('streaming');
      this._updateStreamingMessage(bubble, result.content || '', thinking, true, '');
    }
    return result;
  }

  // 更新流式消息内容（思考区域 + 正文）
  _updateStreamingMessage(div, text, thinking, isFinal = false, toolName = '') {
    let html = '';
    // 思考区域（折叠式）
    if (thinking && thinking.trim()) {
      const toggleLabel = isFinal ? '💭 思考过程（点击展开/折叠）' : '💭 思考中...';
      html += `<details class="thinking-block"${isFinal ? ' open' : ''}>`;
      html += `<summary class="thinking-toggle">${toggleLabel}</summary>`;
      html += `<div class="thinking-content">${this.formatMarkdown(thinking)}</div>`;
      html += `</details>`;
    }
    // 工具调用状态（流式进行中）
    if (toolName && !isFinal) {
      html += `<div class="tool-stream-status">⏳ 正在调用工具：${this.getToolIcon(toolName)} ${toolName}...</div>`;
    }
    // 正文
    if (text && text.trim()) {
      html += this.formatMarkdown(text);
    }
    // 流式光标（非最终状态）
    if (!isFinal) {
      html += '<span class="stream-cursor">▋</span>';
    }
    div.innerHTML = html;
  }

  // 滚动到底部
  _scrollToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
  }

  // ===== 拍照菜单（拍照 / 从相册选择）=====
  showPhotoMenu() {
    // 移除已存在的菜单
    const old = document.getElementById('photoMenu');
    if (old) { old.remove(); return; }

    const photoBtn = document.getElementById('photoBtn');
    const rect = photoBtn.getBoundingClientRect();

    const menu = document.createElement('div');
    menu.id = 'photoMenu';
    menu.style.cssText = `position:fixed;z-index:9999;background:var(--bg2);border:1px solid var(--rule);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.2);overflow:hidden;min-width:140px;`;
    // 定位在拍照按钮上方
    menu.style.left = rect.left + 'px';
    menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';

    const makeItem = (label, icon, action) => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:11px 16px;cursor:pointer;font-size:13px;color:var(--ink);transition:background 0.15s;';
      item.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg><span>${label}</span>`;
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg3)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', () => { menu.remove(); action(); });
      return item;
    };

    menu.appendChild(makeItem('📸 拍餐照 · 一键记录', 'icon-camera', () => this.openCamera(true)));
    menu.appendChild(makeItem('拍照', 'icon-camera', () => this.openCamera(false)));
    menu.appendChild(makeItem('从相册选择', 'icon-folder', () => document.getElementById('fileInput').click()));

    document.body.appendChild(menu);

    // 点击外部关闭
    setTimeout(() => {
      const close = (e) => {
        if (!menu.contains(e.target) && e.target !== photoBtn) {
          menu.remove();
          document.removeEventListener('click', close);
        }
      };
      document.addEventListener('click', close);
    }, 0);
  }

  // 调用摄像头拍照（单张；autoSend=true 时拍完自动附上记录意图并直接发送 — 一键拍餐记录）
  openCamera(autoSend = false) {
    // 创建带 capture 属性的临时 input
    const camInput = document.createElement('input');
    camInput.type = 'file';
    camInput.accept = 'image/*';
    camInput.capture = 'environment'; // 调用后置摄像头
    camInput.style.display = 'none';
    document.body.appendChild(camInput);

    camInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) {
        try {
          const base64 = await this.dietRecorder.processImage(files[0]);
          this.pendingPhotos.push(base64);
          this.showPhotoPreview(this.pendingPhotos);
          if (autoSend) {
            const input = document.getElementById('messageInput');
            if (!input.value.trim()) {
              input.value = '帮我记录这餐饮食 📸';
              this.autoResize(input);
            }
            this.sendMessage();
          }
        } catch (err) {
          console.error('Camera capture error:', err);
          if (autoSend) this.showToast('拍照失败', '未能获取照片，请重试', 'error');
        }
      }
      camInput.remove();
    });

    camInput.click();
  }

  // ===== 照片上传（支持多张）=====
  async handlePhotoUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    for (const file of files) {
      try {
        const base64 = await this.dietRecorder.processImage(file);
        this.pendingPhotos.push(base64);
      } catch (err) {
        console.error('Photo upload error:', err);
      }
    }
    this.showPhotoPreview(this.pendingPhotos);
    event.target.value = '';
  }

  // ===== 示例照片 =====
  renderSamplePhotos() {
    const container = document.getElementById('samplePhotos');
    container.innerHTML = '';

    this.sampleFoods.forEach(food => {
      const btn = document.createElement('div');
      btn.style.cssText = `
        width:48px;height:48px;border-radius:8px;cursor:pointer;
        background:${food.color}22;border:1px solid ${food.color}44;
        display:flex;align-items:center;justify-content:center;
        color:${food.color};
        transition:all 0.15s;
      `;
      btn.innerHTML = `<svg style="width:22px;height:22px;"><use href="#${food.icon}"/></svg>`;
      btn.title = `模拟${food.label}拍照`;
      btn.addEventListener('mouseenter', () => {
        btn.style.borderColor = food.color;
        btn.style.background = food.color + '33';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = food.color + '44';
        btn.style.background = food.color + '22';
      });
      btn.addEventListener('click', () => {
        this.pendingPhotos = [this.generatePlaceholderImage(food.color, food.label)];
        this.showPhotoPreview(this.pendingPhotos);

        const input = document.getElementById('messageInput');
        input.value = food.text;
        input.focus();
        this.autoResize(input);
      });
      container.appendChild(btn);
    });
  }

  // 生成占位图片（canvas 转 base64）
  generatePlaceholderImage(color, label) {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');

    // 背景
    const gradient = ctx.createLinearGradient(0, 0, 400, 300);
    gradient.addColorStop(0, color + '40');
    gradient.addColorStop(1, color + '20');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 400, 300);

    // 边框
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(10, 10, 380, 280);

    // 文字
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 200, 160);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = color + 'aa';
    ctx.fillText('模拟食物照片', 200, 190);

    return canvas.toDataURL('image/jpeg', 0.7);
  }

  // ===== 照片预览（支持多张）=====
  showPhotoPreview(photos) {
    const container = document.getElementById('photoPreview');
    container.innerHTML = '';

    const list = Array.isArray(photos) ? photos : [photos];
    list.forEach((base64, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'photo-preview';

      const img = document.createElement('img');
      img.src = base64;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        this.pendingPhotos.splice(idx, 1);
        this.showPhotoPreview(this.pendingPhotos);
      });

      wrapper.appendChild(img);
      wrapper.appendChild(removeBtn);
      container.appendChild(wrapper);
    });

    // 多张时显示计数提示
    if (list.length > 1) {
      const count = document.createElement('span');
      count.style.cssText = 'font-size:11px;color:var(--text2);margin-left:4px;white-space:nowrap;';
      count.textContent = `${list.length} 张`;
      container.appendChild(count);
    }
  }

  clearPhotoPreview() {
    document.getElementById('photoPreview').innerHTML = '';
  }

  // ===== 消息渲染 =====
  addMessage(role, text, imageUrl = null, toolCalls = null) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();

    if (role === 'user' && imageUrl) {
      // 图片消息(支持单张或多张)
      const imgs = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
      const imgDiv = document.createElement('div');
      imgDiv.className = 'message image';
      imgDiv.style.alignSelf = 'flex-end';
      imgDiv.style.display = 'flex';
      imgDiv.style.flexWrap = 'wrap';
      imgDiv.style.gap = '4px';
      imgDiv.style.maxWidth = '320px';
      imgs.forEach(src => {
        const img = document.createElement('img');
        img.src = src;
        img.style.maxWidth = imgs.length > 1 ? '150px' : '220px';
        img.style.borderRadius = '8px';
        imgDiv.appendChild(img);
      });
      container.appendChild(imgDiv);

      if (text) {
        const textDiv = document.createElement('div');
        textDiv.className = 'message user';
        textDiv.innerHTML = this.formatMarkdown(text);
        container.appendChild(textDiv);
      }
    } else {
      const div = document.createElement('div');
      div.className = `message ${role}`;
      div.innerHTML = this.formatMarkdown(text);

      // system 消息居中显示
      if (role === 'system') {
        div.style.alignSelf = 'center';
        div.style.maxWidth = '85%';
      }

      // 添加工具调用徽章
      if (toolCalls && toolCalls.length > 0) {
        const badges = document.createElement('div');
        badges.className = 'tool-badges';
        toolCalls.forEach(tc => {
          const badge = document.createElement('span');
          const toolType = tc.tool || '';
          badge.className = `tool-badge ${toolType}`;
          badge.innerHTML = `${this.getToolIcon(tc.tool)} ${tc.displayName || tc.tool}`;
          badges.appendChild(badge);
        });
        div.appendChild(badges);
      }

      container.appendChild(div);
    }

    container.scrollTop = container.scrollHeight;
  }

  showTyping() {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'typing';
    div.id = 'typingIndicator';
    div.innerHTML = '<span></span><span></span><span></span><span class="typing-wait"></span>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  hideTyping() {
    const typing = document.getElementById('typingIndicator');
    if (typing) typing.remove();
  }

  // ===== 渲染历史对话（重启恢复用）=====
  renderChatHistory(history) {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';

    for (const msg of history) {
      if (msg.role === 'user') {
        // 新格式：content 为纯文本, _displayPhotos 存图片
        if (msg._displayPhotos && msg._displayPhotos.length > 0) {
          // 显示纯文本（去掉 [图片已识别...] 标记，只显示原文）
          const displayText = (msg.content || '').split('\n[图片已识别')[0].split('\n[图片消息]')[0];
          this.addMessage('user', displayText, msg._displayPhotos);
        } else if (Array.isArray(msg.content)) {
          // 旧格式兼容：content 数组含 image_url
          const textPart = msg.content.find(c => c.type === 'text');
          const imgParts = msg.content.filter(c => c.type === 'image_url');
          const imgs = imgParts.map(p => p.image_url.url);
          const text = textPart ? textPart.text : '';
          this.addMessage('user', text, imgs);
        } else {
          this.addMessage('user', msg.content);
        }
      } else if (msg.role === 'assistant') {
        this.addMessage('assistant', msg.content);
      } else if (msg.role === 'system') {
        this.addMessage('system', msg.content);
      }
    }
  }

  showWelcome() {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();

    // 检查是否已有消息
    if (container.children.length > 0) return;

    const welcomeText = `你好呀！我是**轻伴**，你的 AI 减肥陪伴助手

你可以试试：
- 点击下方的彩色按钮**模拟拍照**记录饮食
- 输入"今天**81.5kg**"记录体重
- 问我"**能吃花生吗**"
- 之后输入"**昨天吃了什么**"来回忆记录

所有数据都以 MD 文件存储在本地，左侧可以查看文件树。`;
    this.addMessage('assistant', welcomeText);
  }

  // ===== 工具日志渲染 =====
  renderToolLog(toolCalls) {
    const container = document.getElementById('toolLog');
    const empty = container.querySelector('.tool-log-empty');
    if (empty) empty.remove();

    toolCalls.forEach(tc => {
      const entry = document.createElement('div');
      entry.className = 'tool-log-entry';

      const toolType = tc.tool || '';
      const icon = this.getToolIcon(tc.tool);

      entry.innerHTML = `
        <div class="tool-name ${toolType}">${icon} ${tc.tool}</div>
        <div class="tool-args">${this.formatArgs(tc.args)}</div>
        <div class="tool-result">${this.escapeHtml(tc.resultPreview || tc.result || '')}</div>
      `;
      container.appendChild(entry);
    });

    container.scrollTop = container.scrollHeight;
  }

  // ===== 文件树渲染 =====
  async renderFileTree() {
    const container = document.getElementById('fileTree');
    const tree = await this.fm.getFileTree();
    const files = await this.fm.listFiles();

    document.getElementById('fileCount').textContent = files.length;

    container.innerHTML = '';
    this._renderTreeNode(tree, container, '');
  }

  _renderTreeNode(node, parent, basePath) {
    if (node.type === 'dir') {
      // 目录
      const dirDiv = document.createElement('div');
      dirDiv.className = 'file-item dir';
      dirDiv.innerHTML = `<span class="icon"><svg><use href="#icon-folder"/></svg></span><span class="name">${node.name}</span>`;
      parent.appendChild(dirDiv);

      const childrenDiv = document.createElement('div');
      childrenDiv.className = 'file-children';
      parent.appendChild(childrenDiv);

      const sortedChildren = Object.values(node.children).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.path?.localeCompare(b.path) || 0;
      });

      sortedChildren.forEach(child => {
        this._renderTreeNode(child, childrenDiv, basePath);
      });
    } else {
      // 文件
      const fileDiv = document.createElement('div');
      fileDiv.className = 'file-item';
      const fileName = node.path.split('/').pop();
      const isInjected = ['CLAUDE.md', 'PROFILE.md', 'BODY_METRICS.md'].includes(fileName);
      const isInsight = node.path.startsWith('insights/');
      const isArchive = node.path.startsWith('archive/');
      const iconId = isInsight ? 'icon-chart' : isArchive ? 'icon-archive' : 'icon-file';
      fileDiv.innerHTML = `
        <span class="icon"><svg><use href="#${iconId}"/></svg></span>
        <span class="name">${fileName}</span>
        ${isInjected ? '<span class="badge">固定注入</span>' : ''}
        ${isInsight ? '<span class="badge insight">洞察</span>' : ''}
      `;
      fileDiv.addEventListener('click', () => this.openFileViewer(node.path));
      parent.appendChild(fileDiv);
    }
  }

  async openFileViewer(path) {
    const content = await this.fm.readFile(path);
    document.getElementById('viewerTitle').textContent = path;
    const viewer = document.getElementById('viewerContent');
    viewer.innerHTML = path.endsWith('.md')
      ? mdToHtml(content || '')
      : `<pre class="md-code">${escapeHtml(content || '(文件为空)')}</pre>`;
    document.getElementById('fileViewer').classList.add('show');
  }

  // ===== 记忆面板 =====
  async showMemory() {
    const overlay = document.getElementById('memoryOverlay');
    const tabsContainer = document.getElementById('memoryTabs');
    const contentContainer = document.getElementById('memoryContent');

    const files = await this.fm.listFiles();

    // 按类别分组，定义展示顺序和标签
    const groups = [
      { label: '我的档案', paths: ['PROFILE.md', 'BODY_METRICS.md'] },
      { label: 'AI 学到的习惯', paths: ['rules/learned-habits.md'] },
      { label: '过敏与忌口', paths: ['rules/allergies.md'] },
      { label: '饮食偏好', paths: ['rules/preferences.md'] },
      { label: '食物种类', paths: ['rules/food-types.md'] },
      { label: '运动情况', paths: ['rules/exercise.md'] },
      { label: 'AI 指令', paths: ['CLAUDE.md'] },
    ];

    // 动态添加饮食记录和对话摘要
    const dietFiles = files.filter(f => f.path.startsWith('diet/')).sort((a, b) => b.path.localeCompare(a.path));
    const chatFiles = files.filter(f => f.path.startsWith('chat/')).sort((a, b) => b.path.localeCompare(a.path));
    const insightFiles = files.filter(f => f.path.startsWith('insights/')).sort((a, b) => b.path.localeCompare(a.path));

    if (dietFiles.length > 0) groups.push({ label: '饮食记录', files: dietFiles });
    if (chatFiles.length > 0) groups.push({ label: '对话摘要', files: chatFiles });
    if (insightFiles.length > 0) groups.push({ label: '洞察报告', files: insightFiles });

    // 构建标签
    tabsContainer.innerHTML = '';
    groups.forEach((g, idx) => {
      const tab = document.createElement('button');
      tab.className = 'memory-tab' + (idx === 0 ? ' active' : '');
      tab.textContent = g.label;
      tab.addEventListener('click', async () => {
        tabsContainer.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        await this._renderMemoryGroup(g, contentContainer);
      });
      tabsContainer.appendChild(tab);
    });

    // 默认显示第一个
    if (groups.length > 0) {
      await this._renderMemoryGroup(groups[0], contentContainer);
    }

    overlay.classList.add('show');
  }

  async _renderMemoryGroup(group, container) {
    container.innerHTML = '';
    const allFiles = await this.fm.listFiles();

    const paths = group.files ? group.files.map(f => f.path) : group.paths;
    const existing = paths.filter(p => allFiles.some(f => f.path === p));

    if (existing.length === 0) {
      container.innerHTML = '<div class="memory-empty">还没有内容，多用几天就有了 🌱</div>';
      return;
    }

    // 判断是否为日期类文件（diet/ 或 chat/ 或 insights/）
    const isDateGroup = existing.every(p => /^(\w+\/\d{4}-\d{2}-\d{2}|insights\/)/.test(p));

    for (let i = 0; i < existing.length; i++) {
      const path = existing[i];
      const content = await this.fm.readFile(path);

      if (isDateGroup) {
        // 日期类：用卡片式时间线展示
        const card = document.createElement('div');
        card.className = 'memory-day-card';

        // 提取日期和类型作为标题
        const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})/);
        const dateLabel = dateMatch ? this._formatDateLabel(dateMatch[1]) : path;
        const typeLabel = path.startsWith('diet/') ? '饮食记录' 
                        : path.startsWith('chat/') ? '对话摘要'
                        : path.startsWith('insights/') ? '洞察报告' : '';

        // 星期
        let weekLabel = '';
        if (dateMatch) {
          const d = new Date(dateMatch[1] + 'T00:00:00');
          weekLabel = '星期' + ['日','一','二','三','四','五','六'][d.getDay()];
        }

        card.innerHTML = `
          <div class="memory-day-header">
            <span class="memory-day-date">${dateLabel}</span>
            ${weekLabel ? `<span class="memory-day-week">${weekLabel}</span>` : ''}
            ${typeLabel ? `<span class="memory-day-type">${typeLabel}</span>` : ''}
          </div>
          <div class="memory-day-body">${this.formatMarkdown(content || '(空文件)')}</div>
        `;
        container.appendChild(card);
      } else {
        // 非日期类：Markdown 渲染
        if (existing.length > 1) {
          const label = document.createElement('div');
          label.className = 'memory-section-label';
          label.textContent = path;
          container.appendChild(label);
        }
        const div = document.createElement('div');
        div.className = 'memory-md-content';
        div.innerHTML = this.formatMarkdown(content || '(空文件)');
        container.appendChild(div);
      }
    }
  }

  // 格式化日期标签：2026-07-05 → 7月5日
  _formatDateLabel(dateStr) {
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(m)}月${parseInt(d)}日`;
  }

  // ===== Auto Dream — 记忆压缩与洞察生成 =====
  async runAutoDream() {
    if (this.isProcessing) return;
    this.setProcessing(true);

    // 显示处理中消息
    this.addMessage('assistant', '**Auto Dream 启动中...**\n\n正在分析你的饮食记录和对话历史，生成洞察报告。');

    try {
      const result = await this.autoDream.run(this.chatManager.currentDate);

      // 生成结果报告
      let report = '**Auto Dream 完成！**\n\n';

      if (result.weeklyReport && result.weeklyReport.path) {
        report += `**周报已生成**\n- 文件: \`${result.weeklyReport.path}\`\n- 日期范围: ${result.weeklyReport.startDate} ~ ${result.weeklyReport.endDate}\n- 餐次: ${result.weeklyReport.mealCount}\n- 日均热量: ~${result.weeklyReport.avgCalories} kcal\n\n`;
      } else if (result.weeklyReport) {
        report += `周报: ${result.weeklyReport.message}\n\n`;
      }

      if (result.monthlyReport && result.monthlyReport.path) {
        report += `**月报已生成**\n- 文件: \`${result.monthlyReport.path}\`\n- 月份: ${result.monthlyReport.month}\n- 餐次: ${result.monthlyReport.mealCount}\n- 日均热量: ~${result.monthlyReport.avgCalories} kcal\n\n`;
      } else if (result.monthlyReport) {
        report += `月报: ${result.monthlyReport.message}\n\n`;
      }

      if (result.patterns && result.patterns.path) {
        report += `**模式分析已生成**\n- 文件: \`${result.patterns.path}\`\n- 发现模式: ${result.patterns.patternsFound} 个\n\n`;
        if (result.patterns.patterns.length > 0) {
          report += `**发现的模式**:\n`;
          for (const p of result.patterns.patterns.slice(0, 3)) {
            report += `- **${p.title}**: ${p.detail}\n`;
          }
          report += '\n';
        }
      } else if (result.patterns) {
        report += `模式分析: ${result.patterns.message}\n\n`;
      }

      report += `INDEX.md 已更新`;

      this.addMessage('assistant', report);
      this.chatManager.addAssistantMessage(report);

      // 更新文件树和上下文
      await this.renderFileTree();
      this.updateContextInfo();
    } catch (err) {
      this.addMessage('assistant', `Auto Dream 出错了：${err.message}`);
    }

    this.setProcessing(false);
  }

  // ===== 重建 INDEX.md =====
  async rebuildIndex() {
    if (this.isProcessing) return;

    try {
      const result = await this.indexManager.rebuildIndex();
      this.onDemandLoader?.invalidateIndexCache();
      this.addMessage('assistant', `**INDEX.md 已重建**\n\n- 总文件: ${result.totalFiles}\n- 饮食记录: ${result.dietCount}\n- 对话摘要: ${result.chatCount}\n- 洞察报告: ${result.insightsCount}\n- 行数: ${result.lineCount} / 200`);
      await this.renderFileTree();
    } catch (err) {
      this.addMessage('assistant', `重建索引出错：${err.message}`);
    }
  }

  // ===== 刷新习惯总结 =====
  async refreshHabits() {
    if (this.isProcessing) return;

    this.setProcessing(true);
    this.showProgress('正在刷新习惯总结', '读取近 21 天对话记录...');

    try {
      const result = await this.profileLearner.refreshHabits(21);

      if (result.success) {
        this.updateProgress(`已分析 ${result.daysAnalyzed} 天对话，正在生成习惯档案...`);
        this.addMessage('assistant', `**习惯档案已刷新**\n\n- 分析天数: ${result.daysAnalyzed} 天\n- ${result.summary}\n\nAI 已基于近 ${result.daysAnalyzed} 天的对话记录重新分析了你的生活习惯，包括饮食规律、运动模式、作息时间等。每个习惯条目都标注了出现频率和趋势变化。`);
        await this.renderFileTree();
        this.showToast('习惯档案已刷新', `基于近 ${result.daysAnalyzed} 天对话重新分析`, 'success');
      } else {
        this.addMessage('assistant', `**刷新失败**\n\n${result.summary}`);
        this.showToast('刷新失败', result.summary, 'error');
      }
    } catch (err) {
      this.addMessage('assistant', `刷新习惯总结出错：${err.message}`);
      this.showToast('刷新出错', err.message, 'error');
    }

    this.hideProgress();
    this.setProcessing(false);
  }

  // ===== 自动上下文压缩 =====
  async _autoCompact() {
    try {
      const result = await this.chatManager.compactHistory(this.llmService);

      if (result.compacted) {
        this.addMessage('system', `**上下文已自动压缩**\n\n- 压缩消息: ${result.oldMessageCount} → 1 条摘要\n- 保留最近: ${result.keptMessageCount} 条\n- 节省 Token: ~${result.savedTokens}\n- 压缩次数: #${result.compactCount}`);
      }
    } catch (err) {
      console.error('Auto compact failed:', err);
    }
  }

  // ===== 模拟次日 =====
  async advanceDay() {
    // 传入 profileLearner,在清空历史前学习当日对话
    await this.chatManager.advanceDay(this.profileLearner, this.llm);
    this.updateDateBadge();

    // 重建 INDEX.md（包含新的对话摘要）
    try {
      await this.indexManager.rebuildIndex();
      this.onDemandLoader?.invalidateIndexCache();
    } catch (e) {
      console.error('Index rebuild failed:', e);
    }

    // 清空聊天
    document.getElementById('chatMessages').innerHTML = '';

    // 清空工具日志
    document.getElementById('toolLog').innerHTML = '<div class="tool-log-empty">暂无工具调用</div>';

    await this.renderFileTree();
    this.updateContextInfo();

    // 显示跨天提示 + 学习结果 + 习惯打卡
    const learnResult = this.chatManager._lastLearnResult;
    let msg = `已经是新的一天了！当前日期：**${this.chatManager.currentDate}**\n\n`;

    // 生成习惯打卡问候(基于学习档案)
    let habitCheckin = null;
    try {
      habitCheckin = await this.profileLearner.generateHabitCheckin(this.chatManager.currentDate);
    } catch (e) {
      console.error('[HabitCheckin] 生成失败:', e.message);
    }

    if (learnResult && learnResult.learned) {
      msg += `🧠 ${learnResult.summary}\n\n`;
    }

    if (habitCheckin) {
      msg += `---\n\n${habitCheckin}`;
    } else {
      msg += `试试问我"昨天吃了什么"？`;
    }
    this.addMessage('assistant', msg);
  }

  // ===== 首次使用引导 =====
  async showOnboarding() {
    // 先显示一条欢迎引导消息
    this.addMessage('assistant', `你好呀！我是**轻伴**，你的 AI 减肥陪伴助手 🌿\n\n第一次见面，先让我了解一下你的基本情况，这样我才能给你更精准的建议。`);
    
    const profile = await this.showResetModal(true);
    if (!profile) {
      // 用户跳过引导 → 用默认档案，标记已引导
      await this.fm.markOnboarded();
      this.showWelcome();
      return;
    }
    await this.performOnboarding(profile);
  }

  async performOnboarding(profile) {
    // 不清空数据（首次使用时 loadDefaults 已加载默认文件）
    // 直接覆盖写入个性化的 PROFILE.md 和 BODY_METRICS.md

    // 计算 BMI 和基础代谢（Mifflin-St Jeor）
    const bmi = (profile.weight / Math.pow(profile.height / 100, 2)).toFixed(1);
    const bmr = profile.gender === '男'
      ? Math.round(10 * profile.weight + 6.25 * profile.height - 5 * profile.age + 5)
      : Math.round(10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 161);

    // 写入个性化 PROFILE.md
    const allergyLine = profile.allergy
      ? profile.allergy.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n')
      : '- 无';
    const dietLines = profile.diet
      ? profile.diet.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n')
      : '- 无特殊偏好';
    const exerciseLine = profile.exercise || '暂无规律运动';

    const profileMd = `---
updated: ${profile.startDate}
version: 1
---

# 用户档案

## 基础信息
- 昵称: ${profile.name || '（未填）'}
- 性别: ${profile.gender}
- 年龄: ${profile.age}
- 身高: ${profile.height}cm
- 初始体重: ${profile.weight}kg
- 目标体重: ${profile.goalWeight}kg
- 目标日期: ${profile.goalDate}

## 过敏与忌口
${allergyLine}

## 饮食偏好
${dietLines}

## 运动情况
- ${exerciseLine}`;

    await this.fm.writeFile('PROFILE.md', profileMd);

    // 写入个性化 BODY_METRICS.md
    const bodyMd = `---
updated: ${profile.startDate}
---

# 身体指标追踪

## 最新数据
- 日期: ${profile.startDate}
- 体重: ${profile.weight.toFixed(1)}kg
- BMI: ${bmi}
- 体脂率: 待测量
- 基础代谢: ~${bmr} kcal

## 体重趋势
| 日期 | 体重 | 变化 |
|------|------|------|
| ${profile.startDate.slice(5)} | ${profile.weight.toFixed(1)} | - |

## 阶段判断
初始记录日，尚未开始减重。目标：${profile.weight.toFixed(1)}kg → ${profile.goalWeight}kg（目标日期 ${profile.goalDate}）。`;

    await this.fm.writeFile('BODY_METRICS.md', bodyMd);

    // 标记已完成引导
    await this.fm.markOnboarded();

    // 清空对话历史和 UI
    this.chatManager.clearHistory();
    this.chatManager.currentDate = profile.startDate;
    this.updateDateBadge();

    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('toolLog').innerHTML = '<div class="tool-log-empty">暂无工具调用</div>';

    await this.renderFileTree();
    this.showPersonalizedWelcome(profile, bmi, bmr);
    this.updateContextInfo();
  }

  // ===== 重置数据（引导式：先收集基本信息再重置）=====
  async resetData() {
    const profile = await this.showResetModal();
    if (!profile) return; // 用户取消
    await this.performReset(profile);
  }

  // 弹出引导式信息收集模态框，返回 profile 或 null
  // isOnboarding=true 时为首次引导模式（标题和按钮文案不同）
  showResetModal(isOnboarding = false) {
    return new Promise(resolve => {
      // 移除已存在的模态框
      const old = document.getElementById('resetModal');
      if (old) old.remove();

      const today = this.chatManager._getToday();
      const goalDate = new Date();
      goalDate.setMonth(goalDate.getMonth() + 3);
      const defaultGoal = `${goalDate.getFullYear()}-${String(goalDate.getMonth() + 1).padStart(2, '0')}-${String(goalDate.getDate()).padStart(2, '0')}`;

      const title = isOnboarding ? '欢迎来到轻伴 · 建立你的档案' : '重新开始 · 建立你的档案';
      const subtitle = isOnboarding
        ? '填写基本信息，轻伴会为你建立专属档案，提供更精准的陪伴。'
        : '重置会清除所有记录。先填写基本信息，轻伴会为你建立专属档案。';
      const okText = isOnboarding ? '开始我的减肥之旅' : '重置并建立档案';
      const cancelText = isOnboarding ? '跳过（用默认档案）' : '取消';

      const modal = document.createElement('div');
      modal.id = 'resetModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
      modal.innerHTML = `
        <div style="background:var(--bg1);border:1px solid var(--border);border-radius:12px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
          <div style="margin-bottom:16px;">
            <div style="font-size:16px;font-weight:600;color:var(--text1);margin-bottom:4px;">${title}</div>
            <div style="font-size:12px;color:var(--text2);">${subtitle}</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <label style="grid-column:1/-1;font-size:12px;color:var(--text2);">昵称（可选）
              <input id="rm_name" type="text" placeholder="如：小明" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="font-size:12px;color:var(--text2);">性别
              <select id="rm_gender" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
                <option value="男">男</option>
                <option value="女">女</option>
              </select>
            </label>

            <label style="font-size:12px;color:var(--text2);">年龄
              <input id="rm_age" type="number" value="28" min="10" max="100" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="font-size:12px;color:var(--text2);">身高 (cm)
              <input id="rm_height" type="number" value="175" min="100" max="250" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="font-size:12px;color:var(--text2);">当前体重 (kg)
              <input id="rm_weight" type="number" value="82" step="0.1" min="30" max="300" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="font-size:12px;color:var(--text2);">目标体重 (kg)
              <input id="rm_goalWeight" type="number" value="72" step="0.1" min="30" max="300" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="font-size:12px;color:var(--text2);">目标日期
              <input id="rm_goalDate" type="date" value="${defaultGoal}" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="grid-column:1/-1;font-size:12px;color:var(--text2);">过敏与忌口（可选，逗号分隔）
              <input id="rm_allergy" type="text" placeholder="如：花生，不吃内脏" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="grid-column:1/-1;font-size:12px;color:var(--text2);">饮食偏好（可选）
              <input id="rm_diet" type="text" placeholder="如：偏辣，喜欢湘菜，不喝含糖饮料" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>

            <label style="grid-column:1/-1;font-size:12px;color:var(--text2);">运动情况（可选）
              <input id="rm_exercise" type="text" placeholder="如：每周跑步3次，每次5km" style="width:100%;margin-top:4px;padding:8px;border:1px solid var(--border);border-radius:6px;background:var(--bg2);color:var(--text1);font-size:13px;box-sizing:border-box;">
            </label>
          </div>

          <div style="display:flex;gap:8px;margin-top:20px;">
            <button id="rm_cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text2);font-size:13px;cursor:pointer;">${cancelText}</button>
            <button id="rm_ok" style="flex:1;padding:10px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-size:13px;cursor:pointer;font-weight:500;">${okText}</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const close = (val) => { modal.remove(); resolve(val); };

      modal.querySelector('#rm_cancel').onclick = () => close(null);
      modal.onclick = (e) => { if (e.target === modal) close(null); };

      modal.querySelector('#rm_ok').onclick = () => {
        const profile = {
          name: modal.querySelector('#rm_name').value.trim(),
          gender: modal.querySelector('#rm_gender').value,
          age: parseInt(modal.querySelector('#rm_age').value) || 28,
          height: parseFloat(modal.querySelector('#rm_height').value) || 175,
          weight: parseFloat(modal.querySelector('#rm_weight').value) || 82,
          goalWeight: parseFloat(modal.querySelector('#rm_goalWeight').value) || 72,
          goalDate: modal.querySelector('#rm_goalDate').value || defaultGoal,
          allergy: modal.querySelector('#rm_allergy').value.trim(),
          diet: modal.querySelector('#rm_diet').value.trim(),
          exercise: modal.querySelector('#rm_exercise').value.trim(),
          startDate: today
        };
        close(profile);
      };
    });
  }

  // 实际执行重置：清空 → 写入个性化档案 → 清历史 → 欢迎语
  async performReset(profile) {
    await this.fm.clearAll();

    // 计算 BMI 和基础代谢（Mifflin-St Jeor）
    const bmi = (profile.weight / Math.pow(profile.height / 100, 2)).toFixed(1);
    const bmr = profile.gender === '男'
      ? Math.round(10 * profile.weight + 6.25 * profile.height - 5 * profile.age + 5)
      : Math.round(10 * profile.weight + 6.25 * profile.height - 5 * profile.age - 161);

    // 写入个性化 PROFILE.md
    const allergyLine = profile.allergy
      ? profile.allergy.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n')
      : '- 无';
    const dietLines = profile.diet
      ? profile.diet.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(s => `- ${s}`).join('\n')
      : '- 无特殊偏好';
    const exerciseLine = profile.exercise || '暂无规律运动';

    const profileMd = `---
updated: ${profile.startDate}
version: 1
---

# 用户档案

## 基础信息
- 昵称: ${profile.name || '（未填）'}
- 性别: ${profile.gender}
- 年龄: ${profile.age}
- 身高: ${profile.height}cm
- 初始体重: ${profile.weight}kg
- 目标体重: ${profile.goalWeight}kg
- 目标日期: ${profile.goalDate}

## 过敏与忌口
${allergyLine}

## 饮食偏好
${dietLines}

## 运动情况
- ${exerciseLine}`;

    await this.fm.writeFile('PROFILE.md', profileMd);

    // 写入个性化 BODY_METRICS.md
    const bodyMd = `---
updated: ${profile.startDate}
---

# 身体指标追踪

## 最新数据
- 日期: ${profile.startDate}
- 体重: ${profile.weight.toFixed(1)}kg
- BMI: ${bmi}
- 体脂率: 待测量
- 基础代谢: ~${bmr} kcal

## 体重趋势
| 日期 | 体重 | 变化 |
|------|------|------|
| ${profile.startDate.slice(5)} | ${profile.weight.toFixed(1)} | - |

## 阶段判断
初始记录日，尚未开始减重。目标：${profile.weight.toFixed(1)}kg → ${profile.goalWeight}kg（目标日期 ${profile.goalDate}）。`;

    await this.fm.writeFile('BODY_METRICS.md', bodyMd);

    // 加载其余默认文件（CLAUDE.md, rules/, etc.）— 但跳过已写入的两个
    await this.fm.loadDefaults();
    // loadDefaults 会因已有文件而跳过，需确保 PROFILE/BODY_METRICS 用我们的版本
    await this.fm.writeFile('PROFILE.md', profileMd);
    await this.fm.writeFile('BODY_METRICS.md', bodyMd);

    // 清空对话与 UI
    this.chatManager.clearHistory();
    this.chatManager.currentDate = profile.startDate;
    this.updateDateBadge();

    document.getElementById('chatMessages').innerHTML = '';
    document.getElementById('toolLog').innerHTML = '<div class="tool-log-empty">暂无工具调用</div>';

    await this.renderFileTree();
    this.showPersonalizedWelcome(profile, bmi, bmr);
    this.updateContextInfo();
  }

  // 个性化欢迎语
  showPersonalizedWelcome(p, bmi, bmr) {
    const container = document.getElementById('chatMessages');
    const empty = container.querySelector('.empty-chat');
    if (empty) empty.remove();
    if (container.children.length > 0) return;

    const namePart = p.name ? `**${p.name}**` : '你好';
    const diff = (p.weight - p.goalWeight).toFixed(1);
    const welcome = `${namePart}，我是**轻伴**，你的 AI 减肥陪伴助手 🌿

我已经为你建立了专属档案：
- 当前 **${p.weight}kg** → 目标 **${p.goalWeight}kg**（需减重 ${diff}kg）
- BMI **${bmi}** · 基础代谢约 **${bmr} kcal**
- 目标日期：${p.goalDate}

你可以试试：
- 点击下方彩色按钮**模拟拍照**记录饮食
- 输入"今天 **${p.weight}kg**"确认初始体重
- 问我"**能吃什么**"或查某种食物是否安全
- 之后输入"**昨天吃了什么**"来回忆记录

所有数据都以 MD 文件存储在本地，左侧文件树可查看。一起加油吧！`;
    this.addMessage('assistant', welcome);
  }

  // ===== 上下文信息 =====
  updateContextInfo() {
    const info = this.chatManager.getContextInfo();
    const grid = document.getElementById('contextGrid');

    grid.innerHTML = `
      <div class="context-item">
        <span class="label">日期</span>
        <span class="value">${info.currentDate}</span>
      </div>
      <div class="context-item">
        <span class="label">消息数</span>
        <span class="value">${info.messageCount}</span>
      </div>
      <div class="context-item">
        <span class="label">用户消息</span>
        <span class="value">${info.userMsgCount}</span>
      </div>
      <div class="context-item">
        <span class="label">AI回复</span>
        <span class="value">${info.assistantMsgCount}</span>
      </div>
      <div class="context-item" style="grid-column:1/-1;">
        <span class="label">估算 Token</span>
        <span class="value">~${info.estimatedTokens}</span>
      </div>
      <div class="context-item" style="grid-column:1/-1;">
        <span class="label">上下文策略</span>
        <span class="value">同日完整保留 · 跨天自动归档</span>
      </div>
    `;
  }

  updateDateBadge() {
    document.getElementById('dateBadge').textContent = this.chatManager.currentDate;
    // 更新菜单中的版本号显示
    const mv = document.getElementById('menuVersion');
    if (mv) mv.textContent = `v${APP_VERSION}`;
  }

  // ===== 日历功能 =====

  _calendarMonth = new Date(); // 当前查看的月份

  async showCalendar() {
    this._calendarMonth = new Date();
    document.getElementById('calendarOverlay').style.display = 'flex';
    await this._renderCalendar();
  }

  async _calendarNav(delta) {
    this._calendarMonth.setMonth(this._calendarMonth.getMonth() + delta);
    await this._renderCalendar();
  }

  async _renderCalendar() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const viewDate = this._calendarMonth;
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    document.getElementById('calMonthLabel').textContent = `${year}年 ${monthNames[month]}`;

    // 获取该月所有文件
    const allFiles = await this.fm.listFiles();
    const fileDates = {}; // { '2026-07-14': { chat: true, diet: true } }
    for (const f of allFiles) {
      const fp = f.path || f;
      const m = fp.match(/^(?:chat|diet)\/(\d{4}-\d{2}-\d{2})\.md$/);
      if (m) {
        const d = m[1];
        if (!fileDates[d]) fileDates[d] = { chat: false, diet: false };
        if (fp.startsWith('chat/')) fileDates[d].chat = true;
        if (fp.startsWith('diet/')) fileDates[d].diet = true;
      }
    }

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    // 星期标题
    ['日','一','二','三','四','五','六'].forEach(d => {
      const head = document.createElement('div');
      head.className = 'cal-head';
      head.textContent = d;
      grid.appendChild(head);
    });

    // 计算第一天是星期几
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // 填充空白
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      grid.appendChild(empty);
    }

    // 填充日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cell = document.createElement('div');
      cell.className = 'cal-day';
      cell.textContent = d;

      const data = fileDates[dateStr];
      if (data) {
        cell.classList.add('has-data');
        if (data.chat && data.diet) {
          cell.innerHTML += '<span class="cal-dot both"></span>';
        } else if (data.chat) {
          cell.innerHTML += '<span class="cal-dot chat"></span>';
        } else if (data.diet) {
          cell.innerHTML += '<span class="cal-dot diet"></span>';
        }
        cell.addEventListener('click', () => this._showDayHistory(dateStr));
      }

      if (dateStr === todayStr) {
        cell.classList.add('today');
      }

      grid.appendChild(cell);
    }
  }

  async _showDayHistory(dateStr) {
    document.getElementById('calendarOverlay').style.display = 'none';
    document.getElementById('historyOverlay').style.display = 'flex';
    document.getElementById('historyTitle').textContent = `${dateStr} 历史记录`;
    document.getElementById('historyContent').innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;">加载中...</div>';

    const chatFile = await this.fm.readFile(`chat/${dateStr}.md`);
    const dietFile = await this.fm.readFile(`diet/${dateStr}.md`);

    let html = '';

    if (dietFile) {
      html += `<div style="margin-bottom:12px;">
        <div style="font-size:12px;color:var(--accent);margin-bottom:4px;">饮食记录</div>
        <div style="background:var(--bg3);border-radius:8px;padding:10px;font-size:13px;white-space:pre-wrap;line-height:1.6;">${this.formatMarkdown(dietFile)}</div>
      </div>`;
    }

    if (chatFile) {
      html += `<div style="margin-bottom:12px;">
        <div style="font-size:12px;color:var(--accent);margin-bottom:4px;">对话摘要</div>
        <div style="background:var(--bg3);border-radius:8px;padding:10px;font-size:13px;line-height:1.6;">${this.formatMarkdown(chatFile)}</div>
      </div>`;
    }

    if (!html) {
      html = '<div style="text-align:center;color:var(--muted);padding:20px;">该日期没有历史记录</div>';
    }

    document.getElementById('historyContent').innerHTML = html;
  }

  // 显示更新日志
  showChangelog() {
    const html = CHANGELOG.map(entry => `
      <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-weight:700;color:var(--accent);">v${entry.ver}</span>
          <span style="font-size:11px;color:var(--muted);font-family:var(--mono);">${entry.date}</span>
        </div>
        <ul style="margin:0;padding-left:18px;color:var(--muted);">
          ${entry.items.map(item => `<li style="margin-bottom:3px;">${item}</li>`).join('')}
        </ul>
      </div>
    `).join('');

    document.getElementById('changelogContent').innerHTML = html;
    document.getElementById('changelogOverlay').style.display = 'flex';
  }

  // ===== 查看上下文 =====

  async showContext() {
    document.getElementById('contextOverlay').style.display = 'flex';
    document.getElementById('contextContent').innerHTML = '<div style="text-align:center;color:var(--muted);padding:20px;">加载中...</div>';

    try {
      // 构建系统提示词（与实际发送的一致）
      const systemPrompt = await this.llmService.buildSystemPrompt({
        currentDate: this.chatManager.currentDate
      });

      // 获取对话历史
      const history = this.chatManager.getHistory();

      // 获取工具定义
      const tools = this.llmService.getToolDefinitions();

      // 组装完整上下文预览
      let html = '';

      // 1. 系统提示词
      html += `<div style="margin-bottom:16px;">`;
      html += `<div style="font-size:13px;color:var(--accent);font-weight:700;margin-bottom:6px;">📋 系统提示词 (system) — ${systemPrompt.length} 字</div>`;
      html += `<div style="background:var(--bg3);border-radius:8px;padding:10px;max-height:300px;overflow-y:auto;border:1px solid var(--rule);">${this.formatMarkdown(systemPrompt)}</div>`;
      html += `</div>`;

      // 2. 对话历史
      html += `<div style="margin-bottom:16px;">`;
      html += `<div style="font-size:13px;color:var(--accent);font-weight:700;margin-bottom:6px;">💬 对话历史 (${history.length} 条)</div>`;
      if (history.length === 0) {
        html += `<div style="color:var(--muted);padding:8px;font-size:12px;">（当天暂无对话历史）</div>`;
      } else {
        history.forEach((msg, i) => {
          const role = msg.role === 'user' ? '👤 user' : '🤖 assistant';
          let content = msg.content;
          if (Array.isArray(content)) {
            content = content.map(c => c.type === 'text' ? c.text : `[图片]`).join(' + ');
          }
          html += `<div style="background:var(--bg3);border-radius:6px;padding:8px 10px;margin-bottom:4px;font-size:11px;border-left:3px solid ${msg.role === 'user' ? 'var(--accent)' : 'var(--rule)'};">`;
          html += `<div style="color:var(--muted2);margin-bottom:2px;">${role}</div>`;
          html += `<div style="color:var(--text);white-space:pre-wrap;">${this._escapeHtml(String(content).substring(0, 500))}${content.length > 500 ? '...' : ''}</div>`;
          html += `</div>`;
        });
      }
      html += `</div>`;

      // 3. 工具定义
      html += `<div style="margin-bottom:16px;">`;
      html += `<div style="font-size:13px;color:var(--accent);font-weight:700;margin-bottom:6px;">🔧 工具定义 (${tools.length} 个)</div>`;
      tools.forEach(tool => {
        const fn = tool.function;
        html += `<div style="background:var(--bg3);border-radius:6px;padding:8px 10px;margin-bottom:4px;font-size:11px;">`;
        html += `<div style="color:var(--text);font-weight:600;">${fn.name}</div>`;
        html += `<div style="color:var(--muted);margin-top:2px;">${fn.description || ''}</div>`;
        html += `</div>`;
      });
      html += `</div>`;

      // 4. 统计摘要
      const historyChars = history.reduce((sum, m) => {
        const c = Array.isArray(m.content) ? JSON.stringify(m.content) : m.content;
        return sum + String(c || '').length;
      }, 0);
      const totalChars = systemPrompt.length + historyChars;
      const estTokens = Math.round(totalChars / 1.5);

      html += `<div style="background:var(--bg2);border-radius:8px;padding:10px;font-size:12px;border:1px solid var(--rule);">`;
      html += `<div style="color:var(--accent);font-weight:700;margin-bottom:6px;">📊 统计</div>`;
      html += `<div style="color:var(--muted);">系统提示词: <span style="color:var(--text);">${systemPrompt.length} 字</span></div>`;
      html += `<div style="color:var(--muted);">对话历史: <span style="color:var(--text);">${historyChars} 字 (${history.length} 条)</span></div>`;
      html += `<div style="color:var(--muted);">工具定义: <span style="color:var(--text);">${tools.length} 个</span></div>`;
      html += `<div style="color:var(--muted);margin-top:4px;border-top:1px solid var(--rule);padding-top:4px;">预估总 Token: <span style="color:var(--accent);font-weight:700;">~${estTokens}</span></div>`;
      html += `</div>`;

      document.getElementById('contextContent').innerHTML = html;
    } catch (e) {
      document.getElementById('contextContent').innerHTML = `<div style="color:var(--danger);padding:20px;">加载失败: ${e.message}</div>`;
      console.error('[查看上下文] 失败:', e);
    }
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== 模型设置 =====

  showSettings() {
    const s = window.QINGBAN_SETTINGS || {};
    document.getElementById('setVisionModel').value = s.visionModel || 'k3';
    document.getElementById('setChatModel').value = s.chatModel || 'k3';
    document.getElementById('setSummaryModel').value = s.summaryModel || 'k3';
    document.getElementById('setTemperature').value = s.temperature ?? 0.7;
    document.getElementById('setTemperatureVal').textContent = parseFloat(s.temperature ?? 0.7).toFixed(1);
    document.getElementById('setMaxToolRounds').value = s.maxToolRounds || 5;
    document.getElementById('setMaxOutputTokens').value = s.maxOutputTokens || 32768;
    document.getElementById('setEffortLevel').value = s.effortLevel || 'max';
    document.getElementById('setHistoryDays').value = s.historyDays ?? 7;
    document.getElementById('setFileTruncate').value = s.fileTruncate || 800;
    document.getElementById('setApiFormat').value = s.apiFormat || '';
    document.getElementById('setApiBaseURL').value = s.apiBaseURL || '';
    document.getElementById('setApiKey').value = s.apiKey || '';
    document.getElementById('setRequestTimeout').value = s.requestTimeout || 120;
    document.getElementById('setRetryCount').value = s.retryCount ?? 30;
    document.getElementById('setCustomHeaders').value = s.customHeaders || '';
    document.getElementById('setMaxContextTokens').value = s.maxContextTokens || 1048576;
    document.getElementById('settingsOverlay').style.display = 'flex';
  }

  _saveSettings() {
    const old = window.QINGBAN_SETTINGS || {};
    const settings = {
      visionModel: document.getElementById('setVisionModel').value.trim() || 'k3',
      chatModel: document.getElementById('setChatModel').value.trim() || 'k3',
      summaryModel: document.getElementById('setSummaryModel').value.trim() || 'k3',
      temperature: parseFloat(document.getElementById('setTemperature').value),
      maxToolRounds: parseInt(document.getElementById('setMaxToolRounds').value) || 5,
      maxOutputTokens: parseInt(document.getElementById('setMaxOutputTokens').value) || 32768,
      effortLevel: document.getElementById('setEffortLevel').value || 'max',
      historyDays: parseInt(document.getElementById('setHistoryDays').value) ?? 7,
      fileTruncate: parseInt(document.getElementById('setFileTruncate').value) || 800,
      apiFormat: document.getElementById('setApiFormat').value || '',
      apiBaseURL: document.getElementById('setApiBaseURL').value.trim(),
      apiKey: document.getElementById('setApiKey').value.trim(),
      requestTimeout: parseInt(document.getElementById('setRequestTimeout').value) || 120,
      retryCount: parseInt(document.getElementById('setRetryCount').value) ?? 30,
      customHeaders: document.getElementById('setCustomHeaders').value.trim(),
      maxContextTokens: parseInt(document.getElementById('setMaxContextTokens').value) || 1048576,
      onDemandLoad: old.onDemandLoad ?? true,
      onDemandTokenBudget: old.onDemandTokenBudget || 2000,
      reminders: old.reminders || undefined,
      settlement: old.settlement || undefined
    };

    // 限制范围
    settings.temperature = Math.max(0, Math.min(1, settings.temperature));
    settings.maxToolRounds = Math.max(1, Math.min(20, settings.maxToolRounds));
    settings.maxOutputTokens = Math.max(1024, Math.min(32768, settings.maxOutputTokens));
    settings.historyDays = Math.max(0, Math.min(30, settings.historyDays));
    settings.fileTruncate = Math.max(100, Math.min(5000, settings.fileTruncate));
    settings.requestTimeout = Math.max(10, Math.min(600, settings.requestTimeout));
    settings.retryCount = Math.max(0, Math.min(100, settings.retryCount));
    settings.maxContextTokens = Math.max(4096, Math.min(1048576, settings.maxContextTokens));

    window.QINGBAN_SETTINGS = settings;
    saveSettings(settings);

    // 应用到 LLMService
    if (this.llm) {
      this.llm.maxToolRounds = settings.maxToolRounds;
    }

    document.getElementById('settingsOverlay').style.display = 'none';
    const connInfo = (settings.apiBaseURL || settings.apiKey) ? `\n- 连接: ${settings.apiBaseURL || '默认地址'} (${settings.apiFormat || '默认格式'})` : '';
    this.addMessage('assistant', `设置已保存并生效 ✓\n\n- 视觉模型: \`${settings.visionModel}\`\n- 对话模型: \`${settings.chatModel}\`\n- 摘要模型: \`${settings.summaryModel}\`\n- 温度: ${settings.temperature}\n- 工具轮数: ${settings.maxToolRounds}\n- 输出上限: ${settings.maxOutputTokens} tokens\n- 上下文窗口: ${settings.maxContextTokens} tokens\n- 推理强度: ${settings.effortLevel}\n- 历史天数: ${settings.historyDays}\n- 截断字数: ${settings.fileTruncate}\n- 超时: ${settings.requestTimeout}s / 重试: ${settings.retryCount} 次${connInfo}`);
  }

  _resetSettings() {
    if (!confirm('确定恢复所有设置到默认值吗？')) return;
    localStorage.removeItem('qingban_settings');
    window.QINGBAN_SETTINGS = loadSettings();
    this.showSettings(); // 重新加载显示
  }

  // 应用 Kimi K3 全量预配置
  _applyPresetK3() {
    // 环境自适应：APK 走内置默认（Coding Plan 直连）；浏览器/PWA 必须
    // 直连 Kimi 开放平台 — Coding Plan 地址（api.kimi.com/coding）浏览器 CORS
    // 不通，静态托管的 PWA 也没有本地代理可回退
    const isNative = this._isNativeEnv();
    const model = isNative ? 'k3' : 'kimi-k3';
    const baseURL = isNative ? '' : 'https://api.moonshot.cn';
    const apiFormat = isNative ? '' : 'openai';
    // 填充 UI
    document.getElementById('setVisionModel').value = model;
    document.getElementById('setChatModel').value = model;
    document.getElementById('setSummaryModel').value = model;
    document.getElementById('setTemperature').value = 0.7;
    document.getElementById('setTemperatureVal').textContent = '0.7';
    document.getElementById('setMaxToolRounds').value = 5;
    document.getElementById('setMaxOutputTokens').value = 32768;
    document.getElementById('setEffortLevel').value = 'max';
    document.getElementById('setHistoryDays').value = 7;
    document.getElementById('setFileTruncate').value = 800;
    document.getElementById('setApiFormat').value = apiFormat;
    document.getElementById('setApiBaseURL').value = baseURL;
    document.getElementById('setApiKey').value = '';
    document.getElementById('setRequestTimeout').value = 120;
    document.getElementById('setRetryCount').value = 30;
    document.getElementById('setCustomHeaders').value = '';
    document.getElementById('setMaxContextTokens').value = 1048576;

    // 直接保存
    const old = window.QINGBAN_SETTINGS || {};
    const settings = {
      visionModel: model,
      chatModel: model,
      summaryModel: model,
      temperature: 0.7,
      maxToolRounds: 5,
      maxOutputTokens: 32768,
      maxContextTokens: 1048576,
      effortLevel: 'max',
      historyDays: 7,
      fileTruncate: 800,
      apiFormat: apiFormat,
      apiBaseURL: baseURL,
      apiKey: '',
      requestTimeout: 120,
      retryCount: 30,
      customHeaders: '',
      onDemandLoad: old.onDemandLoad ?? true,
      onDemandTokenBudget: old.onDemandTokenBudget || 2000,
      reminders: old.reminders || undefined,
      settlement: old.settlement || undefined
    };

    window.QINGBAN_SETTINGS = settings;
    saveSettings(settings);

    if (this.llm) {
      this.llm.maxToolRounds = settings.maxToolRounds;
    }

    document.getElementById('settingsOverlay').style.display = 'none';
    const connNote = isNative
      ? '连接配置已重置为默认（Coding Plan 直连）'
      : `网页直连: \`${baseURL}\`（openai 格式）— 请在「连接配置」填入你的 Kimi 开放平台 API Key 后即可使用`;
    this.addMessage('assistant', `已应用 Kimi K3 全量预配置 ✓\n\n- 视觉/对话/摘要模型: \`${model}\`\n- 上下文窗口: 1M tokens\n- 输出上限: 32768 tokens\n- 推理强度: max\n- 温度: 0.7\n- 工具轮数: 5\n- 历史天数: 7\n- 截断字数: 800\n- ${connNote}`);
  }

  // ===== Ask User 底部弹窗 =====

  // 注册 ask_user 工具回调到 LLMService
  _registerAskUserCallback() {
    this.llmService.onAskUser = async (question, options, allowCustom) => {
      return this._showAskUser(question, options, allowCustom);
    };
  }

  // 注册 send_notification 工具回调到 LLMService
  _registerNotificationCallback() {
    this.llmService.onSendNotification = async (title, message, delayMinutes, type) => {
      const result = await this.notificationManager.schedule({ title, message, delayMinutes, type });
      return result;
    };

    // 通知触发时的 UI 回调
    this.notificationManager.onFire = (notif) => {
      this._showNotificationBanner(notif);
    };

    // 系统通知点击路由：按提醒类型拉起对应面板（一次性 AI 通知默认回到聊天页）
    this.notificationManager.onNotificationTap = (extra) => {
      const key = extra?.reminderKey || '';
      if (key === 'habitNoon' || key === 'habitEvening' || extra?.type === 'habit') {
        this.showHabitPanel();
      } else if (key === 'evening') {
        this._openTrendPanel();
      }
      // morning / 其他 → 聊天页（App 默认视图），无额外路由
    };

    // record_metrics 结构化双写回调（阶段四 · 4.4）
    this.llmService.onRecordMetrics = async (args) => {
      const today = this.chatManager.getEffectiveToday();
      return this.statsManager.recordMetrics(args || {}, today);
    };
  }

  // ===== 习惯打卡 =====

  // 注册习惯打卡工具回调到 LLMService
  _registerHabitCallbacks() {
    // checkin_habit — 对话中打卡
    this.llmService.onCheckinHabit = async (habitName, amount, note) => {
      const habits = await this.habitManager.getHabits();
      // 三级匹配：精确 → 包含 → 模糊
      let habit = habits.find(h => h.name === habitName);
      if (!habit) habit = habits.find(h => h.name.includes(habitName) || habitName.includes(h.name));
      if (!habit) {
        return { success: false, message: `未找到习惯"${habitName}"，当前习惯列表：${habits.map(h => h.name).join('、') || '（无）'}` };
      }
      await this.habitManager.checkin(habit.id, amount, note);
      const progress = await this.habitManager.getTodayProgress(habit.id);
      this._refreshHabitPanelIfOpen();
      return {
        success: true,
        habit: habit.name,
        amount,
        todayTotal: progress.amount,
        goal: progress.goal,
        unit: habit.unit,
        percentage: progress.percentage,
        completed: progress.isCompleted,
        message: progress.isCompleted
          ? `${habit.name}今日已达标！累计 ${progress.amount}${habit.unit}（目标${progress.goal}${habit.unit}）`
          : `${habit.name}今日已打卡 ${progress.amount}/${progress.goal}${habit.unit}（${progress.percentage}%）`
      };
    };

    // get_habit_status — 查询打卡状态
    this.llmService.onGetHabitStatus = async (date) => {
      const habits = await this.habitManager.getHabits();
      const results = [];
      for (const habit of habits) {
        const progress = await this.habitManager.getTodayProgress(habit.id);
        const stats = await this.habitManager.getHabitStats(habit.id);
        results.push({
          name: habit.name,
          icon: habit.icon,
          todayAmount: progress.amount,
          goal: progress.goal,
          unit: habit.unit,
          percentage: progress.percentage,
          completed: progress.isCompleted,
          streak: stats.currentStreak
        });
      }
      return { date: date || this.habitManager._getToday(), habits: results };
    };

    // suggest_habit — AI 推荐习惯
    this.llmService.onSuggestHabit = async () => {
      const suggestions = await this.habitManager.suggestHabitsFromProfile(this.llm);
      return { suggestions };
    };

    // add_habit — 添加自定义习惯
    this.llmService.onAddHabit = async (name, unit, dailyGoal, icon) => {
      const habit = await this.habitManager.addHabit({
        name, unit, dailyGoal, icon: icon || '✅',
        category: 'custom', source: 'user_custom'
      });
      this._refreshHabitPanelIfOpen();
      return { success: true, habit: { id: habit.id, name: habit.name, goal: habit.dailyGoal, unit: habit.unit } };
    };

    // HabitManager 数据变化回调
    this.habitManager.onChangeCallback = () => {
      this._refreshHabitPanelIfOpen();
    };
  }

  // 启动未完成习惯提醒检查
  _startHabitReminderCheck() {
    this._habitReminderInterval = setInterval(() => this._checkUncompletedHabits(), 2 * 60 * 60 * 1000);
    setTimeout(() => this._checkUncompletedHabits(), 5 * 60 * 1000);
  }

  async _checkUncompletedHabits() {
    // 仅前台弹具体习惯名的横幅（后台提醒已由系统级定点通知承担，避免重复打扰）
    if (typeof document !== 'undefined' && document.hidden) return;
    const now = new Date();
    const hour = now.getHours();
    if (NotificationManager.isQuietHours(hour)) return;

    const today = this.habitManager._getToday();
    let reminderLog;
    try {
      const raw = await this.fm.readFile('.meta/habit-reminders.json');
      reminderLog = raw ? JSON.parse(raw) : {};
    } catch { reminderLog = {}; }

    const slot = hour < 12 ? 'morning' : 'afternoon';
    if (reminderLog[today]?.includes(slot)) return;

    const habits = await this.habitManager.getHabits();
    const uncompleted = [];
    for (const habit of habits) {
      if (!habit.reminderEnabled) continue;
      const progress = await this.habitManager.getTodayProgress(habit.id);
      if (!progress.isCompleted) uncompleted.push(habit);
    }

    if (uncompleted.length > 0) {
      const names = uncompleted.map(h => `${h.icon} ${h.name}`).join('、');
      await this.notificationManager.schedule({
        title: '打卡提醒',
        message: `今天还有 ${uncompleted.length} 个习惯未完成：${names}`,
        delayMinutes: 0,
        type: 'custom'
      });
      reminderLog[today] = reminderLog[today] || [];
      reminderLog[today].push(slot);
      await this.fm.writeFile('.meta/habit-reminders.json', JSON.stringify(reminderLog));
    }
  }

  // 显示打卡面板
  async showHabitPanel() {
    this._habitViewDate = null; // null = 今天
    document.getElementById('habitOverlay').style.display = 'flex';
    await this._renderHabitPanel();
  }

  // 日期导航
  async _habitNavDay(delta) {
    if (this._habitViewDate === null) {
      this._habitViewDate = this.habitManager._getToday();
    }
    this._habitViewDate = this.habitManager._addDays(this._habitViewDate, delta);
    // 不允许导航到未来
    const today = this.habitManager._getToday();
    if (this._habitViewDate > today) {
      this._habitViewDate = today;
    }
    await this._renderHabitPanel();
  }

  // 渲染打卡面板
  async _renderHabitPanel() {
    const viewDate = this._habitViewDate || this.habitManager._getToday();
    const today = this.habitManager._getToday();
    const isToday = viewDate === today;

    document.getElementById('habitDateLabel').textContent = isToday ? '今天' : viewDate;

    const habits = await this.habitManager.getHabits();
    const cardsContainer = document.getElementById('habitCards');
    const emptyEl = document.getElementById('habitEmpty');
    const suggestArea = document.getElementById('habitSuggestArea');

    if (habits.length === 0) {
      cardsContainer.innerHTML = '';
      emptyEl.style.display = 'block';
      suggestArea.style.display = 'none';
      return;
    }

    emptyEl.style.display = 'none';

    // 渲染习惯卡片
    const cardsHtml = [];
    let completedCount = 0;

    for (const habit of habits) {
      const checkins = await this.habitManager.getCheckinsByHabit(habit.id, viewDate, viewDate);
      const amount = checkins.reduce((sum, c) => sum + c.amount, 0);
      const percentage = habit.dailyGoal > 0 ? Math.min(100, Math.round((amount / habit.dailyGoal) * 100)) : 0;
      const isCompleted = amount >= habit.dailyGoal;
      if (isCompleted) completedCount++;

      const streak = await this.habitManager.calculateStreak(habit.id);
      const streakHtml = streak > 0 ? `<span class="habit-card-streak">🔥 ${streak}天</span>` : '';

      // 快速打卡按钮（仅今天显示）
      let actionsHtml = '';
      if (isToday) {
        const quickAmounts = this._getQuickAmounts(habit);
        actionsHtml = `<div class="habit-card-actions">
          ${quickAmounts.map(a => `<button class="habit-quick-checkin" data-habit-id="${habit.id}" data-amount="${a}">+${a}${habit.unit}</button>`).join('')}
          <button class="habit-quick-checkin" data-habit-id="${habit.id}" data-custom="1">自定义</button>
        </div>`;
      }

      const completedHtml = isCompleted ? `<div class="habit-card-completed">✓ 今日已达标</div>` : '';

      cardsHtml.push(`
        <div class="habit-card ${isCompleted ? 'completed' : ''}" data-habit-id="${habit.id}">
          <div class="habit-card-header">
            <span class="habit-card-icon">${habit.icon}</span>
            <span class="habit-card-name">${habit.name}</span>
            ${streakHtml}
            <button class="habit-card-delete" data-habit-id="${habit.id}" title="删除">×</button>
          </div>
          <div class="habit-card-progress">
            <div class="habit-progress-bar">
              <div class="habit-progress-fill" style="width: ${percentage}%"></div>
            </div>
            <span class="habit-progress-text">${amount} / ${habit.dailyGoal} ${habit.unit} (${percentage}%)</span>
          </div>
          ${actionsHtml}
          ${completedHtml}
        </div>
      `);
    }

    cardsContainer.innerHTML = cardsHtml.join('');
    document.getElementById('habitSummary').textContent = `${completedCount}/${habits.length} 已完成`;

    // 绑定快速打卡按钮
    cardsContainer.querySelectorAll('.habit-quick-checkin').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const habitId = e.target.dataset.habitId;
        if (e.target.dataset.custom) {
          this._showCustomCheckin(habitId);
        } else {
          const amount = parseFloat(e.target.dataset.amount);
          await this.habitManager.checkin(habitId, amount);
          await this._renderHabitPanel();
        }
      });
    });

    // 绑定删除按钮
    cardsContainer.querySelectorAll('.habit-card-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const habitId = e.target.dataset.habitId;
        if (confirm('确定要删除这个习惯吗？历史打卡数据会保留。')) {
          await this.habitManager.deleteHabit(habitId);
          await this._renderHabitPanel();
        }
      });
    });
  }

  // 获取快速打卡的预设数量
  _getQuickAmounts(habit) {
    if (habit.dailyGoal <= 1) return [1];
    if (habit.dailyGoal <= 5) return [1, 2];
    if (habit.dailyGoal <= 10) return [1, 5];
    if (habit.dailyGoal <= 100) return [10, 25];
    if (habit.dailyGoal <= 1000) return [100, 500];
    return [500, 1000];
  }

  // 刷新打卡面板（如果已打开）
  async _refreshHabitPanelIfOpen() {
    const overlay = document.getElementById('habitOverlay');
    if (overlay.classList.contains('show')) {
      await this._renderHabitPanel();
    }
  }

  // 显示添加习惯表单
  _showHabitAddForm() {
    document.getElementById('habitNameInput').value = '';
    document.getElementById('habitGoalInput').value = '';
    document.getElementById('habitUnitInput').value = '';
    document.getElementById('habitCategoryInput').value = 'custom';
    document.querySelectorAll('.habit-icon-option').forEach(o => o.classList.remove('active'));
    document.querySelector('.habit-icon-option[data-icon="✅"]').classList.add('active');
    document.getElementById('habitAddOverlay').style.display = 'flex';
  }

  // 确认添加习惯
  async _confirmAddHabit() {
    const name = document.getElementById('habitNameInput').value.trim();
    const goal = parseFloat(document.getElementById('habitGoalInput').value);
    const unit = document.getElementById('habitUnitInput').value.trim() || '次';
    const category = document.getElementById('habitCategoryInput').value;
    const iconEl = document.querySelector('.habit-icon-option.active');
    const icon = iconEl ? iconEl.dataset.icon : '✅';

    if (!name) { alert('请输入习惯名称'); return; }
    if (!goal || goal <= 0) { alert('请输入有效的每日目标'); return; }

    await this.habitManager.addHabit({
      name, icon, unit, dailyGoal: goal, category, source: 'user_custom'
    });

    document.getElementById('habitAddOverlay').style.display = 'none';
    await this._renderHabitPanel();
  }

  // 加载 AI 推荐习惯
  async _loadHabitSuggestions() {
    const suggestArea = document.getElementById('habitSuggestArea');
    const suggestList = document.getElementById('habitSuggestList');
    const emptyEl = document.getElementById('habitEmpty');

    suggestArea.style.display = 'block';
    emptyEl.style.display = 'none';
    suggestList.innerHTML = '<div style="color:var(--muted);padding:12px;">正在分析你的习惯档案...</div>';

    try {
      const suggestions = await this.habitManager.suggestHabitsFromProfile(this.llm);
      if (suggestions.length === 0) {
        suggestList.innerHTML = '<div style="color:var(--muted);padding:12px;">暂无推荐，请先添加自定义习惯</div>';
        return;
      }
      suggestList.innerHTML = suggestions.map((s, i) => `
        <div class="habit-suggest-item">
          <span class="habit-suggest-icon">${s.icon || '✅'}</span>
          <div class="habit-suggest-info">
            <div class="habit-suggest-name">${s.name} — 目标 ${s.dailyGoal}${s.unit}</div>
            <div class="habit-suggest-reason">${s.reason || ''}</div>
          </div>
          <button class="btn accent habit-suggest-adopt" data-idx="${i}">采纳</button>
        </div>
      `).join('');

      suggestList.querySelectorAll('.habit-suggest-adopt').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const idx = parseInt(e.target.dataset.idx);
          await this.habitManager.adoptSuggestedHabit(suggestions[idx]);
          e.target.parentElement.style.opacity = '0.5';
          e.target.textContent = '已采纳';
          e.target.disabled = true;
          await this._renderHabitPanel();
        });
      });
    } catch (err) {
      suggestList.innerHTML = `<div style="color:var(--warn);padding:12px;">推荐失败: ${err.message}</div>`;
    }
  }

  // 显示自定义打卡弹窗
  _showCustomCheckin(habitId) {
    this._customCheckinHabitId = habitId;
    const habit = null;
    document.getElementById('habitCustomAmount').value = '';
    document.getElementById('habitCustomNote').value = '';
    document.getElementById('habitCustomCheckinOverlay').style.display = 'flex';
  }

  // 确认自定义打卡
  async _confirmCustomCheckin() {
    const amount = parseFloat(document.getElementById('habitCustomAmount').value);
    const note = document.getElementById('habitCustomNote').value.trim();
    if (!amount || amount <= 0) { alert('请输入有效的数量'); return; }
    await this.habitManager.checkin(this._customCheckinHabitId, amount, note);
    document.getElementById('habitCustomCheckinOverlay').style.display = 'none';
    await this._renderHabitPanel();
  }

  // 显示通知横幅
  _showNotificationBanner(notif) {
    const container = document.getElementById('notifBannerContainer');

    const icons = {
      water: '💧',
      meal: '🍽️',
      exercise: '🏃',
      weight: '⚖️',
      sleep: '😴',
      custom: '🔔'
    };
    const icon = icons[notif.type] || icons.custom;

    const banner = document.createElement('div');
    banner.className = `notif-banner type-${notif.type || 'custom'}`;
    banner.innerHTML = `
      <div class="notif-icon">${icon}</div>
      <div class="notif-body">
        <div class="notif-title">${notif.title}</div>
        <div class="notif-message">${notif.message}</div>
        <div class="notif-meta">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <button class="notif-close" title="关闭">×</button>
    `;

    // 关闭按钮
    banner.querySelector('.notif-close').addEventListener('click', () => {
      banner.classList.add('notif-out');
      setTimeout(() => banner.remove(), 300);
    });

    container.appendChild(banner);

    // 8 秒后自动关闭
    setTimeout(() => {
      if (banner.parentNode) {
        banner.classList.add('notif-out');
        setTimeout(() => banner.remove(), 300);
      }
    }, 8000);
  }

  // 显示底部弹窗，返回 Promise<string>
  _showAskUser(question, options, allowCustom) {
    return new Promise((resolve) => {
      this._askUserResolve = resolve;

      // 设置问题文本
      document.getElementById('askUserQuestion').textContent = question;

      // 生成选项按钮
      const optionsContainer = document.getElementById('askUserOptions');
      optionsContainer.innerHTML = '';
      for (const opt of options) {
        const btn = document.createElement('button');
        btn.className = 'ask-user-option';
        btn.innerHTML = `<span class="ask-user-option-bullet"></span><span class="ask-user-option-text">${this._escapeHtml(opt)}</span>`;
        btn.addEventListener('click', () => this._resolveAskUser(opt));
        optionsContainer.appendChild(btn);
      }

      // 控制自定义输入区域
      const customArea = document.getElementById('askUserCustom');
      customArea.style.display = allowCustom ? 'flex' : 'none';

      // 清空输入框
      document.getElementById('askUserInput').value = '';

      // 显示弹窗
      document.getElementById('askUserOverlay').style.display = 'flex';

      // 如果允许自定义输入，自动聚焦
      if (allowCustom) {
        setTimeout(() => document.getElementById('askUserInput').focus(), 300);
      }
    });
  }

  // 提交自定义输入
  _submitAskUserCustom() {
    const input = document.getElementById('askUserInput');
    const value = input.value.trim();
    if (!value) return;
    this._resolveAskUser(value);
  }

  // 统一 resolve — 处理用户选择、自定义输入、跳过
  _resolveAskUser(value) {
    document.getElementById('askUserOverlay').style.display = 'none';
    if (this._askUserResolve) {
      this._askUserResolve(value || '（用户跳过了此问题）');
      this._askUserResolve = null;
    }
  }

  // HTML 转义
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 更新 Token 用量条
  updateTokenBar() {
    const u = this.chatManager.getTokenUsageInfo();
    const ctx = this.chatManager.getContextInfo();
    const maxCtx = window.QINGBAN_SETTINGS?.maxContextTokens || window.QINGBAN_CONFIG?.maxContextTokens || 12000;
    const pct = Math.min(100, Math.round(ctx.estimatedTokens / maxCtx * 100));
    const barColor = pct < 60 ? 'var(--accent)' : pct < 85 ? '#e8a838' : '#e85c5c';

    const fmt = (n) => {
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    };

    // 折叠状态：一行简要（含模型名）
    const modelName = this._currentModel || '—';
    document.getElementById('tokenBarStats').textContent =
      `[${modelName}] 上下文 ~${fmt(ctx.estimatedTokens)} · 今日 ${fmt(u.todayTotal)} · 累计 ${fmt(u.totalTokens)} · ≈¥${u.cost}`;

    // 展开状态：详细
    document.getElementById('tokenBarDetail').innerHTML = `
      <div class="token-detail-row">
        <div class="token-detail-col">
          <h4>本次对话</h4>
          <div class="token-detail-item"><span>当前模型</span><span class="val highlight">${modelName}</span></div>
          <div class="token-detail-item"><span>上下文大小</span><span class="val">~${fmt(ctx.estimatedTokens)}</span></div>
          <div class="token-detail-item"><span>消息数</span><span class="val">${ctx.messageCount}</span></div>
          <div class="token-progress"><div class="token-progress-fill" style="width:${pct}%;background:${barColor};"></div></div>
          <div class="token-detail-item" style="margin-top:2px;"><span>占用窗口</span><span class="val">${pct}%</span></div>
        </div>
        <div class="token-detail-col">
          <h4>今日花费</h4>
          <div class="token-detail-item"><span>输入</span><span class="val">${fmt(u.todayInput)}</span></div>
          <div class="token-detail-item"><span>输出</span><span class="val">${fmt(u.todayOutput)}</span></div>
          <div class="token-detail-item"><span>合计</span><span class="val highlight">${fmt(u.todayTotal)}</span></div>
          <div class="token-detail-item"><span>API 调用</span><span class="val">${u.todayCalls} 次</span></div>
        </div>
        <div class="token-detail-col">
          <h4>累计花费</h4>
          <div class="token-detail-item"><span>总 Token</span><span class="val highlight">${fmt(u.totalTokens)}</span></div>
          <div class="token-detail-item"><span>总调用</span><span class="val">${u.totalCalls} 次</span></div>
          <div class="token-detail-item"><span>使用天数</span><span class="val">${u.days} 天</span></div>
          <div class="token-detail-item"><span>估算费用</span><span class="val">≈¥${u.cost}</span></div>
        </div>
      </div>
    `;
  }

  // ===== UI 辅助 =====
  setProcessing(processing) {
    this.isProcessing = processing;
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) sendBtn.disabled = processing;
    // 不 disable 输入框，保持可编辑（避免 IME 中文输入被阻断）
    const input = document.getElementById('messageInput');
    if (processing) {
      input.setAttribute('data-processing', 'true');
      // 看门狗：非流式请求可能长时间静默（服务端 thinking / 视觉编码），
      // 超过 3 分钟仍无响应则自动解锁，避免界面永久卡死、后续发送全部静默吞掉
      if (this._processingWatchdog) clearTimeout(this._processingWatchdog);
      this._processingWatchdog = setTimeout(() => {
        if (!this.isProcessing) return;
        this.isProcessing = false;
        const sb = document.getElementById('sendBtn'); if (sb) sb.disabled = false;
        input.removeAttribute('data-processing');
        this.hideTyping();
        const waited = this._reqStarted ? Math.round((Date.now() - this._reqStarted) / 1000) : 0;
        const stageTxt = this._reqStage === 'waiting-server'
          ? '服务端长时间未返回（图片识别/生成慢，或连接静默挂起）'
          : '请求在发送前卡住（本地记忆加载 / 前端逻辑）';
        this.addMessage('assistant', `⚠️ 请求等待约 ${waited}s 仍无响应，已自动恢复。诊断：${stageTxt}。可点击「🔄 重试」或重新发送。`);
        this._appendRetryButton(null);
        input.focus();
      }, 180000);
      // 实时请求状态条：显示「卡在哪一步、等了多久」，方便排查
      this._reqStarted = Date.now();
      if (this._reqStage !== 'waiting-server') this._reqStage = 'preparing';
      this._showReqStatus();
      if (this._reqTimer) clearInterval(this._reqTimer);
      this._reqTimer = setInterval(() => this._showReqStatus(), 1000);
    } else {
      if (this._processingWatchdog) { clearTimeout(this._processingWatchdog); this._processingWatchdog = null; }
      if (this._reqTimer) { clearInterval(this._reqTimer); this._reqTimer = null; }
      this._hideReqStatus();
      input.removeAttribute('data-processing');
      input.focus();
    }
  }

  // 请求进行中状态条（每秒刷新一次已等待秒数 + 当前阶段）
  _showReqStatus() {
    if (!this.isProcessing) return;
    // 监听「请求已真正发出」事件，区分「前端准备」与「等服务端返回」两个阶段
    if (!window.__qbStageBound) {
      window.__qbStageBound = true;
      window.addEventListener('qb-llm-stage', (e) => {
        if (e.detail && e.detail.stage === 'sent') {
          this._reqStage = 'waiting-server';
          if (e.detail.hasImages !== undefined) this._reqIsImg = e.detail.hasImages;
          this._showReqStatus();
        }
      });
    }
    const sec = this._reqStarted ? Math.round((Date.now() - this._reqStarted) / 1000) : 0;
    // 三阶段：识别图片中（图片预识别）→ 等待响应（请求已发出）→ 准备中（本地处理）
    const recognizing = this._reqStage === 'recognizing';
    const img = recognizing ? '🔍 ' : (this._reqIsImg ? '🖼️ ' : '');
    const stageTxt = recognizing ? '识别图片中' : (this._reqStage === 'waiting-server' ? '等待响应' : '准备中');
    // 等待秒数融入 typing 指示器（聊天气泡风格），不再用独立浮动黑条
    const el = document.getElementById('typingIndicator');
    if (!el) return;
    const wait = el.querySelector('.typing-wait');
    if (wait) wait.textContent = `${img}${stageTxt} · ${sec}s`;
  }

  _hideReqStatus() {
    // 等待文字随 typing 指示器一起由 hideTyping() 移除，此处无需操作
  }

  // 显示进度遮罩
  showProgress(title, status = '') {
    document.getElementById('taskProgressTitle').textContent = title;
    document.getElementById('taskProgressStatus').textContent = status;
    document.getElementById('taskProgressOverlay').style.display = 'flex';
  }

  // 更新进度状态文字
  updateProgress(status) {
    document.getElementById('taskProgressStatus').textContent = status;
  }

  // 隐藏进度遮罩
  hideProgress() {
    document.getElementById('taskProgressOverlay').style.display = 'none';
  }

  // ===== 数据备份面板 =====

  async _openBackupPanel() {
    document.getElementById('backupOverlay').style.display = 'flex';
    await this._renderSnapshotList();
  }

  async _renderSnapshotList() {
    const listEl = document.getElementById('backupSnapshotList');
    try {
      const snaps = await this.backupManager.listSnapshots();
      if (snaps.length === 0) {
        listEl.innerHTML = '<div class="backup-snapshot-empty">暂无快照（跨天时自动生成，也可点击上方按钮立即快照）</div>';
        return;
      }
      listEl.innerHTML = snaps.map((s) => `
        <div class="backup-snapshot-row">
          <span class="backup-snapshot-time">🗂️ ${s.stamp.replace('_', ' ')} · ${s.files.length} 个文件</span>
          <button class="btn backup-restore-btn" data-stamp="${s.stamp}">回滚</button>
        </div>`).join('');
    } catch (e) {
      listEl.innerHTML = '<div class="backup-snapshot-empty">快照列表读取失败: ' + e.message + '</div>';
    }
  }

  async _exportBackup() {
    const btn = document.getElementById('backupExportBtn');
    btn.disabled = true;
    btn.textContent = '正在导出...';
    try {
      const r = await this.backupManager.exportBackup();
      if (r.method === 'filesystem') {
        this.showToast('备份已导出', r.path || r.fileName, 'success');
      } else {
        this.showToast('备份已开始下载', r.fileName, 'success');
      }
    } catch (e) {
      this.showToast('导出失败', e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '📤 导出全部数据（.qb.json）';
    }
  }

  async _importBackupFile(input) {
    const file = input.files && input.files[0];
    input.value = ''; // 清空以便重复选择同一文件
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const err = this.backupManager.validateBackup(data);
      if (err) {
        this.showToast('导入失败', err, 'error');
        return;
      }
      const fileCount = Object.keys(data.files).length;
      if (!confirm(`导入备份？\n\n文件数: ${fileCount}\n导出时间: ${(data.exportedAt || '未知').replace('T', ' ').slice(0, 16)}\n\n将完整还原为备份时点的数据，当前全部数据会被覆盖！`)) {
        return;
      }
      const r = await this.backupManager.importBackup(data, 'replace');
      this.showToast('备份已导入', `已写入 ${r.written} 个文件，即将刷新...`, 'success');
      // replace 导入后内存中的对话历史与磁盘已不一致，必须整页重载恢复一致状态
      setTimeout(() => location.reload(), 1500);
    } catch (e) {
      this.showToast('导入失败', e.message, 'error');
    }
  }

  async _snapshotNow() {
    try {
      const r = await this.backupManager.snapshotMemory();
      await this._renderSnapshotList();
      this.showToast('快照完成', `${r.saved.length} 个记忆文件 → ${r.stamp}`, 'success');
    } catch (e) {
      this.showToast('快照失败', e.message, 'error');
    }
  }

  _onSnapshotListClick(e) {
    const btn = e.target.closest('.backup-restore-btn');
    if (!btn) return;
    const stamp = btn.dataset.stamp;
    if (!confirm(`确定回滚到快照 ${stamp.replace('_', ' ')} 吗？\n\n将用该快照覆盖 PROFILE.md、BODY_METRICS.md、rules/ 等记忆文件。`)) {
      return;
    }
    this._restoreSnapshot(stamp);
  }

  async _restoreSnapshot(stamp) {
    try {
      const r = await this.backupManager.restoreSnapshot(stamp);
      // 记忆文件变化 → 失效 KV 前缀缓存，刷新文件树
      this.llmService._fixedFiles.forEach((p) => this.llmService._invalidatePrefixCache(p));
      await this.renderFileTree();
      this.showToast('快照已回滚', `已恢复 ${r.restored} 个记忆文件`, 'success');
    } catch (e) {
      this.showToast('回滚失败', e.message, 'error');
    }
  }

  // ===== 趋势面板与 AI 周报 =====

  async _openTrendPanel() {
    document.getElementById('trendOverlay').style.display = 'flex';
    document.getElementById('trendWeeklyBox').style.display = 'none';
    await this._renderTrend();
  }

  async _renderTrend() {
    const weightBox = document.getElementById('trendWeightBox');
    const calBox = document.getElementById('trendCalorieBox');
    const macroBox = document.getElementById('trendMacroBox');
    const habitBox = document.getElementById('trendHabitBox');
    weightBox.innerHTML = '<div class="trend-empty">加载中...</div>';
    try {
      const { weights, calories } = await this.statsManager.getDailyStats();
      const today = this.chatManager._getToday();
      weightBox.innerHTML = StatsManager.buildWeightSvg(weights, { today });
      calBox.innerHTML = StatsManager.buildCaloriesSvg(calories, { today });
      // 三大营养素图：用最新体重换算蛋白质建议区间（1.2~1.6g/kg）
      const latestWeight = weights.length > 0 ? weights[weights.length - 1].weight : null;
      macroBox.innerHTML = StatsManager.buildMacroSvg(calories, { today, weightKg: latestWeight });
      // 热力图直接读打卡原始 JSON，不走 stats 缓存
      let checkins = [];
      try {
        checkins = JSON.parse((await this.fm.readFile('.meta/habit-checkins.json')) || '[]');
      } catch (_) { /* 打卡数据损坏时热力图显示为空 */ }
      habitBox.innerHTML = StatsManager.buildHabitHeatmap(StatsManager.aggregateCheckinCounts(checkins), { today });
    } catch (e) {
      weightBox.innerHTML = '<div class="trend-empty">加载失败: ' + e.message + '</div>';
      calBox.innerHTML = '';
      macroBox.innerHTML = '';
      habitBox.innerHTML = '';
    }
  }

  // 生成 AI 周报（endDate 为周期最后一天），写入 weekly/<endDate>.md
  async _generateWeeklyReport(endDate) {
    const { weights, calories } = await this.statsManager.getDailyStats();
    const startDate = StatsManager._shiftDate(endDate, -6);

    // 近 7 天习惯完成情况（直接读原始 JSON，格式与 habit-manager 一致）
    let habitSummary = '';
    try {
      const habits = JSON.parse((await this.fm.readFile('.meta/habits.json')) || '[]').filter((h) => h.active !== false);
      const checkins = JSON.parse((await this.fm.readFile('.meta/habit-checkins.json')) || '[]');
      const lines = habits.map((h) => {
        const cs = checkins.filter((c) => c.habitId === h.id && c.date >= startDate && c.date <= endDate);
        const daysHit = new Set(cs.map((c) => c.date)).size;
        const total = cs.reduce((s, c) => s + (c.amount || 1), 0);
        return `- ${h.name}: 打卡 ${daysHit}/7 天，累计 ${Math.round(total * 10) / 10}${h.unit || ''}`;
      });
      habitSummary = lines.join('\n');
    } catch (e) {
      console.warn('[周报] 习惯数据读取失败:', e.message);
    }

    // 近 7 天「营养观察」行汇总（diet 文件中 AI 按食物组记录的微量元素缺口，供补剂建议参考）
    let macroNotes = '';
    try {
      const files = await this.fm.listFiles();
      const notes = [];
      for (const f of files) {
        const m = f.path.match(/^diet\/(\d{4}-\d{2}-\d{2})\.md$/);
        if (!m || m[1] < startDate || m[1] > endDate) continue;
        const md = await this.fm.readFile(f.path);
        const obs = md.match(/-\s*营养观察[：:]\s*(.+)/);
        if (obs) notes.push(`${m[1]}：${obs[1].trim()}`);
      }
      macroNotes = notes.join('\n');
    } catch (e) {
      console.warn('[周报] 营养观察汇总失败:', e.message);
    }

    const dataSection = StatsManager.buildWeeklyDataSection(weights, calories, habitSummary, endDate, macroNotes);
    const prompt = `你是轻伴的周报助手。请基于以下真实数据生成本周（${startDate} ~ ${endDate}）减重周报，350-500 字。

${dataSection}

## 要求
1. 数据必须原值引用，不得编造数据中不存在的信息
2. 结构：热量摄入解读 → 营养素与补剂 → 体重变化 → 习惯完成情况 → 下周 1-3 条具体可执行的建议
3. 「营养素与补剂」段：解读三大营养素日均与蛋白质是否达标（减脂期建议 1.2~1.6g/kg 体重）；结合「营养观察」指出微量元素缺口（如钙/omega-3/维C/B族/铁）；补剂建议**食物优先**，仅对持续出现的缺口用"可以考虑XX补剂"的措辞，注明个体差异、遵医嘱，不做诊断、不推荐剂量
4. 语气温暖、不评判；数据缺失的维度如实说明"本周未记录"，不要臆测`;

    const result = await this.llm.chat([{ role: 'user', content: prompt }], null, { currentDate: this.chatManager._getToday() });
    const content = (result && result.content) || '【周报生成失败，请重试】';
    const path = `weekly/${endDate}.md`;
    await this.fm.writeFile(path, content);
    return { path, content };
  }

  async _onWeeklyReportClick() {
    const btn = document.getElementById('trendWeeklyBtn');
    const box = document.getElementById('trendWeeklyBox');
    btn.disabled = true;
    btn.textContent = '正在生成本周周报...（约 20-40 秒）';
    box.style.display = 'none';
    try {
      const endDate = this.chatManager._getToday();
      const r = await this._generateWeeklyReport(endDate);
      box.textContent = r.content;
      box.style.display = 'block';
      this.showToast('周报已生成', r.path, 'success');
      // 重建索引让文件树/按需加载感知新文件
      try {
        await this.indexManager.rebuildIndex();
        this.onDemandLoader?.invalidateIndexCache();
        await this.renderFileTree();
      } catch (_) { /* 索引刷新失败不影响周报展示 */ }
    } catch (e) {
      this.showToast('周报生成失败', e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '生成本周周报';
    }
  }

  // 显示 Toast 通知（3 秒后自动消失）
  showToast(title, msg = '', type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const icon = icons[type] || icons.info;

    toast.innerHTML = `
      <div class="toast-icon">${icon}</div>
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        ${msg ? `<div class="toast-msg">${msg}</div>` : ''}
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
  }

  formatMarkdown(text) {
    if (!text) return '';
    let html = this.escapeHtml(text);

    // 代码块（```...```）
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre class="md-codeblock"><code>${code.trim()}</code></pre>`;
    });

    // 表格（| ... | ... |）
    html = html.replace(/((?:^\|.*\|\s*\n)+)/gm, (m, table) => {
      const lines = table.trim().split('\n');
      if (lines.length < 2) return m;
      // 解析表头
      const headers = lines[0].split('|').map(s => s.trim()).filter(s => s !== '');
      // 跳过分隔行（第二行 |---|---|）
      const rows = lines.slice(2).map(line => 
        line.split('|').map(s => s.trim()).filter(s => s !== '')
      );
      let t = '<table class="md-table"><thead><tr>';
      headers.forEach(h => t += `<th>${h}</th>`);
      t += '</tr></thead><tbody>';
      rows.forEach(row => {
        t += '<tr>';
        for (let i = 0; i < headers.length; i++) {
          t += `<td>${row[i] || ''}</td>`;
        }
        t += '</tr>';
      });
      t += '</tbody></table>';
      return t + '\n';
    });

    // 标题（###, ##, #）
    html = html.replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1 class="md-h1">$1</h1>');

    // 分割线（--- 或 ***）
    html = html.replace(/^(?:---|\*\*\*)$/gm, '<hr class="md-hr">');

    // 引用块（> ...）
    html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');

    // 无序列表（- 或 * 开头）
    html = html.replace(/(?:^|\n)((?:[-*]\s+.+(?:\n|$))+)/g, (m, list) => {
      const items = list.trim().split('\n').map(line => 
        line.replace(/^[-*]\s+/, '').trim()
      );
      return '\n<ul class="md-ul">' + items.map(i => `<li>${i}</li>`).join('') + '</ul>\n';
    });

    // 有序列表（1. 2. 3.）
    html = html.replace(/(?:^|\n)((?:\d+\.\s+.+(?:\n|$))+)/g, (m, list) => {
      const items = list.trim().split('\n').map(line => 
        line.replace(/^\d+\.\s+/, '').trim()
      );
      return '\n<ol class="md-ol">' + items.map(i => `<li>${i}</li>`).join('') + '</ol>\n';
    });

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // 斜体
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // 行内代码
    html = html.replace(/`(.+?)`/g, '<code class="md-code">$1</code>');
    // 链接 [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>');

    // 换行（连续两个换行 = 段落分隔，单个换行 = <br>）
    html = html.replace(/\n\n/g, '</p><p>');
    html = '<p>' + html + '</p>';
    // 修复：不要在块级元素外面包 <p>
    html = html.replace(/<p>(<(?:h[123]|ul|ol|pre|table|blockquote|hr)[\s\S]*?<\/(?:h[123]|ul|ol|pre|table|blockquote|hr)>)<\/p>/g, '$1');
    html = html.replace(/<p>\n*<\/p>/g, '');
    // 单个换行转 <br>（在 <p> 内）
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  formatArgs(args) {
    if (!args) return '';
    if (args.path) return `path: ${args.path}`;
    if (args.pattern) return `pattern: ${args.pattern}`;
    if (args.path && args.content) return `path: ${args.path}, ${args.content.length} chars`;
    return JSON.stringify(args).substring(0, 80);
  }

  getToolIcon(tool) {
    const icons = {
      read_file: '<svg class="ico ico-sm"><use href="#icon-read"/></svg>',
      write_file: '<svg class="ico ico-sm"><use href="#icon-write"/></svg>',
      search_files: '<svg class="ico ico-sm"><use href="#icon-search"/></svg>',
      append_file: '<svg class="ico ico-sm"><use href="#icon-append"/></svg>'
    };
    return icons[tool] || '<svg class="ico ico-sm"><use href="#icon-warn"/></svg>';
  }
}

// 启动应用
const app = new App();
app.init().catch(err => {
  console.error('App init failed:', err);
  document.getElementById('fileTree').innerHTML = '<div style="padding:20px;color:var(--warn);font-size:12px;">初始化失败: ' + err.message + '</div>';
});
