// app.js — 轻伴 MVP 主控制器
// 串联 FileManager / SparkLLM / LLMService / ChatManager / DietRecorder

// ===== 版本号 =====
// 每次发布修改版本号，App 启动时显示在顶栏，点击可查看 CHANGELOG
const APP_VERSION = '3.6.1';
const APP_VERSION_DATE = '2026-09-19';
// 暴露版本到全局：启动诊断横幅据此判断新包是否真的加载到了最新代码
window.__qbVersion = APP_VERSION;

const CHANGELOG = [
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
import { IndexManager } from './index-manager.js';
import { OnDemandLoader } from './on-demand-loader.js';
import { BackupManager } from './backup-manager.js';
import { StatsManager } from './stats-manager.js';

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
    this.statsManager = new StatsManager(this.fm);
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

  async init() {
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
    this._startHabitReminderCheck(); // 启动未完成习惯提醒检查
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
    if (savedDate && savedDate < effectiveToday) {
      window.__qbStage = 'handleDayRollover';
      // 跨天了 — 恢复历史执行跨天流程
      this.chatManager.currentDate = savedDate;
      this.chatManager.history = (saved.history && saved.history.length > 0) ? saved.history : [];
      // 显示跨天总结动效遮罩
      this._showDayTransition(savedDate, effectiveToday);
      // 跨天总结是增值任务，界面已可用（遮罩仅提示"生成中"）— 先标记就绪，避免 20s 启动看门狗误报"启动超时"
      this._markAppReady();
      // 跨天流程含多步大模型调用（昨日摘要 + 21天习惯总结 + 周度总结），单步 20-40s，
      // 30s 会砍断流程导致后续步骤（习惯总结/重建索引等）丢失。就绪已标记，放宽到 5 分钟
      await this._withTimeout(this.handleDayRollover(), 300000, 'handleDayRollover');
      // 跨天后 currentDate 已更新为今天，history 已清空
      this.chatManager.currentDate = realToday;
      this.updateDateBadge();
      this.updateContextInfo();
      window.__qbStage = 'renderFileTree(rollover)';
      await this._withTimeout(this.renderFileTree(), 5000, 'renderFileTree(rollover)');
      // 隐藏遮罩
      this._hideDayTransition();
      // 显示新一天的问候（含昨日总结和今日建议）
      window.__qbStage = 'showNewDayWelcome';
      await this._withTimeout(this.showNewDayWelcome(), 15000, 'showNewDayWelcome');
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
      // 非首次但没有历史 → 显示欢迎语
      if (!this._dayRolloverDone) this.showWelcome();
    }

    // 启动后台日期检测（每分钟检查一次，支持运行中跨天自动总结）
    this._startDayCheckTimer();
  }

  // 后台定时检测日期变化（凌晨也会触发）
  _startDayCheckTimer() {
    // 每 60 秒检查一次（APP 在前台时）
    this._dayCheckInterval = setInterval(() => {
      this._checkDayRollover();
    }, 60000);

    // 方式1：浏览器 visibilitychange 事件
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._backgroundedAt = Date.now();
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
      // 日期变了 — 触发跨天总结
      this._isRolloverProcessing = true;
      try {
        console.log(`[跨天检测] ${this.chatManager.currentDate} → ${realToday}`);

        // 显示跨天总结动效遮罩
        this._showDayTransition(this.chatManager.currentDate, realToday);

        // 执行跨天总结
        await this.handleDayRollover();

        // 更新日期
        this.chatManager.currentDate = realToday;
        this.updateDateBadge();
        this.updateContextInfo();
        await this.renderFileTree();

        // 清空聊天区，显示新一天问候（含昨日总结和今日建议）
        document.getElementById('chatMessages').innerHTML = '';
        await this.showNewDayWelcome();

        // 隐藏遮罩
        this._hideDayTransition();
      } catch (e) {
        console.error('[跨天检测] 失败:', e.message);
        this._hideDayTransition();
        this.addMessage('system', `⚠️ 跨天总结出错: ${e.message}。你可以继续使用，稍后重试。`);
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

  // 显示跨天总结动效
  _showDayTransition(yesterday, today) {
    const overlay = document.getElementById('dayTransitionOverlay');
    const stats = document.getElementById('dayTransitionStats');
    const closeBtn = document.getElementById('dayTransitionCloseBtn');
    closeBtn.style.display = 'none';
    stats.innerHTML = '';
    overlay.classList.add('show');

    // 逐步显示总结步骤
    const steps = [
      '正在保存昨日对话摘要...',
      '正在检查数据完整性...',
      '正在学习你的生活习惯...',
      '正在保存昨日打卡记录...',
      '正在重建记忆索引...',
      '正在开启新的一天...'
    ];

    this._dtStepIndex = 0;
    this._dtAddStep = (text, status = 'active') => {
      const div = document.createElement('div');
      div.className = 'dt-step' + (status === 'done' ? ' done' : status === 'error' ? ' error' : '');
      div.innerHTML = `<span class="dt-dot"></span><span>${text}</span>`;
      div.style.animationDelay = `${this._dtStepIndex * 0.1}s`;
      stats.appendChild(div);
      this._dtStepIndex++;
    };
    this._dtUpdateStep = (index, status) => {
      const steps = stats.querySelectorAll('.dt-step');
      if (steps[index]) {
        steps[index].className = 'dt-step ' + status;
      }
    };

    // 先显示第一步
    this._dtAddStep(steps[0]);
  }

  _hideDayTransition() {
    const overlay = document.getElementById('dayTransitionOverlay');
    const closeBtn = document.getElementById('dayTransitionCloseBtn');
    // 显示完成状态，延迟关闭
    const stats = document.getElementById('dayTransitionStats');
    const allSteps = stats.querySelectorAll('.dt-step');
    allSteps.forEach(s => s.classList.add('done'));

    closeBtn.style.display = 'block';
    closeBtn.onclick = () => {
      overlay.classList.remove('show');
    };
    // 3 秒后自动关闭
    setTimeout(() => {
      overlay.classList.remove('show');
    }, 3000);
  }

  // 跨天处理：保存昨日摘要 → 数据完整性检查 → 学习习惯 → 重建索引 → 清空历史
  async handleDayRollover() {
    const yesterdayDate = this.chatManager.currentDate;
    const yesterdayHistory = [...this.chatManager.history];

    // 步骤 1: 保存昨日对话摘要
    if (this._dtAddStep) this._dtAddStep('正在保存昨日对话摘要...');
    try {
      await this.chatManager.saveDailySummary(this.llm);
      if (this._dtUpdateStep) this._dtUpdateStep(0, 'done');
    } catch (e) {
      console.error('[DayRollover] 摘要失败:', e.message);
      if (this._dtUpdateStep) this._dtUpdateStep(0, 'error');
    }

    // 步骤 2: 数据完整性检查
    if (this._dtAddStep) this._dtAddStep('正在检查数据完整性...');
    if (yesterdayHistory.length > 0) {
      try {
        await this._dataIntegrityCheck(yesterdayDate, yesterdayHistory);
        if (this._dtUpdateStep) this._dtUpdateStep(1, 'done');
      } catch (e) {
        console.error('[DayRollover] 数据检查失败:', e.message);
        if (this._dtUpdateStep) this._dtUpdateStep(1, 'error');
      }
    } else {
      if (this._dtUpdateStep) this._dtUpdateStep(1, 'done');
    }

    // 步骤 3: 刷新习惯总结（基于近 21 天对话摘要全量分析）
    if (this._dtAddStep) this._dtAddStep('正在刷新习惯总结（近 21 天）...');
    const stepHabit = this._dtStepIndex - 1;
    if (this.profileLearner) {
      try {
        const refreshResult = await this.profileLearner.refreshHabits(21);
        console.log('[DayRollover] 习惯刷新:', refreshResult.summary);
        if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done');
      } catch (e) {
        console.error('[DayRollover] 习惯刷新失败:', e.message);
        if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'error');
      }
    } else {
      if (this._dtUpdateStep) this._dtUpdateStep(stepHabit, 'done');
    }

    // 步骤 3.5: 保存昨日打卡报告
    if (this._dtAddStep) this._dtAddStep('正在保存昨日打卡记录...');
    const stepHabitReport = this._dtStepIndex - 1;
    try {
      const habitReport = await this.habitManager.generateDailyReport(yesterdayDate);
      await this.fm.writeFile(`habits/${yesterdayDate}.md`, habitReport);
      if (this._dtUpdateStep) this._dtUpdateStep(stepHabitReport, 'done');
    } catch (e) {
      console.error('[DayRollover] 打卡报告失败:', e.message);
      if (this._dtUpdateStep) this._dtUpdateStep(stepHabitReport, 'error');
    }

    // 步骤 4 (条件): 周度习惯总结 — 每 7 天触发一次
    const needWeekly = await this._shouldRunWeeklySummary();
    if (needWeekly) {
      if (this._dtAddStep) this._dtAddStep('正在总结近一个月的习惯变化...');
      const stepWeekly = this._dtStepIndex - 1;
      try {
        await this._weeklyHabitSummary();
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeekly, 'done');
      } catch (e) {
        console.error('[DayRollover] 周度总结失败:', e.message);
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeekly, 'error');
      }
    }

    // 步骤 4.5: 记忆文件自动快照（滚动保留最近 7 份，防 AI 误写丢数据）
    if (this._dtAddStep) this._dtAddStep('正在快照记忆文件...');
    const stepSnap = this._dtStepIndex - 1;
    try {
      await this.backupManager.snapshotMemory();
      if (this._dtUpdateStep) this._dtUpdateStep(stepSnap, 'done');
    } catch (e) {
      console.error('[DayRollover] 记忆快照失败:', e.message);
      if (this._dtUpdateStep) this._dtUpdateStep(stepSnap, 'error');
    }

    // 步骤 4.6 (条件): AI 周报 — 昨日为周日时生成上周周报
    let yesterdayDow = -1;
    try { yesterdayDow = new Date(`${yesterdayDate}T00:00:00`).getDay(); } catch (_) {}
    if (yesterdayDow === 0) {
      if (this._dtAddStep) this._dtAddStep('正在生成 AI 周报...');
      const stepWeeklyReport = this._dtStepIndex - 1;
      try {
        const report = await this._generateWeeklyReport(yesterdayDate);
        console.log('[DayRollover] AI 周报已生成:', report.path);
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeeklyReport, 'done');
      } catch (e) {
        console.error('[DayRollover] AI 周报失败:', e.message);
        if (this._dtUpdateStep) this._dtUpdateStep(stepWeeklyReport, 'error');
      }
    }

    // 步骤 5: 重建索引
    if (this._dtAddStep) this._dtAddStep('正在重建记忆索引...');
    const stepIndex = this._dtStepIndex - 1;
    try {
      await this.indexManager.rebuildIndex();
      this.onDemandLoader?.invalidateIndexCache();
      if (this._dtUpdateStep) this._dtUpdateStep(stepIndex, 'done');
    } catch (e) {
      console.error('[DayRollover] 重建索引失败:', e.message);
      if (this._dtUpdateStep) this._dtUpdateStep(stepIndex, 'error');
    }

    // 步骤 6: 清空历史
    if (this._dtAddStep) this._dtAddStep('正在开启新的一天...');
    const stepClear = this._dtStepIndex - 1;
    this.chatManager.history = [];
    await this.chatManager.clearSavedHistory();
    if (this._dtUpdateStep) this._dtUpdateStep(stepClear, 'done');

    this._dayRolloverDone = true;
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

### rules/exercise.md（运动情况）
${currentExercise}

## 检查任务
请检查对话中是否提到了以下信息但尚未记录到对应文件中：
1. **饮食记录**：用户提到吃了什么/喝了什么，但 diet/${date}.md 里没有 → 需要补充
2. **体重数据**：用户提到体重数字，但 BODY_METRICS.md 里没有这一天记录 → 需要更新
3. **过敏/忌口**：用户提到新的过敏或忌口，但 allergies.md 里没有 → 需要更新
4. **饮食偏好**：用户提到口味/习惯，但 preferences.md 里没有 → 需要更新
5. **运动情况**：用户提到运动/能力/限制，但 exercise.md 里没有 → 需要更新

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
  async showNewDayWelcome() {
    const today = this.chatManager.currentDate;
    const now = new Date();
    const hour = now.getHours();
    let greeting;
    if (hour < 9) greeting = '早上好';
    else if (hour < 12) greeting = '上午好';
    else if (hour < 14) greeting = '中午好';
    else if (hour < 18) greeting = '下午好';
    else greeting = '晚上好';

    // 先显示一条简短问候，让用户知道 App 已就绪
    this.addMessage('assistant', `${greeting}！今天是 **${today}**，新的一天开始了 🌿\n\n正在为你整理昨日总结和今日建议，请稍候...`);

    // 计算昨天的日期（用本地时间，不用 toISOString 避免时区偏移）
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
- 饮食：[昨天吃了什么、总热量、是否超标]
- 运动：[昨天是否有运动]
- 体重：[最新体重和变化趋势]
- 亮点：[做得好的地方，用鼓励的语气]

### 💡 今日建议
- 饮食：[2-3 条具体建议，基于昨天的饮食情况]
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
  static THEMES = ['dark', 'light', 'warm'];
  static THEME_LABELS = { dark: '深色科技', light: '浅色清新', warm: '暖调米黄' };

  initTheme() {
    const saved = localStorage.getItem('qingban-theme') || 'dark';
    this.setTheme(saved);
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

  // ===== 发送消息 =====
  async sendMessage() {
    if (this.isProcessing) {
      this.showToast('上一条还在处理中', '请稍候，或等待自动恢复后重试', 'info');
      return;
    }

    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    const hasPhotos = this.pendingPhotos.length > 0;
    this._reqIsImg = hasPhotos;
    const sentPhotos = hasPhotos ? [...this.pendingPhotos] : [];
    if (!text && !hasPhotos) return;

    // 构建用户消息
    let userContent;
    if (hasPhotos) {
      // 有图片(支持多张) — 只发图片，无文字时不附加默认文案
      const parts = [];
      if (text) {
        parts.push({ type: 'text', text });
      }
      for (const photo of this.pendingPhotos) {
        parts.push({ type: 'image_url', image_url: { url: photo } });
      }
      userContent = parts;
      // 显示用户消息（图片+文字）
      this.addMessage('user', text || '', this.pendingPhotos);
      this.chatManager.addUserPhotoMessage(text || '', this.pendingPhotos);
      this.pendingPhotos = [];
      this.clearPhotoPreview();
    } else {
      // 纯文字
      userContent = text;
      this.addMessage('user', text);
      this.chatManager.addUserMessage(text);
    }

    input.value = '';
    this.autoResize(input);
    this.setProcessing(true);

    // 保存上下文用于网络中断后重试
    this._lastSendContext = { userContent, sentPhotos };

    // 同一天内不压缩上下文，避免单天对话产生遗忘感
    // 上下文压缩改为仅在跨天(advanceDay)时通过存档+清空来处理

    // 显示 typing 指示器（等待完整响应）
    this.showTyping();

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
      this.chatManager.getHistory(),
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

    menu.appendChild(makeItem('拍照', 'icon-camera', () => this.openCamera()));
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

  // 调用摄像头拍照（单张）
  openCamera() {
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
        } catch (err) {
          console.error('Camera capture error:', err);
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
    document.getElementById('viewerContent').textContent = content || '(文件为空)';
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
    document.getElementById('settingsOverlay').style.display = 'flex';
  }

  _saveSettings() {
    const settings = {
      visionModel: document.getElementById('setVisionModel').value.trim() || 'k3',
      chatModel: document.getElementById('setChatModel').value.trim() || 'k3',
      summaryModel: document.getElementById('setSummaryModel').value.trim() || 'k3',
      temperature: parseFloat(document.getElementById('setTemperature').value),
      maxToolRounds: parseInt(document.getElementById('setMaxToolRounds').value) || 5,
      maxOutputTokens: parseInt(document.getElementById('setMaxOutputTokens').value) || 32768,
      effortLevel: document.getElementById('setEffortLevel').value || 'max',
      historyDays: parseInt(document.getElementById('setHistoryDays').value) ?? 7,
      fileTruncate: parseInt(document.getElementById('setFileTruncate').value) || 800
    };

    // 限制范围
    settings.temperature = Math.max(0, Math.min(1, settings.temperature));
    settings.maxToolRounds = Math.max(1, Math.min(20, settings.maxToolRounds));
    settings.maxOutputTokens = Math.max(1024, Math.min(32768, settings.maxOutputTokens));
    settings.historyDays = Math.max(0, Math.min(30, settings.historyDays));
    settings.fileTruncate = Math.max(100, Math.min(5000, settings.fileTruncate));

    window.QINGBAN_SETTINGS = settings;
    saveSettings(settings);

    // 应用到 LLMService
    if (this.llm) {
      this.llm.maxToolRounds = settings.maxToolRounds;
    }

    document.getElementById('settingsOverlay').style.display = 'none';
    this.addMessage('assistant', `设置已保存并生效 ✓\n\n- 视觉模型: \`${settings.visionModel}\`\n- 对话模型: \`${settings.chatModel}\`\n- 摘要模型: \`${settings.summaryModel}\`\n- 温度: ${settings.temperature}\n- 工具轮数: ${settings.maxToolRounds}\n- 输出上限: ${settings.maxOutputTokens} tokens\n- 推理强度: ${settings.effortLevel}\n- 历史天数: ${settings.historyDays}\n- 截断字数: ${settings.fileTruncate}`);
  }

  _resetSettings() {
    if (!confirm('确定恢复所有设置到默认值吗？')) return;
    localStorage.removeItem('qingban_settings');
    window.QINGBAN_SETTINGS = loadSettings();
    this.showSettings(); // 重新加载显示
  }

  // 应用 Kimi K3 全量预配置
  _applyPresetK3() {
    // 填充 UI
    document.getElementById('setVisionModel').value = 'k3';
    document.getElementById('setChatModel').value = 'k3';
    document.getElementById('setSummaryModel').value = 'k3';
    document.getElementById('setTemperature').value = 0.7;
    document.getElementById('setTemperatureVal').textContent = '0.7';
    document.getElementById('setMaxToolRounds').value = 5;
    document.getElementById('setMaxOutputTokens').value = 32768;
    document.getElementById('setEffortLevel').value = 'max';
    document.getElementById('setHistoryDays').value = 7;
    document.getElementById('setFileTruncate').value = 800;

    // 直接保存
    const settings = {
      visionModel: 'k3',
      chatModel: 'k3',
      summaryModel: 'k3',
      temperature: 0.7,
      maxToolRounds: 5,
      maxOutputTokens: 32768,
      maxContextTokens: 1048576,
      effortLevel: 'max',
      historyDays: 7,
      fileTruncate: 800
    };

    window.QINGBAN_SETTINGS = settings;
    saveSettings(settings);

    if (this.llm) {
      this.llm.maxToolRounds = settings.maxToolRounds;
    }

    document.getElementById('settingsOverlay').style.display = 'none';
    this.addMessage('assistant', `已应用 Kimi K3 全量预配置 ✓\n\n- 视觉模型: \`k3\`\n- 对话模型: \`k3\`\n- 摘要模型: \`k3\`\n- 上下文窗口: 1M tokens\n- 输出上限: 32768 tokens\n- 推理强度: max\n- 温度: 0.7\n- 工具轮数: 5\n- 历史天数: 7\n- 截断字数: 800`);
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
    const now = new Date();
    const hour = now.getHours();
    if (hour >= 22 || hour < 7) return;

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
    const img = this._reqIsImg ? '🖼️ ' : '';
    const stageTxt = this._reqStage === 'waiting-server' ? '等待响应' : '准备中';
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
    const habitBox = document.getElementById('trendHabitBox');
    weightBox.innerHTML = '<div class="trend-empty">加载中...</div>';
    try {
      const { weights, calories } = await this.statsManager.getDailyStats();
      const today = this.chatManager._getToday();
      weightBox.innerHTML = StatsManager.buildWeightSvg(weights, { today });
      calBox.innerHTML = StatsManager.buildCaloriesSvg(calories, { today });
      // 热力图直接读打卡原始 JSON，不走 stats 缓存
      let checkins = [];
      try {
        checkins = JSON.parse((await this.fm.readFile('.meta/habit-checkins.json')) || '[]');
      } catch (_) { /* 打卡数据损坏时热力图显示为空 */ }
      habitBox.innerHTML = StatsManager.buildHabitHeatmap(StatsManager.aggregateCheckinCounts(checkins), { today });
    } catch (e) {
      weightBox.innerHTML = '<div class="trend-empty">加载失败: ' + e.message + '</div>';
      calBox.innerHTML = '';
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

    const dataSection = StatsManager.buildWeeklyDataSection(weights, calories, habitSummary, endDate);
    const prompt = `你是轻伴的周报助手。请基于以下真实数据生成本周（${startDate} ~ ${endDate}）减重周报，300-450 字。

${dataSection}

## 要求
1. 数据必须原值引用，不得编造数据中不存在的信息
2. 结构：热量摄入解读 → 体重变化 → 习惯完成情况 → 下周 1-3 条具体可执行的建议
3. 语气温暖、不评判；数据缺失的维度如实说明"本周未记录"，不要臆测`;

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
