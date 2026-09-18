// backup-manager.js
// 数据备份与迁移 — IndexedDB 文件存储全量导出/导入 + 关键记忆文件自动快照
// 所有用户数据（记忆文件、diet/、chat/、habits/、.meta/*.json）都在 FileManager 的单一
// 文件存储里，因此备份 = 全量 dump，导入 = 校验后写回。
// APK 内通过 window.Capacitor.Plugins.Filesystem 落盘（www 不含 node_modules，不能用 ESM import）；
// 浏览器/开发模式降级为 blob 下载。

const BACKUP_FORMAT = 'qingban-backup';
const BACKUP_VERSION = 1;

// 记忆快照覆盖的关键文件（AI 可写、误删/误写损失大的用户数据）
// CLAUDE.md/INDEX.md 为系统文件，升级时自动重建，不入快照
export const SNAPSHOT_FILES = [
  'PROFILE.md',
  'BODY_METRICS.md',
  'rules/learned-habits.md',
  'rules/allergies.md',
  'rules/preferences.md',
  'rules/exercise.md',
];
const SNAPSHOT_DIR = '.meta/backups';
const MAX_SNAPSHOTS = 7;
const STAMP_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/;

export class BackupManager {
  constructor(fileManager, appVersion = '') {
    this.fm = fileManager;
    this.appVersion = appVersion;
  }

  // ===== 导出 =====

  // 构建备份数据对象（导出与测试共用）
  async buildBackupJson() {
    const files = {};
    const list = await this.fm.listFiles();
    for (const f of list) {
      const content = await this.fm.readFile(f.path);
      if (content !== null) files[f.path] = content;
    }
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      appVersion: this.appVersion,
      exportedAt: new Date().toISOString(),
      fileCount: Object.keys(files).length,
      files,
    };
  }

  // 校验备份结构，合法返回 null，否则返回错误信息
  validateBackup(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '备份文件格式不正确';
    if (data.format !== BACKUP_FORMAT) return '不是轻伴备份文件（format 不匹配）';
    if (typeof data.version !== 'number') return '备份缺少版本号';
    if (data.version > BACKUP_VERSION) return `备份版本 v${data.version} 高于当前支持的 v${BACKUP_VERSION}，请先升级 App`;
    if (!data.files || typeof data.files !== 'object' || Array.isArray(data.files)) return '备份缺少 files 数据';
    return null;
  }

  // 导出：优先 Capacitor Filesystem 写入系统目录，失败/不可用时降级浏览器下载
  // 返回 { ok, method, fileName, path? } 或抛错
  async exportBackup() {
    const data = await this.buildBackupJson();
    const json = JSON.stringify(data);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fileName = `qingban-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.qb.json`;

    const FS = window.Capacitor?.Plugins?.Filesystem;
    if (FS) {
      try {
        const result = await FS.writeFile({
          path: fileName,
          data: json,
          directory: 'DOCUMENTS',
          encoding: 'utf8',
          recursive: true,
        });
        return { ok: true, method: 'filesystem', fileName, path: result?.uri || fileName };
      } catch (e) {
        console.warn('[BackupManager] Filesystem 写入失败，降级浏览器下载:', e.message);
      }
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true, method: 'download', fileName };
  }

  // ===== 导入 =====

  // 导入备份。mode:
  //   'replace' — 清空现有全部数据后写入备份（完整还原）
  //   'merge'   — 备份覆盖同名文件，现有但备份中没有的文件保留
  async importBackup(data, mode = 'replace') {
    const err = this.validateBackup(data);
    if (err) throw new Error(err);

    let written = 0;
    if (mode === 'replace') {
      await this.fm.clearAll();
    }
    for (const [path, content] of Object.entries(data.files)) {
      if (typeof content !== 'string') continue;
      await this.fm.writeFile(path, content);
      written++;
    }
    return { written, mode, backupExportedAt: data.exportedAt || '', backupAppVersion: data.appVersion || '' };
  }

  // ===== 自动快照 =====

  // 将关键记忆文件快照到 .meta/backups/<日期_时分>/，滚动保留最近 7 份
  async snapshotMemory(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const saved = [];
    for (const p of SNAPSHOT_FILES) {
      const content = await this.fm.readFile(p);
      if (content) {
        await this.fm.writeFile(`${SNAPSHOT_DIR}/${stamp}/${p}`, content);
        saved.push(p);
      }
    }
    await this._pruneOldSnapshots();
    return { stamp, saved };
  }

  // 列出现有快照（新 → 旧），每项 { stamp, files: [...] }
  async listSnapshots() {
    const all = await this.fm.listFiles();
    const map = new Map();
    for (const f of all) {
      const m = f.path.match(new RegExp(`^${SNAPSHOT_DIR.replace(/\./g, '\\.')}/(\\d{4}-\\d{2}-\\d{2}_\\d{4})/(.+)$`));
      if (m) {
        if (!map.has(m[1])) map.set(m[1], []);
        map.get(m[1]).push(m[2]);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([stamp, files]) => ({ stamp, files: files.sort() }));
  }

  // 回滚指定快照到正式文件（仅覆盖 SNAPSHOT_FILES 中存在于快照里的文件）
  async restoreSnapshot(stamp) {
    if (!STAMP_RE.test(stamp)) throw new Error('快照标识不合法');
    let restored = 0;
    for (const p of SNAPSHOT_FILES) {
      const content = await this.fm.readFile(`${SNAPSHOT_DIR}/${stamp}/${p}`);
      if (content !== null) {
        await this.fm.writeFile(p, content);
        restored++;
      }
    }
    return { restored };
  }

  // 清理超出保留数量的旧快照
  async _pruneOldSnapshots() {
    const all = await this.fm.listFiles();
    const stamps = new Set();
    for (const f of all) {
      const m = f.path.match(new RegExp(`^${SNAPSHOT_DIR.replace(/\./g, '\\.')}/(\\d{4}-\\d{2}-\\d{2}_\\d{4})/`));
      if (m) stamps.add(m[1]);
    }
    const sorted = [...stamps].sort();
    while (sorted.length > MAX_SNAPSHOTS) {
      const old = sorted.shift();
      for (const f of all) {
        if (f.path.startsWith(`${SNAPSHOT_DIR}/${old}/`)) {
          await this.fm.deleteFile(f.path);
        }
      }
    }
  }
}
