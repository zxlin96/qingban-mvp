// habit-manager.test.js — 习惯打卡/streak/补卡券/里程碑测试（v3.21.0 激励系统）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { HabitManager } from '../js/habit-manager.js';

function newHM(initial = {}) {
  const fm = mockFm(initial);
  const hm = new HabitManager(fm);
  return { fm, hm };
}

// 与 HabitManager._getToday/_addDays 同口径的本地时区日期工具
const pad = (n) => String(n).padStart(2, '0');
const today = (() => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
})();
const shift = (dateStr, days) => {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const yesterday = shift(today, -1);

// 直接写入打卡记录（checkin() 只能打今天，造历史数据需直写文件；多次调用合并追加）
function seedCheckins(hm, habitId, dates, amount = 1) {
  const existing = JSON.parse(hm.fm.files.get('.meta/habit-checkins.json') || '[]');
  const records = dates.map((d, i) => ({ id: `c-${habitId}-${i}`, habitId, date: d, amount, note: '', timestamp: d }));
  hm.fm.files.set('.meta/habit-checkins.json', JSON.stringify(existing.concat(records)));
}

async function seedHabit(hm, overrides = {}) {
  return hm.addHabit({ name: '喝水', icon: '💧', unit: 'L', dailyGoal: 2, ...overrides });
}

// ===== streak 计算 =====

describe('calculateStreak', () => {
  test('连续打卡（含今天）：逐日回退计数', async () => {
    const { hm } = newHM();
    const h = await seedHabit(hm);
    await seedCheckins(hm, h.id, [today, yesterday, shift(today, -2)]);
    assert.equal(await hm.calculateStreak(h.id), 3);
  });

  test('今天未打卡但昨天打了：不中断，从昨天起算', async () => {
    const { hm } = newHM();
    const h = await seedHabit(hm);
    await seedCheckins(hm, h.id, [yesterday, shift(today, -2), shift(today, -3)]);
    assert.equal(await hm.calculateStreak(h.id), 3);
  });

  test('昨天断档：streak 归零（历史连续也不救）', async () => {
    const { hm } = newHM();
    const h = await seedHabit(hm);
    await seedCheckins(hm, h.id, [today, shift(today, -2), shift(today, -3)]);
    assert.equal(await hm.calculateStreak(h.id), 1);
    const h2 = await seedHabit(hm, { name: '步行' });
    await seedCheckins(hm, h2.id, [shift(today, -3), shift(today, -4)]);
    assert.equal(await hm.calculateStreak(h2.id), 0);
  });

  test('无打卡记录：0', async () => {
    const { hm } = newHM();
    const h = await seedHabit(hm);
    assert.equal(await hm.calculateStreak(h.id), 0);
  });
});

// ===== 补卡券 =====

describe('补卡券', () => {
  test('makeupCheckin：补昨天成功，写入 makeup 标记，streak 自动接上', async () => {
    const { hm, fm } = newHM();
    const h = await seedHabit(hm);
    // 前天打了、昨天漏了 → streak 0
    await seedCheckins(hm, h.id, [shift(today, -2)]);
    assert.equal(await hm.calculateStreak(h.id), 0);

    const r = await hm.makeupCheckin(h.id, yesterday);
    assert.equal(r.success, true);
    assert.equal(r.checkin.makeup, true);
    assert.equal(r.checkin.date, yesterday);
    assert.equal(r.checkin.amount, 2, '补卡按 dailyGoal 记满额');

    const checkins = JSON.parse(fm.files.get('.meta/habit-checkins.json'));
    assert.equal(checkins.filter((c) => c.makeup).length, 1, '补卡记录带 makeup 标记');
    assert.equal(await hm.calculateStreak(h.id), 2, 'streak 接上（昨天+前天）');

    const quota = await hm.getMakeupQuota();
    assert.equal(quota.usedThisWeek, 1);
    assert.equal(quota.canUse, false, '本周券已用完');
  });

  test('makeupCheckin：只能补昨天', async () => {
    const { hm } = newHM();
    const h = await seedHabit(hm);
    for (const date of [today, shift(today, -2), '2020-01-01']) {
      const r = await hm.makeupCheckin(h.id, date);
      assert.equal(r.success, false);
      assert.equal(r.reason, 'invalid_date');
    }
    assert.equal(await hm.getMakeupQuota().then((q) => q.usedThisWeek), 0, '拒绝不消耗配额');
  });

  test('makeupCheckin：每周限 1 张，周切换自动重置', async () => {
    const { hm, fm } = newHM();
    const h1 = await seedHabit(hm, { name: '喝水' });
    const h2 = await seedHabit(hm, { name: '步行' });
    const r1 = await hm.makeupCheckin(h1.id, yesterday);
    assert.equal(r1.success, true);
    const r2 = await hm.makeupCheckin(h2.id, yesterday);
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'quota_exhausted');

    // 模拟上周的配额记录 → 本周重置可用
    await fm.writeFile('.meta/habit-makeup.json', JSON.stringify({ weekKey: '1999-W01', usedCount: 1, records: [] }));
    const quota = await hm.getMakeupQuota();
    assert.equal(quota.canUse, true, '周切换后配额重置');
    const r3 = await hm.makeupCheckin(h2.id, yesterday);
    assert.equal(r3.success, true);
    const state = JSON.parse(fm.files.get('.meta/habit-makeup.json'));
    assert.equal(state.usedCount, 1, '新周从 1 重新计（旧周记录不叠加）');
    assert.equal(state.records.length, 1, '旧周补卡记录不带入新周');
  });

  test('makeupCheckin：习惯不存在/已删除拒绝', async () => {
    const { hm } = newHM();
    const r = await hm.makeupCheckin('不存在', yesterday);
    assert.equal(r.success, false);
    assert.equal(r.reason, 'no_habit');
    const h = await seedHabit(hm);
    await hm.deleteHabit(h.id);
    const r2 = await hm.makeupCheckin(h.id, yesterday);
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'no_habit');
  });

  test('getYesterdayUnmetHabits：只列昨日未达标', async () => {
    const { hm, fm } = newHM();
    const met = await seedHabit(hm, { name: '喝水', dailyGoal: 2 });
    const unmet = await seedHabit(hm, { name: '步行', dailyGoal: 8000 });
    await seedCheckins(hm, met.id, [yesterday], 2);      // 达标
    await seedCheckins(hm, unmet.id, [yesterday], 3000); // 未达标
    const list = await hm.getYesterdayUnmetHabits();
    assert.deepEqual(list.map((h) => h.name), ['步行']);
    // 昨天没打的也算未达标
    await fm.writeFile('.meta/habit-checkins.json', '[]');
    const all = await hm.getYesterdayUnmetHabits();
    assert.equal(all.length, 2);
  });
});

// ===== 习惯概览与里程碑 =====

describe('getHabitOverview / isMilestone / 周号', () => {
  test('getHabitOverview：当日达标数 + 最大 streak', async () => {
    const { hm } = newHM();
    const a = await seedHabit(hm, { name: '喝水', dailyGoal: 2 });
    const b = await seedHabit(hm, { name: '步行', dailyGoal: 1 });
    await seedCheckins(hm, a.id, [today, yesterday, shift(today, -2)], 2); // 今天达标，streak 3
    await seedCheckins(hm, b.id, [yesterday], 1);                          // 今天没打，streak 2（昨天起算）
    const ov = await hm.getHabitOverview();
    assert.equal(ov.totalCount, 2);
    assert.equal(ov.doneCount, 1);
    assert.equal(ov.maxStreak, 3);
  });

  test('isMilestone：7/21/50/100 命中', () => {
    assert.equal(HabitManager.isMilestone(7), true);
    assert.equal(HabitManager.isMilestone(21), true);
    assert.equal(HabitManager.isMilestone(50), true);
    assert.equal(HabitManager.isMilestone(100), true);
    for (const n of [0, 1, 6, 22, 49, 99, 101]) assert.equal(HabitManager.isMilestone(n), false, `streak=${n} 非里程碑`);
  });

  test('_getWeekKey：ISO 周（周一为一周起点）', () => {
    const { hm } = newHM();
    assert.equal(hm._getWeekKey('2026-01-01'), '2026-W01');
    assert.equal(hm._getWeekKey('2026-11-16'), hm._getWeekKey('2026-11-22'), '周一~周日同周');
    assert.notEqual(hm._getWeekKey('2026-11-22'), hm._getWeekKey('2026-11-23'), '周一开启新周');
    assert.match(hm._getWeekKey('2026-11-17'), /^\d{4}-W\d{2}$/);
  });
});
