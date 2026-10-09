// settings.js — 模型与行为配置（持久化到 localStorage）
// 用户可通过功能菜单的「模型设置」修改这些参数

const STORAGE_KEY = 'qingban_settings';
const SETTINGS_VERSION = 2; // 递增此版本号可强制升级旧设置

// 默认值 — 全部使用 Kimi K3 模型
const DEFAULT_SETTINGS = {
  visionModel: 'k3',              // 视觉模型（图片识别）
  chatModel: 'k3',                // 对话模型（纯文本）
  summaryModel: 'k3',             // 摘要模型（跨天总结/日终分析）
  temperature: 0.7,               // 温度（0=严谨, 1=创意）
  maxToolRounds: 5,               // 最大工具调用轮数
  historyDays: 7,                 // 近 N 天历史注入天数
  fileTruncate: 800,              // 单文件截断字数
  maxOutputTokens: 32768,         // 单次回复最大输出 token 数（32K，适配 K3 thinking）
  maxContextTokens: 1048576,      // 上下文窗口大小（1M）
  effortLevel: 'max',             // 推理强度（max=最高质量）
  onDemandLoad: true,             // 按需索引加载开关（true=按需加载历史，false=回退全量注入近N天）
  onDemandTokenBudget: 2000,      // 对话场景动态注入部分 token 预算上限
  // 连接配置（空值 = 跟随 app-config.js 默认）
  apiBaseURL: '',                 // 大模型 API 基础地址（如 https://api.kimi.com/coding）
  apiKey: '',                     // API Key（留空则使用 app-config 内置 Key）
  apiFormat: '',                  // API 协议格式 'openai' | 'anthropic'（空=跟随默认）
  requestTimeout: 120,            // 请求超时（秒）
  retryCount: 30,                 // 失败重试次数（429/5xx/网络错误）
  customHeaders: '',              // 自定义请求头（JSON 字符串，如 {"X-Custom":"value"}）
  reminders: {                    // 系统级每日提醒（阶段四 · 主动陪伴）
    morningEnabled: true,         // 晨间问候（昨日体重/打卡回顾）
    morningTime: '08:00',
    habitEnabled: true,           // 打卡提醒（每日两次定点）
    habitNoonTime: '12:30',
    habitEveningTime: '20:00',
    eveningEnabled: true,         // 晚间复盘（睡前体重提醒）
    eveningTime: '21:30'
  },
  settlement: {                   // 每日结算步骤开关（凌晨跨天时按此跳过被关闭的步骤）
    dailySummary: true,           // 保存昨日对话摘要（chat/{昨日}.md）
    integrityCheck: true,         // 数据完整性检查（LLM 审查遗漏）
    habitRefresh: true,           // 刷新习惯总结（近 21 天分析）
    habitReport: true,            // 保存昨日打卡记录（habits/{昨日}.md）
    weeklyHabitSummary: true,     // 周度习惯总结（每 7 天）
    memorySnapshot: true,         // 记忆文件自动快照（滚动保留 7 份）
    weeklyReport: true,           // AI 周报（昨日为周日时生成）
    rebuildIndex: true,           // 重建记忆索引
    refreshReminders: true,       // 刷新每日定点提醒（静默）
    autoDream: true               // Auto Dream 自动触发（静默）
  }
};

// 加载设置（合并默认值 + 版本升级）
function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 版本升级：旧设置中 maxOutputTokens < 32768 时自动提升到 32768
      if (parsed.maxOutputTokens && parsed.maxOutputTokens < 32768) {
        console.warn(`[Settings] 升级 maxOutputTokens: ${parsed.maxOutputTokens} → 32768`);
        parsed.maxOutputTokens = 32768;
      }
      const merged = { ...DEFAULT_SETTINGS, ...parsed };
      // 深合并子对象：确保新增字段有默认值（旧用户存档缺新开关时不致 undefined）
      merged.reminders = { ...DEFAULT_SETTINGS.reminders, ...(parsed.reminders || {}) };
      merged.settlement = { ...DEFAULT_SETTINGS.settlement, ...(parsed.settlement || {}) };
      return merged;
    }
  } catch (e) {
    console.warn('[Settings] 加载失败，使用默认值:', e.message);
  }
  return { ...DEFAULT_SETTINGS };
}

// 保存设置
function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('[Settings] 保存失败:', e.message);
    return false;
  }
}

// 全局设置对象
window.QINGBAN_SETTINGS = loadSettings();
