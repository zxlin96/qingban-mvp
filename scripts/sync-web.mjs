// sync-web.mjs — 三目录同步与一致性校验（js/ 为唯一源头）
// 用法:
//   node scripts/sync-web.mjs          # 同步: 复制差异文件 + 清理目标目录中的孤儿文件
//   node scripts/sync-web.mjs --check  # 只校验: MD5 比对 + 孤儿检测, 不一致退出码 1
//
// 管理范围（仅这些路径参与同步, android assets 根下的 cordova.js 等生成物不碰）:
//   js/  css/  data/  index.html  manifest.json
// 目标:  源目录 → www/ → android/app/src/main/assets/public/

import { createHash } from 'node:crypto';
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_ASSETS = join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public');

const DIR_MAPPINGS = [
  { src: join(ROOT, 'js'), dests: [join(ROOT, 'www', 'js'), join(ANDROID_ASSETS, 'js')] },
  { src: join(ROOT, 'css'), dests: [join(ROOT, 'www', 'css'), join(ANDROID_ASSETS, 'css')] },
  { src: join(ROOT, 'data'), dests: [join(ROOT, 'www', 'data'), join(ANDROID_ASSETS, 'data')] },
];
const FILE_MAPPINGS = [
  { src: join(ROOT, 'index.html'), dests: [join(ROOT, 'www', 'index.html'), join(ANDROID_ASSETS, 'index.html')] },
  { src: join(ROOT, 'manifest.json'), dests: [join(ROOT, 'www', 'manifest.json'), join(ANDROID_ASSETS, 'manifest.json')] },
];

const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex');

// 递归收集目录下所有文件的相对路径
function listFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function collectJobs() {
  const jobs = []; // { rel, src, dests }
  for (const m of DIR_MAPPINGS) {
    for (const rel of listFiles(m.src)) {
      jobs.push({ rel: `${relative(ROOT, m.src).split(sep).join('/')}/${rel}`, src: join(m.src, rel), dests: m.dests.map((d) => join(d, rel)) });
    }
  }
  for (const m of FILE_MAPPINGS) {
    jobs.push({ rel: relative(ROOT, m.src).split(sep).join('/'), src: m.src, dests: m.dests });
  }
  return jobs;
}

function collectOrphans() {
  const orphans = []; // { destPath, origin }
  for (const m of DIR_MAPPINGS) {
    const srcRel = new Set(listFiles(m.src));
    for (const dest of m.dests) {
      for (const rel of listFiles(dest)) {
        if (!srcRel.has(rel)) orphans.push({ destPath: join(dest, rel), origin: relative(ROOT, join(dest, rel)).split(sep).join('/') });
      }
    }
  }
  return orphans;
}

const checkMode = process.argv.includes('--check');
const jobs = collectJobs();
const problems = [];
const copied = [];
const pruned = [];

for (const job of jobs) {
  if (!statSync(job.src, { throwIfNoEntry: false })) {
    problems.push(`源文件缺失: ${job.rel}`);
    continue;
  }
  const srcHash = md5(job.src);
  for (const dest of job.dests) {
    const destHash = statSync(dest, { throwIfNoEntry: false }) ? md5(dest) : null;
    if (destHash === srcHash) continue;
    if (checkMode) {
      problems.push(`不一致: ${relative(ROOT, dest).split(sep).join('/')} (${destHash ? '内容不同' : '缺失'})`);
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(job.src));
      copied.push(relative(ROOT, dest).split(sep).join('/'));
    }
  }
}

for (const o of collectOrphans()) {
  if (checkMode) {
    problems.push(`孤儿文件（源目录不存在）: ${o.origin}`);
  } else {
    rmSync(o.destPath);
    pruned.push(o.origin);
  }
}

const tag = checkMode ? '[check]' : '[sync]';
if (copied.length) console.log(`${tag} 已同步 ${copied.length} 个文件:\n  ` + copied.join('\n  '));
else console.log(`${tag} 三目录一致，无需复制`);
if (pruned.length) console.log(`${tag} 已清理孤儿文件:\n  ` + pruned.join('\n  '));

if (problems.length) {
  console.error(`${tag} 发现 ${problems.length} 处问题:\n  ` + problems.join('\n  '));
  process.exit(1);
}
if (checkMode) console.log('[check] 校验通过 ✓');
