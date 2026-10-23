// prompt-eval.mjs — CLAUDE.md 提示词压缩的行为评测集（TODO.md 第〇节）
// 用法:
//   node scripts/prompt-eval.mjs --save-baseline   用当前提示词跑全部用例，保存行为基线
//   node scripts/prompt-eval.mjs --only 记体重     只跑一个用例（连通性冒烟/调试）
//   node scripts/prompt-eval.mjs                   用当前提示词跑全部用例，与基线对比
//
// 原理：用真实 LLM（.env 的 PEV_* 连接配置，回退 app-config.js）+ LLMService 完整工具循环（工具结果用内存 mock），
// 记录每个用例的「工具调用签名」（工具名集合 + write_file 目标路径），与基线对比。
// 判定分两级：
//   FAIL — 违反用例的硬性行为要求（expect 谓词），退出码 1
//   DIFF — 与基线签名不同但未违反硬性要求（LLM 非确定性可能造成），人工判断
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'scripts', 'prompt-eval-baseline.json');

// ===== 环境准备（app-config.js 是普通 script，手动执行它拿到 QINGBAN_CONFIG） =====
globalThis.window = { dispatchEvent() {}, addEventListener() {} };
const appConfigCode = readFileSync(join(root, 'js', 'app-config.js'), 'utf8');
new Function('window', appConfigCode)(globalThis.window);
// Node 无 CORS 问题，浏览器态的空 baseURL 会打到相对路径 —— 补上直连地址
if (!globalThis.window.QINGBAN_CONFIG.baseURL) {
  globalThis.window.QINGBAN_CONFIG.baseURL = 'https://api.kimi.com/coding';
}
// ===== 评测连接配置：优先 .env / 环境变量（PEV_*），回退 app-config.js（内置 Key 已移除，通常为空） =====
try { process.loadEnvFile(); } catch (_) { /* .env 不存在时忽略 */ }
{
  const cfg = globalThis.window.QINGBAN_CONFIG;
  if (process.env.PEV_API_KEY) cfg.apiKey = process.env.PEV_API_KEY;
  if (process.env.PEV_BASE_URL) cfg.baseURL = process.env.PEV_BASE_URL;
  if (process.env.PEV_API_FORMAT) cfg.apiFormat = process.env.PEV_API_FORMAT;
  if (!cfg.apiKey) {
    console.error('✗ 未配置评测 Key：请在 .env 中设置 PEV_API_KEY=sk-xxx，可选 PEV_BASE_URL / PEV_MODEL / PEV_API_FORMAT（anthropic|openai，与 BASE_URL 协议匹配），或通过同名环境变量传入');
    process.exit(1);
  }
}
// 评测确定性：温度 0、按需加载关闭（走可预期的全量注入分支）
globalThis.window.QINGBAN_SETTINGS = {
  temperature: 0,
  maxToolRounds: 5,
  onDemandLoad: false,
  historyDays: 3,
};
// 模型名走 settings.chatModel/visionModel — spark-llm.chat() 不读 QINGBAN_CONFIG.model
if (process.env.PEV_MODEL) {
  globalThis.window.QINGBAN_SETTINGS.chatModel = process.env.PEV_MODEL;
  globalThis.window.QINGBAN_SETTINGS.visionModel = process.env.PEV_MODEL;
}

const { FileManager } = await import(pathToFileURL(join(root, 'js', 'file-manager.js')));
const { LLMService } = await import(pathToFileURL(join(root, 'js', 'llm-service.js')));
const { SparkLLM } = await import(pathToFileURL(join(root, 'js', 'spark-llm.js')));

// ===== mock 存储：真实模板 + 拟真样本数据 =====
const fmc = new FileManager();
function buildFm() {
  const files = new Map();
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dstr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  files.set('CLAUDE.md', fmc._getClaudeMd());
  files.set('INDEX.md', fmc._getIndexMd());
  files.set('PROFILE.md', `---\nupdated: ${dstr}\nversion: 1\n---\n\n# 用户档案\n\n## 基础信息\n- 昵称: 小轻\n- 性别: 女\n- 年龄: 28\n- 身高: 162cm\n- 初始体重: 82kg\n- 目标体重: 65kg\n- 目标日期: 2026-12-31`);
  files.set('BODY_METRICS.md', `---\nupdated: ${dstr}\nversion: 1\n---\n\n# 身体指标追踪\n\n## 最新数据\n- 日期: ${dstr}\n- 体重: 79.4kg\n- BMI: 30.3\n\n## 体重趋势\n| 日期 | 体重 | 变化 |\n|------|------|------|\n| 09-20 | 80.2 | - |\n| 09-25 | 79.4 | -0.8 |`);
  files.set('rules/allergies.md', fmc._getAllergiesMd());
  files.set('rules/preferences.md', fmc._getPreferencesMd());
  files.set('rules/food-types.md', fmc._getFoodTypesMd());
  files.set('rules/exercise.md', fmc._getExerciseMd());
  files.set('rules/learned-habits.md', fmc._getLearnedHabitsMd());
  files.set(`diet/${dstr}.md`, '## 早餐\n- 食物: 鸡蛋1个、牛奶1杯\n- 估算热量: ~250 kcal\n\n## 当日汇总\n- 总估算热量: ~250 kcal');
  // 8 天前的饮食文件 — 供「查历史饮食」召回用例（超出 3 天注入窗口，必须靠工具找）
  const old = new Date(today.getTime() - 8 * 86400000);
  const dOld = `${old.getFullYear()}-${pad(old.getMonth() + 1)}-${pad(old.getDate())}`;
  files.set(`diet/${dOld}.md`, '## 午餐\n- 食物: 牛肉面1碗\n- 估算热量: ~520 kcal\n\n## 当日汇总\n- 总估算热量: ~520 kcal');
  files.set(`chat/${dstr}.md`, `---\ndate: ${dstr}\n---\n\n# ${dstr} 对话摘要\n\n· 记录早餐约250千卡`);
  return {
    files,
    readFile: async (p) => (files.has(p) ? files.get(p) : null),
    writeFile: async (p, c) => { files.set(p, c); return `Written ${c.length} chars to ${p}`; },
    appendFile: async (p, c) => { files.set(p, (files.get(p) || '') + '\n' + c); return 'appended'; },
    searchFiles: async () => '',
  };
}

// ===== 用例集：只断言工具调用行为 =====
const CASES = [
  { name: '记饮食', msg: '中午吃了红烧排骨盖饭，米饭一碗', expect: (s) => s.tools.includes('write_file') && s.writePaths.some((p) => p.startsWith('diet/')) },
  { name: '新食物记忆', msg: '晚饭吃了藜麦沙拉和三文鱼', expect: (s) => s.tools.includes('write_file') && s.writePaths.includes('rules/food-types.md') },
  { name: '记体重', msg: '今天称了78.5公斤', expect: (s) => s.tools.includes('write_file') && s.writePaths.includes('BODY_METRICS.md') },
  { name: '说过敏', msg: '对了，我对芒果过敏', expect: (s) => s.tools.includes('write_file') && s.writePaths.includes('rules/allergies.md') },
  { name: '运动打卡', msg: '刚才跑步30分钟，好累', expect: (s) => s.tools.includes('checkin_habit') },
  { name: '推荐习惯', msg: '帮我推荐几个适合打卡的习惯吧', expect: (s) => s.tools.includes('suggest_habit') },
  { name: '要提醒', msg: '40分钟后提醒我喝水', expect: (s) => s.tools.includes('send_notification') },
  { name: '缺细节', msg: '我吃了个汉堡', expect: (s) => s.tools.includes('ask_user') || s.tools.includes('write_file') },
  { name: '纯闲聊', msg: '今天天气真不错啊', expect: (s) => !s.tools.includes('write_file') && !s.tools.includes('checkin_habit') && !s.tools.includes('send_notification') },
  // 召回用例（v3.11.0 文件地图）：数据在注入窗口之外，模型必须主动用工具找
  { name: '查历史饮食', msg: '我上周三吃了什么？', expect: (s) => s.tools.includes('read_file') || s.tools.includes('search_files') },
  { name: '查打卡报告', msg: '帮我看看上周的打卡情况', expect: (s) => s.tools.includes('get_habit_status') || s.tools.includes('read_file') || s.tools.includes('search_files') },
];

function signature(log) {
  const tools = [...new Set(log.map((e) => e.tool))].sort();
  const writePaths = [...new Set(log.filter((e) => e.tool === 'write_file').map((e) => e.args?.path).filter(Boolean))].sort();
  return { tools, writePaths };
}

async function runCase(kase) {
  const fm = buildFm();
  const svc = new LLMService(fm, new SparkLLM(), null);
  svc.onAskUser = async (_q, opts) => (opts && opts[0]) || '好的';
  svc.onSendNotification = async () => ({ ok: true });
  svc.onCheckinHabit = async () => ({ ok: true });
  svc.onSuggestHabit = async () => ({ habits: [] });
  svc.onAddHabit = async () => ({ ok: true });
  svc.onGetHabitStatus = async () => ({ habits: [] });
  const today = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const dstr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const result = await Promise.race([
    svc.chat(kase.msg, [], { currentDate: dstr }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('用例超时(120s)')), 120000)),
  ]);
  const sig = signature(svc.getToolCallLog());
  return { reply: (result.content || '').slice(0, 80), ...sig };
}

// ===== 主流程 =====
const args = process.argv.slice(2);
const saveBaseline = args.includes('--save-baseline');
const onlyIdx = args.indexOf('--only');
const cases = onlyIdx >= 0 ? CASES.filter((c) => c.name.includes(args[onlyIdx + 1])) : CASES;
if (cases.length === 0) { console.error('没有匹配的用例'); process.exit(1); }

const claudeMd = fmc._getClaudeMd();
console.log(`[prompt-eval] CLAUDE.md: ${claudeMd.length} 字符 (version ${(claudeMd.match(/version:\s*(\d+)/) || [])[1]})，用例数: ${cases.length}\n`);

const results = {};
let failCount = 0;
for (const kase of cases) {
  process.stdout.write(`  ▶ ${kase.name} ... `);
  try {
    const sig = await runCase(kase);
    results[kase.name] = sig;
    const hardOk = kase.expect(sig);
    if (!hardOk) failCount++;
    console.log(hardOk ? `PASS  [${sig.tools.join(', ') || '无工具'}]${sig.writePaths.length ? ' → ' + sig.writePaths.join(', ') : ''}` : `FAIL  [${sig.tools.join(', ') || '无工具'}] → ${sig.writePaths.join(', ')}`);
  } catch (e) {
    results[kase.name] = { error: e.message };
    failCount++;
    console.log(`ERROR  ${e.message}`);
  }
}

// ===== 基线保存或对比 =====
if (saveBaseline) {
  writeFileSync(BASELINE, JSON.stringify({ savedAt: new Date().toISOString(), claudeMdChars: claudeMd.length, results }, null, 2));
  console.log(`\n[baseline] 已保存基线 → ${BASELINE}`);
} else if (existsSync(BASELINE) && !onlyIdx >= 0) {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  console.log(`\n[对比基线] (${base.savedAt.slice(0, 16)}, CLAUDE.md ${base.claudeMdChars} 字符)`);
  let diffCount = 0;
  const norm = (r) => JSON.stringify({ tools: (r.tools || []).sort(), writePaths: (r.writePaths || []).sort() });
  for (const kase of CASES) {
    const old = base.results[kase.name];
    const cur = results[kase.name];
    if (!old || !cur || old.error || cur.error) continue;
    if (norm(old) !== norm(cur)) {
      diffCount++;
      console.log(`  DIFF ${kase.name}:`);
      console.log(`    基线: [${(old.tools || []).join(', ')}] → ${(old.writePaths || []).join(', ') || '-'}`);
      console.log(`    当前: [${cur.tools.join(', ')}] → ${cur.writePaths.join(', ') || '-'}`);
    }
  }
  if (diffCount === 0) console.log('  全部用例与基线一致 ✓');
  else console.log(`  ${diffCount} 个用例签名有差异（未违反硬性要求时为 WARN，人工判断）`);
}

console.log(`\n[result] ${failCount === 0 ? '✓ 硬性行为要求全部通过' : `✗ ${failCount} 个用例违反硬性行为要求`}`);
process.exit(failCount === 0 ? 0 : 1);
