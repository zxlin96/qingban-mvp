// exercise-manager.test.js — 运动记录/类型匹配/MET 与配速消耗估算测试（v3.22.0 运动板块）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { ExerciseManager } from '../js/exercise-manager.js';

function newEM(initial = {}) {
  const fm = mockFm(initial);
  const em = new ExerciseManager(fm);
  return { fm, em };
}

// 与 ExerciseManager._getToday 同口径的今天
const pad = (n) => String(n).padStart(2, '0');
const today = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();

// ===== 类型匹配 =====

describe('matchType', () => {
  test('关键词命中：篮球/快走/健身房/跑步/游泳', () => {
    assert.equal(ExerciseManager.matchType('打了一小时篮球').typeKey, 'basketball');
    assert.equal(ExerciseManager.matchType('饭后快走').typeKey, 'walk');
    assert.equal(ExerciseManager.matchType('健身房练腿').typeKey, 'gym');
    assert.equal(ExerciseManager.matchType('夜跑5公里').typeKey, 'run');
    assert.equal(ExerciseManager.matchType('去游泳了').typeKey, 'swim');
  });

  test('未命中回退 other', () => {
    const r = ExerciseManager.matchType('随便活动了一下');
    assert.equal(r.typeKey, 'other');
    assert.equal(r.icon, '💪');
  });

  test('空文本回退 other', () => {
    assert.equal(ExerciseManager.matchType('').typeKey, 'other');
    assert.equal(ExerciseManager.matchType(null).typeKey, 'other');
  });
});

// ===== 配速 MET =====

describe('metFromSpeed', () => {
  test('walk 档位：慢→快走', () => {
    assert.equal(ExerciseManager.metFromSpeed('walk', 3.0), 2.8);
    assert.equal(ExerciseManager.metFromSpeed('walk', 4.0), 3.5);
    assert.equal(ExerciseManager.metFromSpeed('walk', 5.0), 4.3);
    assert.equal(ExerciseManager.metFromSpeed('walk', 6.0), 5.0);
    assert.equal(ExerciseManager.metFromSpeed('walk', 8.0), 7.0); // 超出快走范围 → 竞走档
  });

  test('run 档位：8km/h → 8.3 MET', () => {
    assert.equal(ExerciseManager.metFromSpeed('run', 8.0), 8.3);
    assert.equal(ExerciseManager.metFromSpeed('run', 12.0), 11.0);
    assert.equal(ExerciseManager.metFromSpeed('run', 14.0), 12.8);
  });

  test('cycle 档位', () => {
    assert.equal(ExerciseManager.metFromSpeed('cycle', 17), 6.8);
    assert.equal(ExerciseManager.metFromSpeed('cycle', 24), 10.0);
  });

  test('非户外类型返回 null（回退强度档）', () => {
    assert.equal(ExerciseManager.metFromSpeed('gym', 5.0), null);
    assert.equal(ExerciseManager.metFromSpeed('basketball', 5.0), null);
    assert.equal(ExerciseManager.metFromSpeed('walk', 0), null);
  });
});

// ===== 消耗估算 =====

describe('estimateKcal', () => {
  test('有距离走配速 MET：快走 60min 5km（体重70）→ 4.3 MET ≈ 301 kcal', () => {
    const r = ExerciseManager.estimateKcal({ typeKey: 'walk', durationMin: 60, distanceKm: 5, intensity: 'low', weightKg: 70 });
    assert.equal(r.metSource, 'speed');
    assert.equal(r.met, 4.3);
    assert.equal(r.kcal, 301);
    assert.equal(r.speedKmh, 5);
  });

  test('无距离走强度档：篮球 60min medium（体重70）→ 6.5 MET = 455 kcal', () => {
    const r = ExerciseManager.estimateKcal({ typeKey: 'basketball', durationMin: 60, weightKg: 70, intensity: 'medium' });
    assert.equal(r.metSource, 'intensity');
    assert.equal(r.kcal, 455);
  });

  test('时长不足 5 分钟不启用配速（配速不稳定）', () => {
    const r = ExerciseManager.estimateKcal({ typeKey: 'walk', durationMin: 3, distanceKm: 0.3, weightKg: 70, intensity: 'medium' });
    assert.equal(r.metSource, 'intensity');
    assert.equal(r.met, 4.3);
  });

  test('体重缺失按 60kg 兜底', () => {
    const r = ExerciseManager.estimateKcal({ typeKey: 'walk', durationMin: 60, intensity: 'medium', weightKg: null });
    assert.equal(r.weightKg, 60);
    assert.equal(r.kcal, Math.round(4.3 * 60));
  });

  test('强度档映射 low/medium/high', () => {
    const base = { typeKey: 'run', durationMin: 60, weightKg: 70 };
    assert.equal(ExerciseManager.estimateKcal({ ...base, intensity: 'low' }).met, 6.0);
    assert.equal(ExerciseManager.estimateKcal({ ...base, intensity: 'high' }).met, 11.5);
  });
});

// ===== 按日 MD 生成 =====

describe('buildDayMd', () => {
  test('含 front-matter/记录节/距离配速/当日汇总', () => {
    const md = ExerciseManager.buildDayMd('2026-11-17', [
      { name: '饭后快走', icon: '🚶', typeKey: 'walk', time: '13:20', durationMin: 30, distanceKm: 2.6, intensity: 'medium', note: '', met: 4.3, metSource: 'speed', weightKg: 72.5, kcal: 155 },
      { name: '篮球', icon: '🏀', typeKey: 'basketball', time: '19:00', durationMin: 90, distanceKm: null, intensity: 'high', note: '半场 3v3', met: 8.0, metSource: 'intensity', weightKg: 72.5, kcal: 490 }
    ]);
    assert.ok(md.includes('date: 2026-11-17'));
    assert.ok(md.includes('## 13:20 🚶 饭后快走'));
    assert.ok(md.includes('- 距离: 2.6 km（配速 5.2 km/h）'));
    assert.ok(md.includes('- 备注: 半场 3v3'));
    assert.ok(md.includes('## 当日汇总'));
    assert.ok(md.includes('- 总估算消耗: ~645 kcal'));
    assert.ok(md.includes('- 总时长: 120 分钟'));
    assert.ok(md.includes('- 总距离: 2.6 km'));
    assert.ok(md.includes('- 记录次数: 2 次'));
  });

  test('无记录生成占位文本', () => {
    const md = ExerciseManager.buildDayMd('2026-11-17', []);
    assert.ok(md.includes('（今日暂无运动记录）'));
  });
});

// ===== 周报数据段 =====

describe('buildWeeklySummaryText', () => {
  test('无记录', () => {
    assert.equal(ExerciseManager.buildWeeklySummaryText({ count: 0, totalMin: 0, totalKm: 0, totalKcal: 0, activeDays: 0 }, []), '（本周无运动记录）');
  });

  test('有记录：按日明细 + 合计行', () => {
    const week = { count: 2, totalMin: 120, totalKm: 2.6, totalKcal: 645, activeDays: 2 };
    const records = [
      { date: '2026-11-16', name: '篮球', durationMin: 90, distanceKm: null, kcal: 490 },
      { date: '2026-11-17', name: '饭后快走', durationMin: 30, distanceKm: 2.6, kcal: 155 }
    ];
    const text = ExerciseManager.buildWeeklySummaryText(week, records);
    assert.ok(text.includes('- 11-16：篮球 90min ~490kcal'));
    assert.ok(text.includes('- 11-17：饭后快走 30min·2.6km ~155kcal'));
    assert.ok(text.includes('本周合计：2 次 · 120 分钟 · 2.6 km · ~645 kcal，活跃 2/7 天'));
  });
});

// ===== 管理器异步流程 =====

describe('ExerciseManager 异步流程', () => {
  test('首次 getPresets 写入 3 个种子预设', async () => {
    const { fm, em } = newEM();
    const presets = await em.getPresets();
    assert.equal(presets.length, 3);
    assert.deepEqual(presets.map(p => p.name), ['饭后快走', '篮球', '健身房']);
    assert.ok(fm.files.has('.meta/exercise-presets.json'));
    // 第二次读取不重种
    const again = await em.getPresets();
    assert.equal(again.length, 3);
  });

  test('addRecord 落盘 JSON + 生成 exercise/日期.md', async () => {
    const { fm, em } = newEM();
    const r = await em.addRecord({ name: '饭后快走', typeKey: 'walk', durationMin: 30, distanceKm: 2.6, intensity: 'medium', source: 'quick', weightKg: 72.5 });
    assert.equal(r.kcal, 156); // 5.2km/h → 4.3 MET × 72.5kg × 0.5h ≈ 155.875
    assert.equal(r.metSource, 'speed');
    assert.ok(fm.files.has('.meta/exercise-records.json'));
    const mdPath = `exercise/${today}.md`;
    assert.ok(fm.files.has(mdPath));
    assert.ok(fm.files.get(mdPath).includes('## 当日汇总'));
    assert.ok(fm.files.get(mdPath).includes('- 距离: 2.6 km'));
  });

  test('addRecord 无距离走强度档：健身房 60min 70kg → 5.0 MET', async () => {
    const { em } = newEM();
    const r = await em.addRecord({ name: '健身房', typeKey: 'gym', durationMin: 60, intensity: 'medium', source: 'ai', weightKg: 70 });
    assert.equal(r.met, 5.0);
    assert.equal(r.kcal, 350);
    assert.equal(r.metSource, 'intensity');
  });

  test('deleteRecord 撤销后记录与当日 MD 一同清空', async () => {
    const { fm, em } = newEM();
    const r = await em.addRecord({ name: '快走', typeKey: 'walk', durationMin: 20, source: 'quick', weightKg: 70 });
    assert.equal((await em.getDaySummary(today)).count, 1);
    assert.ok(await em.deleteRecord(r.record.id));
    assert.equal((await em.getDaySummary(today)).count, 0);
    assert.ok(!fm.files.has(`exercise/${today}.md`)); // 全部撤销后 MD 删除
  });

  test('getWeekSummary 聚合活跃天数/总距离/类型分布', async () => {
    const { em } = newEM();
    await em.addRecord({ name: '快走', typeKey: 'walk', durationMin: 30, distanceKm: 2.5, source: 'quick', weightKg: 70 });
    const week = await em.getWeekSummary(7);
    assert.equal(week.count, 1);
    assert.equal(week.activeDays, 1);
    assert.equal(week.totalMin, 30);
    assert.equal(week.totalKm, 2.5);
    assert.ok(week.byType.walk);
    assert.equal(week.byType.walk.label, '快走');
    assert.equal(week.days.length, 7);
  });

  test('addPreset/deletePreset（软删除）', async () => {
    const { em } = newEM();
    const preset = await em.addPreset({ name: '跳绳', icon: '🪢', typeKey: 'rope', defaultMin: 15 });
    let presets = await em.getPresets();
    assert.equal(presets.length, 4);
    assert.equal(ExerciseManager.getDef(preset.typeKey).label, '跳绳');
    assert.ok(await em.deletePreset(preset.id));
    presets = await em.getPresets();
    assert.equal(presets.length, 3);
  });

  test('onChangeCallback 触发', async () => {
    const { em } = newEM();
    let fired = 0;
    em.onChangeCallback = () => fired++;
    await em.addRecord({ name: '快走', typeKey: 'walk', durationMin: 15, source: 'quick', weightKg: 70 });
    assert.equal(fired, 1);
  });
});
