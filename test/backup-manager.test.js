// backup-manager.test.js — 备份/快照逻辑测试（阶段二）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { BackupManager, SNAPSHOT_FILES } from '../js/backup-manager.js';

function newBM(files = {}) {
  const fm = mockFm(files);
  return { fm, bm: new BackupManager(fm, '3.5.0') };
}

describe('buildBackupJson / validateBackup', () => {
  test('全量导出：包含所有文件与元信息', async () => {
    const { fm, bm } = newBM({ 'PROFILE.md': '档案', 'diet/2026-09-18.md': '午餐', '.meta/habits.json': '[]' });
    const data = await bm.buildBackupJson();
    assert.equal(data.format, 'qingban-backup');
    assert.equal(data.version, 1);
    assert.equal(data.appVersion, '3.5.0');
    assert.equal(data.fileCount, 3);
    assert.equal(data.files['PROFILE.md'], '档案');
    assert.equal(data.files['.meta/habits.json'], '[]');
    assert.ok(fm.files.size === 3);
  });

  test('校验：合法返回 null，结构异常返回错误信息', async () => {
    const { bm } = newBM();
    assert.equal(bm.validateBackup({ format: 'qingban-backup', version: 1, files: {} }), null);
    assert.ok(bm.validateBackup(null).includes('格式'));
    assert.ok(bm.validateBackup({ format: 'other', version: 1, files: {} }).includes('format'));
    assert.ok(bm.validateBackup({ format: 'qingban-backup', version: 2, files: {} }).includes('升级'));
    assert.ok(bm.validateBackup({ format: 'qingban-backup', version: 1 }).includes('files'));
  });
});

describe('importBackup 导入', () => {
  test('replace 模式：清空后完整还原', async () => {
    const { fm, bm } = newBM({ '旧文件.md': '旧的', 'PROFILE.md': '被覆盖前' });
    const backup = { format: 'qingban-backup', version: 1, exportedAt: '2026-09-18T10:00:00Z', files: { 'PROFILE.md': '还原的档案', 'diet/2026-09-17.md': '记录' } };
    const r = await bm.importBackup(backup, 'replace');
    assert.equal(r.written, 2);
    assert.equal(r.mode, 'replace');
    assert.ok(!fm.files.has('旧文件.md'), 'replace 应清空备份外的文件');
    assert.equal(fm.files.get('PROFILE.md'), '还原的档案');
  });

  test('merge 模式：覆盖同名，保留备份外文件', async () => {
    const { fm, bm } = newBM({ 'PROFILE.md': '旧档案', '本地独有.md': '留下' });
    const backup = { format: 'qingban-backup', version: 1, files: { 'PROFILE.md': '新档案' } };
    await bm.importBackup(backup, 'merge');
    assert.equal(fm.files.get('PROFILE.md'), '新档案');
    assert.equal(fm.files.get('本地独有.md'), '留下');
  });

  test('非法备份直接抛错且不动数据', async () => {
    const { fm, bm } = newBM({ 'PROFILE.md': '原样' });
    await assert.rejects(() => bm.importBackup({ format: 'x', version: 1, files: {} }), /format/);
    assert.equal(fm.files.get('PROFILE.md'), '原样');
  });
});

describe('snapshotMemory 自动快照', () => {
  test('快照关键记忆文件到 .meta/backups/<stamp>/', async () => {
    const { fm, bm } = newBM({
      'PROFILE.md': '档案v1',
      'BODY_METRICS.md': '体重',
      'rules/allergies.md': '花生',
      'rules/food-types.md': '# 食物种类\n- 包子',
      'CLAUDE.md': '系统文件不入快照',
    });
    const r = await bm.snapshotMemory(new Date(2026, 8, 18, 14, 30));
    assert.equal(r.stamp, '2026-09-18_1430');
    assert.deepEqual(r.saved.sort(), ['BODY_METRICS.md', 'PROFILE.md', 'rules/allergies.md', 'rules/food-types.md']);
    assert.equal(fm.files.get('.meta/backups/2026-09-18_1430/PROFILE.md'), '档案v1');
    assert.ok(![...fm.files.keys()].some((p) => p.includes('CLAUDE.md') && p.includes('backups')), '系统文件不快照');
  });

  test('滚动保留最近 7 份，旧的被清理', async () => {
    const { fm, bm } = newBM({ 'PROFILE.md': 'p' });
    for (let d = 1; d <= 9; d++) {
      await bm.snapshotMemory(new Date(2026, 8, d, 8, 0));
    }
    const snaps = await bm.listSnapshots();
    assert.equal(snaps.length, 7);
    assert.equal(snaps[0].stamp, '2026-09-09_0800', '最新在前');
    assert.ok(!fm.files.has('.meta/backups/2026-09-01_0800/PROFILE.md'), '最旧的已删除');
    assert.ok(fm.files.has('.meta/backups/2026-09-03_0800/PROFILE.md'));
  });

  test('restoreSnapshot 恢复到快照时点，非法 stamp 拒绝', async () => {
    const { fm, bm } = newBM({ 'PROFILE.md': '好的档案' });
    await bm.snapshotMemory(new Date(2026, 8, 18, 8, 0)); // 快照内容 = '好的档案'
    fm.files.set('PROFILE.md', 'AI 误写的坏内容');

    const r = await bm.restoreSnapshot('2026-09-18_0800');
    assert.equal(r.restored, 1);
    assert.equal(fm.files.get('PROFILE.md'), '好的档案');

    await assert.rejects(() => bm.restoreSnapshot('../evil'), /不合法/);
    await assert.rejects(() => bm.restoreSnapshot('2026-09-18'), /不合法/);
  });

  test('listSnapshots 按时间倒序，files 列出快照内文件', async () => {
    const { bm } = newBM({ 'PROFILE.md': 'p', 'rules/exercise.md': 'e' });
    await bm.snapshotMemory(new Date(2026, 8, 18, 8, 0));
    await bm.snapshotMemory(new Date(2026, 8, 18, 21, 5));
    const snaps = await bm.listSnapshots();
    assert.deepEqual(snaps.map((s) => s.stamp), ['2026-09-18_2105', '2026-09-18_0800']);
    assert.ok(snaps[0].files.includes('PROFILE.md'));
    assert.ok(SNAPSHOT_FILES.includes('rules/preferences.md'));
    assert.ok(SNAPSHOT_FILES.includes('rules/food-types.md'), 'v3.14.0 食物种类记忆必须纳入快照');
  });
});
