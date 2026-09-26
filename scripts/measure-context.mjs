// measure-context.mjs — 估算每次 LLM 请求的上下文构成（v3.11.0 起测量真实内嵌模板）
// 用法: node scripts/measure-context.mjs
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = { QINGBAN_CONFIG: {}, QINGBAN_SETTINGS: {}, dispatchEvent() {}, addEventListener() {} };

const { FileManager } = await import(pathToFileURL(join(root, 'js', 'file-manager.js')));
const { LLMService } = await import(pathToFileURL(join(root, 'js', 'llm-service.js')));
const fmStub = {
  readFile: async () => null, writeFile: async () => true, appendFile: async () => true, searchFiles: async () => '',
};
const svc = new LLMService(fmStub, {}, { loadForChat: async () => ({ strategy: 'no_match', indexSummaryLines: [] }) });
const fmc = new FileManager();

// ===== 1. 工具定义（每次请求、每轮工具循环都完整携带）=====
const tools = svc.getToolDefinitions();
console.log('=== 工具定义（每次请求、每轮工具循环都完整携带） ===');
let total = 0;
for (const t of tools) {
  const len = JSON.stringify(t).length;
  total += len;
  console.log(`  ${t.function.name.padEnd(18)} ${String(len).padStart(5)} 字符`);
}
console.log(`  ${'合计'.padEnd(16)} ${String(total).padStart(5)} 字符  (约 ${Math.round(total * 0.4)}~${Math.round(total * 0.6)} tokens)`);

// ===== 2. 系统提示词：固定前缀（纯静态，KV 缓存长存活） vs 动态段 =====
console.log('\n=== 系统提示词组成（v3.11.0：前缀=纯静态，PROFILE/指标已移入动态段） ===');
const fixed = [
  ['CLAUDE.md (内嵌v12)', fmc._getClaudeMd()],
  ['rules/learned-habits.md 模板', fmc._getLearnedHabitsMd()],
  ['rules/allergies.md 模板', fmc._getAllergiesMd()],
  ['rules/preferences.md 模板', fmc._getPreferencesMd()],
  ['rules/exercise.md 模板', fmc._getExerciseMd()],
];
const dynamic = [
  ['PROFILE.md 模板', fmc._getProfileMd()],
  ['BODY_METRICS.md 模板', fmc._getBodyMetricsMd()],
];
let fixedTotal = 0, dynTotal = 0;
for (const [n, c] of fixed) { fixedTotal += c.length; console.log(`  [固定] ${n.padEnd(28)} ${String(c.length).padStart(6)} 字符`); }
for (const [n, c] of dynamic) { dynTotal += c.length; console.log(`  [动态] ${n.padEnd(28)} ${String(c.length).padStart(6)} 字符`); }
console.log(`  固定前缀合计 ${fixedTotal} 字符 (约 ${Math.round(fixedTotal * 0.5)}~${Math.round(fixedTotal * 0.7)} tokens) — KV 缓存可长期复用`);
console.log(`  动态段(用户数据) ${dynTotal} 字符 — 随 AI 写入变化，不再影响前缀缓存`);

// ===== 3. 工具循环放大说明 =====
console.log('\n=== 单次请求放大示例（maxToolRounds=5，KV 缓存省输入计费但上传流量照付） ===');
console.log('  第 N 轮请求 ≈ 第 N-1 轮全部内容 + assistant(tool_calls) + tool 结果（累积增长）');
console.log('  read_file 无截断：AI 读大文件时该结果在后续每轮重传');
