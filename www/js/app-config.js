// app-config.js — Kimi K3 预配置（Anthropic API 格式）
// 所有模型角色统一映射到 K3，上下文窗口 1M tokens
// 浏览器环境自动走本地代理（解决 CORS），APK 环境直连 Kimi
const _isCapacitor = typeof window !== 'undefined' && (window.capacitor || (window.androidBridge));
window.QINGBAN_CONFIG = {
  apiKey: "",  // 不内置 Key（原内置 Key 已吊销）；请在「设置 → 连接配置」填写自己的 Key，仅存本机
  baseURL: _isCapacitor ? "https://api.kimi.com/coding" : "",  // 浏览器走同源代理
  model: "k3",
  apiFormat: "anthropic",

  // 上下文与输出限制
  maxContextTokens: 1048576,       // 1M 上下文窗口
  maxOutputTokens: 32768,          // 单次回复最大输出（K3 thinking 模式需要更多 token）
  autoCompactWindow: 1048576,      // 自动压缩阈值（与上下文窗口一致）

  // 推理强度
  effortLevel: "max",              // max = 最高推理质量

  // 其他
  disableAutoupdater: true
};
