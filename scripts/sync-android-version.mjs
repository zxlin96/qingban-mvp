// sync-android-version.mjs — Android 包版本同步：package.json → android/app/build.gradle
// 解决"应用内版本更新了、系统安装界面/应用管理里 versionName 一直停在旧版"的问题
// （版本号第五处：Capacitor 不会自动同步 package.json → build.gradle）
//
// versionName = package.json 的 semver（如 "3.11.1"）
// versionCode = major*10000 + minor*100 + patch（单调递增，如 3.11.1 → 31101）
//
// 用法:
//   node scripts/sync-android-version.mjs          # 同步（有差异才写入）
//   node scripts/sync-android-version.mjs --check  # 只校验，不一致退出码 1（供 npm run verify）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
const checkMode = process.argv.includes('--check');

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) {
  console.error(`[android-version] package.json 版本号非 x.y.z 格式: ${version}`);
  process.exit(1);
}
const maj = Number(m[1]), min = Number(m[2]), pat = Number(m[3]);
const versionCode = maj * 10000 + min * 100 + pat;

const gradle = readFileSync(gradlePath, 'utf8');
const curCode = gradle.match(/versionCode\s+(\d+)/)?.[1];
const curName = gradle.match(/versionName\s+"([^"]+)"/)?.[1];

if (curCode === String(versionCode) && curName === version) {
  console.log(`[android-version] 已同步: versionName ${version} / versionCode ${versionCode}`);
  process.exit(0);
}
if (checkMode) {
  console.error(`[android-version] 不一致: build.gradle 为 ${curName}/${curCode}，package.json 为 ${version}/${versionCode}`);
  process.exit(1);
}
writeFileSync(gradlePath, gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`));
console.log(`[android-version] 已更新: versionName ${curName} → ${version}，versionCode ${curCode} → ${versionCode}`);
