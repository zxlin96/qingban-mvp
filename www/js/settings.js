// settings.js — 模型与行为配置（持久化到 localStorage）
// 用户可通过功能菜单的「模型设置」修改这些参数

const STORAGE_KEY = 'qingban_settings';

// 默认值
const DEFAULT_SETTINGS = {
  visionModel: 'xopkimik26',   // 视觉模型（图片识别）
  chatModel: 'xopglm52',        // 对话模型（纯文本）
  summaryModel: 'xopglm52',     // 摘要模型（跨天总结/日终分析）
  temperature: 0.7,             // 温度（0=严谨, 1=创意）
  maxToolRounds: 5,             // 最大工具调用轮数
  historyDays: 7,               // 近 N 天历史注入天数
  fileTruncate: 800             // 单文件截断字数
};

// 加载设置（合并默认值）
function loadSettings() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
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
