// cultivation-manager.test.js — 修仙系统测试（v3.27.0）：创建/行为奖励/修行速度/道心/心魔/渡劫/转世/坊市/机缘/洞府
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { CultivationManager } from '../js/cultivation-manager.js';

function newCM(initial = {}) {
  const fm = mockFm(initial);
  const cm = new CultivationManager(fm);
  return { fm, cm };
}

// 与 CultivationManager._getToday 同口径的本地时区日期工具
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
// 境界门槛（v3.28.0 节奏重调，测试全部动态引用）
const T1 = CultivationManager.LEVELS[1]; // 炼气→筑基 240
const T9 = CultivationManager.LEVELS[9]; // →金仙 26000

// 直接注入状态（绕过创建流程，字段同 startJourney）
async function seedCultivation(cm, overrides = {}) {
  const base = {
    version: 1,
    createdAt: new Date().toISOString(),
    daoName: '青崖',
    root: 'water',
    aptitude: 'mortal',
    reincarnations: 0,
    background: { text: '这一世，你出身凡俗，机缘巧合踏上仙途。', perk: null },
    exp: 0,
    level: 1,
    realm: 1, // 当前境界（渡劫提升；与 level 同步）
    stones: 20,
    mind: 60,
    demon: 0,
    injured: 0,
    dead: false,
    lastTickDate: null,
    streak: 0,
    bestStreak: 0,
    lastActiveDate: null,
    allDoneStreak: 0,
    partialStreak: 0,
    inventory: {},
    behavior: { date: today, checkins: {}, meals: 0, weights: 0, fortune: 0, explore: 0, allDone: false, mindToday: 0 },
    log: []
  };
  const merged = { ...base, ...overrides };
  if (overrides.background) merged.background = { ...base.background, ...overrides.background };
  if (overrides.behavior) merged.behavior = { ...base.behavior, ...overrides.behavior };
  merged.level = merged.realm; // level 随 realm 同步（同 _commit 口径）
  cm.fm.files.set('.meta/cultivation-state.json', JSON.stringify(merged));
  return merged;
}

function readState(cm) {
  return JSON.parse(cm.fm.files.get('.meta/cultivation-state.json'));
}

// 注入确定性随机序列
function seedRand(cm, seq) {
  cm._rand = () => seq.shift() ?? 0.99;
}

// ===== 创建 =====

describe('踏入仙途', () => {
  test('ensureStarted：无状态返回 null；startJourney 建初始状态（20灵石/道心60/心魔0/start日志）', async () => {
    const { cm } = newCM();
    assert.equal(await cm.ensureStarted(), null);
    const { state, created } = await cm.startJourney('fire', '丹阳');
    assert.equal(created, true);
    assert.equal(state.daoName, '丹阳');
    assert.equal(state.root, 'fire');
    assert.equal(state.stones, 20);
    assert.equal(state.mind, 60);
    assert.equal(state.demon, 0);
    assert.equal(state.level, 1);
    assert.equal(state.log.length, 1);
    assert.equal(state.log[0].type, 'start');
  });

  test('重复 startJourney 不重建（created:false）', async () => {
    const { cm } = newCM();
    await cm.startJourney('wood', '青木');
    const { state, created } = await cm.startJourney('metal', '金锋');
    assert.equal(created, false);
    assert.equal(state.daoName, '青木');
  });

  test('空道号兜底"无名散修"，超长截断 8 字', async () => {
    const { cm } = newCM();
    const { state } = await cm.startJourney('metal', '   ');
    assert.equal(state.daoName, '无名散修');
    const { cm: cm2 } = newCM();
    const { state: s2 } = await cm2.startJourney('metal', '一二三四五六七八九');
    assert.equal(s2.daoName, '一二三四五六七八');
  });

  test('rollAptitude 加权分布：r<0.05 天品/<0.20 地品/<0.50 灵品/其余凡品', () => {
    assert.equal(CultivationManager.rollAptitude(0.01), 'heavenly');
    assert.equal(CultivationManager.rollAptitude(0.10), 'earthly');
    assert.equal(CultivationManager.rollAptitude(0.30), 'spiritual');
    assert.equal(CultivationManager.rollAptitude(0.99), 'mortal');
  });
});

// ===== 境界计算 =====

describe('realmOf 境界计算', () => {
  test('exp 阈值边界：LEVELS[i]-1 仍在第 i 境，达到即下一境；满级钳制', () => {
    assert.equal(CultivationManager.realmOf(0).name, '炼气');
    assert.equal(CultivationManager.realmOf(T1 - 1).level, 1);
    assert.equal(CultivationManager.realmOf(T1).name, '筑基');
    assert.equal(CultivationManager.realmOf(T9).level, 10);
    assert.equal(CultivationManager.realmOf(T9 * 10).level, 10);
  });

  test('REALMS 十境界命名', () => {
    assert.deepEqual(CultivationManager.REALMS, ['炼气', '筑基', '金丹', '元婴', '化神', '合体', '大乘', '渡劫', '真仙', '金仙']);
  });
});

// ===== 行为奖励 =====

describe('行为奖励', () => {
  test('吐纳（打卡）：基础速度下修为+8；同习惯当日去重', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { root: 'metal' }); // 金灵根亲和运动，吐纳不吃加成
    const r = await cm.onCheckin('habit-1');
    assert.equal(r.exp, 8);
    assert.equal(readState(cm).exp, 8);
    assert.equal(await cm.onCheckin('habit-1'), null);
  });

  test('打卡道心 +1，日封顶 +5', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    for (let i = 0; i < 5; i++) await cm.onCheckin(`h${i}`);
    assert.equal(readState(cm).mind, 65);
    await cm.onCheckin('h6');
    assert.equal(readState(cm).mind, 65); // 封顶
  });

  test('周天圆满（allDone）：+5 灵石、道心+6（打卡+1 与圆满+5）、心魔-8', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 20 });
    const r = await cm.onCheckin('h1', { allDone: true });
    assert.equal(r.stones, 5);
    const s = readState(cm);
    assert.equal(s.stones, 25);
    assert.equal(s.mind, 66);
    assert.equal(s.demon, 12);
    assert.equal(await cm.onCheckin('h1', { allDone: true }), null); // 打卡与全达标均已去重
  });

  test('服用灵膳（三餐）：日限 3 次，每次修为+5', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.onMeal();
    await cm.onMeal();
    const r = await cm.onMeal();
    assert.equal(r.exp, 5);
    assert.equal(readState(cm).exp, 15);
    assert.equal(await cm.onMeal(), null);
  });

  test('内视探脉（称重）：日限 1 次，修为+15', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    const r = await cm.onWeight();
    assert.equal(r.exp, 15);
    assert.equal(await cm.onWeight(), null);
  });

  test('打坐炼体（运动）：不限次，修为+10', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.onExercise();
    await cm.onExercise();
    const r = await cm.onExercise();
    assert.equal(r.exp, 10);
    assert.equal(readState(cm).exp, 30);
  });

  test('身死状态：一切行为奖励拒绝（返回 null）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true });
    assert.equal(await cm.onCheckin('h1'), null);
    assert.equal(await cm.onMeal(), null);
    assert.equal(await cm.onExercise(), null);
    assert.equal(await cm.onWeight(), null);
  });
});

// ===== 灵根亲和与修行速度 =====

describe('灵根亲和', () => {
  test('金灵根：打坐炼体（运动）修为 ×1.25 → +13', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { root: 'metal' });
    const r = await cm.onExercise();
    assert.equal(r.exp, 13);
  });

  test('木灵根：灵膳 ×1.25 → +6；水灵根：吐纳 ×1.25 → +10；火灵根：内视 ×1.25 → +19', async () => {
    const { cm: cmWood } = newCM();
    await seedCultivation(cmWood, { root: 'wood' });
    assert.equal((await cmWood.onMeal()).exp, 6);

    const { cm: cmWater } = newCM();
    await seedCultivation(cmWater, { root: 'water' });
    assert.equal((await cmWater.onCheckin('h1')).exp, 10);

    const { cm: cmFire } = newCM();
    await seedCultivation(cmFire, { root: 'fire' });
    assert.equal((await cmFire.onWeight()).exp, 19);
  });

  test('非亲和行为不吃加成（水灵根运动仍为 +10）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { root: 'water' });
    assert.equal((await cm.onExercise()).exp, 10);
  });

  test('rootAffinityBonus：亲和行为 +0.25，其余 0', () => {
    assert.equal(CultivationManager.rootAffinityBonus('metal', 'exercise'), 0.25);
    assert.equal(CultivationManager.rootAffinityBonus('metal', 'checkin'), 0);
    assert.equal(CultivationManager.rootAffinityBonus('earth', 'exercise'), 0);
  });
});

describe('修行速度公式', () => {
  const base = { aptitude: 'mortal', reincarnations: 0, streak: 0, mind: 60, background: { perk: null } };

  test('连续打卡每天 +2%，streak=5 → 1.10；15 天封顶 +30%（streak=20 → 1.30）', () => {
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, streak: 5 }) - 1.10) < 0.001);
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, streak: 20 }) - 1.30) < 0.001);
  });

  test('转世悟性：每世 +5%', () => {
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, reincarnations: 2 }) - 1.10) < 0.001);
  });

  test('资质倍率：天品 1.5', () => {
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, aptitude: 'heavenly' }) - 1.5) < 0.001);
  });

  test('道心修正：≥80 → +10%；<30 → -20%', () => {
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, mind: 85 }) - 1.10) < 0.001);
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, mind: 20 }) - 0.80) < 0.001);
  });

  test('家世 perk speed3 → +3%', () => {
    assert.ok(Math.abs(CultivationManager.speedMultiplier({ ...base, background: { perk: 'speed3' } }) - 1.03) < 0.001);
  });

  test('速度叠加：streak5 + 转世2世 + 道心85 → 1+0.1+0.1+0.1=1.30', () => {
    const m = CultivationManager.speedMultiplier({ ...base, streak: 5, reincarnations: 2, mind: 85 });
    assert.ok(Math.abs(m - 1.30) < 0.001);
  });

  test('expGainFactor：伤势与心魔爆发各减半', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { injured: 2 });
    assert.equal((await cm.onExercise()).exp, 5); // 10×0.5
    const { cm: cm2 } = newCM();
    await seedCultivation(cm2, { demon: 100 });
    assert.equal((await cm2.onExercise()).exp, 5); // 10×0.5
  });
});

// ===== 连续活跃 streak =====

describe('连续活跃 streak', () => {
  test('昨日活跃则 +1，断日重计为 1', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 5, lastActiveDate: yesterday });
    await cm.onCheckin('h1');
    assert.equal(readState(cm).streak, 6);
    const { cm: cm2 } = newCM();
    await seedCultivation(cm2, { streak: 5, lastActiveDate: shift(today, -3) });
    await cm2.onCheckin('h1');
    assert.equal(readState(cm2).streak, 1);
  });

  test('tickDaily：昨日完全断签且今日未打卡 → streak 清零', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 5, lastActiveDate: shift(today, -2) });
    const r = await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 0, allDone: false });
    assert.equal(r.changed, true);
    assert.equal(readState(cm).streak, 0);
  });

  test('tickDaily 幂等：同昨日重复调用 changed:false', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { lastTickDate: yesterday });
    const r = await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 3, allDone: true });
    assert.equal(r.changed, false);
  });

  // v3.30.3：连续活跃 = 任意修行行为（打卡/三餐/运动/称重/探索/渡劫）
  test('三餐/运动/称重均推进连续活跃（首次 streak=1，lastActiveDate=今日）', async () => {
    for (const hook of ['onMeal', 'onExercise', 'onWeight']) {
      const { cm } = newCM();
      await seedCultivation(cm);
      await cm[hook]();
      const st = readState(cm);
      assert.equal(st.streak, 1, `${hook} 应推进 streak`);
      assert.equal(st.lastActiveDate, today, `${hook} 应更新 lastActiveDate`);
    }
  });

  test('同日多次行为不重复计数（streak 仍 1，bestStreak 1）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.onMeal();
    await cm.onExercise();
    await cm.onCheckin('h1');
    const st = readState(cm);
    assert.equal(st.streak, 1);
    assert.equal(st.bestStreak, 1);
  });

  test('洞府探索推进连续活跃', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 2, lastActiveDate: yesterday });
    await cm.consumeExplore();
    assert.equal(readState(cm).streak, 3);
  });

  test('渡劫尝试推进连续活跃', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1, inventory: { zhuji: 1 } });
    seedRand(cm, [0.5]); // 成功
    await cm.attemptBreakthrough();
    const st = readState(cm);
    assert.equal(st.streak, 1);
    assert.equal(st.lastActiveDate, today);
  });

  test('tickDaily：昨日有任意修行行为（lastActiveDate=昨日）→ streak 不清零', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 5, lastActiveDate: yesterday });
    const r = await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 0, allDone: false });
    assert.equal(r.changed, true);
    assert.equal(readState(cm).streak, 5);
  });

  test('tickDaily 断签清零日志文案：数日未有修行', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 5, lastActiveDate: shift(today, -2) });
    await cm.tickDaily(yesterday, { hasHabits: false });
    const st = readState(cm);
    assert.equal(st.streak, 0);
    assert.ok(st.log.some(l => l.text.includes('数日未有修行')));
  });
});

// ===== 修为下限 invariant 校准（v3.30.3）=====

describe('修为下限校准', () => {
  test('修为低于本境下限 → 载入自动校准 + 日志 + version 2', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { realm: 2, exp: 100, version: 1 }); // 筑基下限 240
    const st = await cm.getState();
    assert.equal(st.exp, CultivationManager.LEVELS[1]);
    assert.equal(st.version, 2);
    assert.ok(st.log.some(l => l.type === 'migrate' && l.text.includes('修为校准')));
  });

  test('修为正常不动（不触发校准日志）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { realm: 2, exp: 500, version: 2 });
    const st = await cm.getState();
    assert.equal(st.exp, 500);
    assert.ok(!st.log.some(l => l.type === 'migrate'));
  });

  test('startJourney 新档 version 2', async () => {
    const { cm } = newCM();
    const { state } = await cm.startJourney('water', '青崖');
    assert.equal(state.version, 2);
  });
});

// ===== 道心/心魔结算 =====

describe('道心/心魔', () => {
  test('tickDaily 部分达标：心魔 +5；连续 2 天部分达标 +10', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { partialStreak: 1 });
    await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 2, allDone: false });
    assert.equal(readState(cm).demon, 10);
  });

  test('tickDaily 断签日：道心 -5、心魔 +5', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 0, allDone: false });
    const s = readState(cm);
    assert.equal(s.mind, 55);
    assert.equal(s.demon, 5);
  });

  test('tickDaily 全达标：连续 2 天额外 -30（第 1 天不减）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 50, allDoneStreak: 1 });
    await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 3, allDone: true });
    assert.equal(readState(cm).demon, 20);
  });

  test('道心 <20：每日心魔自增 +5', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { mind: 15 });
    await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 3, allDone: true });
    // 全达标不减（demon=0 clamp），但道心低迷自增 +5
    assert.equal(readState(cm).demon, 5);
  });

  test('土灵根：心魔滋生 -20%（+5 → +4）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { root: 'earth' });
    await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 0, allDone: false });
    assert.equal(readState(cm).demon, 4);
  });

  test('心魔爆发：demon≥100 → 修为 ×0.9、demonBursted=true', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 100, exp: 100 });
    const r = await cm.tickDaily(yesterday, { hasHabits: false });
    assert.equal(r.demonBursted, true);
    assert.equal(readState(cm).exp, 90);
  });

  test('身死态 tickDaily 冻结（changed:false）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true });
    const r = await cm.tickDaily(yesterday, { hasHabits: true, checkinCount: 0, allDone: false });
    assert.equal(r.changed, false);
  });
});

// ===== 渡劫与突破 =====

describe('渡劫成功率', () => {
  const st = (over = {}) => ({ realm: 1, aptitude: 'mortal', injured: 0, mind: 60, ...over });

  test('基础表：目标 2→0.85 … 10→0.35', () => {
    assert.equal(CultivationManager.tribulationRate(st()), 0.85);
    assert.equal(CultivationManager.tribulationRate(st({ realm: 9 })), 0.35);
    assert.equal(CultivationManager.tribulationRate(st({ realm: 4 })), 0.66);
  });

  test('修正：天品 +5%、伤势 -15%、道心<30 -10%', () => {
    assert.equal(CultivationManager.tribulationRate(st({ aptitude: 'heavenly' })), 0.90);
    assert.equal(CultivationManager.tribulationRate(st({ injured: 2 })), 0.70);
    assert.equal(CultivationManager.tribulationRate(st({ mind: 20 })), 0.75);
  });

  test('钳制与满级：多重惩罚约 0.10，满级（realm 10）无成功率', () => {
    // realm 9 基础 0.35 - 伤势 0.15 - 道心低迷 0.10 ≈ 0.10
    assert.ok(Math.abs(CultivationManager.tribulationRate(st({ realm: 9, injured: 3, mind: 10 })) - 0.10) < 1e-9);
    assert.equal(CultivationManager.tribulationRate(st({ realm: 10 })), 0);
  });
});

describe('渡劫流程', () => {
  test('未圆满拒绝（reason:not_full）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1 - 10, inventory: { zhuji: 1 } });
    const r = await cm.attemptBreakthrough();
    assert.equal(r.success, false);
    assert.equal(r.reason, 'not_full');
  });

  test('无丹拒绝（reason:no_pill）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1 });
    const r = await cm.attemptBreakthrough();
    assert.equal(r.reason, 'no_pill');
  });

  test('成功路径：丹耗、境界突破（rand=0.5 < 0.85）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1, inventory: { zhuji: 1 } });
    seedRand(cm, [0.5]);
    const r = await cm.attemptBreakthrough();
    assert.equal(r.success, true);
    assert.equal(r.died, false);
    assert.equal(r.realm.name, '筑基');
    const s = readState(cm);
    assert.equal(s.level, 2);
    assert.equal(s.realm, 2);
    assert.equal(s.inventory.zhuji, 0);
  });

  test('失败路径：修为退回门槛 90%、重伤 3 天（rand=0.99）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1, inventory: { zhuji: 1 } });
    seedRand(cm, [0.99, 0.99]);
    const r = await cm.attemptBreakthrough();
    assert.equal(r.success, false);
    assert.equal(r.died, false);
    const s = readState(cm);
    assert.equal(s.exp, Math.floor(T1 * 0.9));
    assert.equal(s.injured, 3);
  });

  test('失败中 15% 身死（rand=0.99 → 失败，0.01 → 身死）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1, inventory: { zhuji: 1 } });
    seedRand(cm, [0.99, 0.01]);
    const r = await cm.attemptBreakthrough();
    assert.equal(r.died, true);
    assert.equal(readState(cm).dead, true);
  });

  test('机缘突破：修为圆满时直接成功免渡劫（突破ByFortune）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1 });
    const realm = await cm.breakthroughByFortune('前辈灌顶');
    assert.equal(realm.name, '筑基');
    assert.equal(readState(cm).realm, 2);
  });

  test('机缘突破：未圆满返回 null', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: 10 });
    assert.equal(await cm.breakthroughByFortune('灌顶'), null);
  });

  test('身死后 attemptBreakthrough 拒绝（reason:dead）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true, exp: T1, inventory: { zhuji: 1 } });
    const r = await cm.attemptBreakthrough();
    assert.equal(r.reason, 'dead');
  });
});

// ===== 转世重修 =====

describe('转世重修', () => {
  test('非身死拒绝转世（reason:not_dead）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    const r = await cm.reincarnate({ text: '这一世转世为商户之子，家境殷实。', perk: 'stones20' });
    assert.equal(r.reason, 'not_dead');
  });

  test('身死转世：exp 清零、灵石留 10%、转世+1、灵根继承、家世套用', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true, exp: 500, stones: 100, root: 'fire', aptitude: 'heavenly', demon: 80, injured: 3, streak: 9 });
    const r = await cm.reincarnate({ text: '这一世，你转世为青州富商之子，家中藏书万卷。', perk: 'stones20' });
    assert.equal(r.success, true);
    const s = readState(cm);
    assert.equal(s.exp, 0);
    assert.equal(s.level, 1);
    assert.equal(s.stones, 30); // 100×0.1 + 20 perk
    assert.equal(s.reincarnations, 1);
    assert.equal(s.root, 'fire');
    assert.equal(s.aptitude, 'heavenly');
    assert.equal(s.dead, false);
    assert.equal(s.demon, 0);
    assert.equal(s.injured, 0);
    assert.equal(s.streak, 0);
    assert.equal(s.background.perk, 'stones20');
  });

  test('sanitizeBackground：perk 白名单外置 null，text 过短无效', () => {
    assert.deepEqual(CultivationManager.sanitizeBackground({ text: '这一世转世为将门之后，自幼习武。', perk: 'hack' }), { text: '这一世转世为将门之后，自幼习武。', perk: null });
    assert.equal(CultivationManager.sanitizeBackground({ text: '短', perk: 'speed3' }), null);
    assert.equal(CultivationManager.sanitizeBackground(null), null);
  });

  test('LLM 家世无效时降级模板', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true, stones: 50 });
    await cm.reincarnate(null);
    const s = readState(cm);
    assert.equal(s.stones, 5); // 50×0.1，无 perk 加成
    assert.ok(s.background.text.includes('凡俗农家子'));
  });
});

// ===== 坊市与物品 =====

describe('坊市', () => {
  test('购买突破丹：灵石不足拒绝', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { stones: 5 });
    const r = await cm.buy('zhuji');
    assert.equal(r.reason, 'insufficient_stones');
  });

  test('突破丹境界锁定：高阶丹 reason:pill_locked，已超越的丹无用', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { stones: 500 });
    assert.equal((await cm.buy('ningjin')).reason, 'pill_locked'); // 境界不足
    await seedCultivation(cm, { stones: 500, realm: 5 });
    assert.equal((await cm.buy('zhuji')).reason, 'pill_locked'); // 已于你无用
  });

  test('正常购买：扣灵石、入背包、日志', async () => {
    const { cm } = newCM();
    const price = CultivationManager.getShopItem('zhuji').price;
    await seedCultivation(cm, { stones: price });
    const r = await cm.buy('zhuji');
    assert.equal(r.success, true);
    const s = readState(cm);
    assert.equal(s.stones, 0);
    assert.equal(s.inventory.zhuji, 1);
  });

  test('突破丹不可当普通丹药使用（reason:breakthrough_pill）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { inventory: { zhuji: 1 } });
    assert.equal((await cm.useItem('zhuji')).reason, 'breakthrough_pill');
  });

  test('养气丹修为+80；疗伤丹清伤势；清心丹心魔-40', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { inventory: { yangqi: 1 } });
    assert.equal((await cm.useItem('yangqi')).success, true);
    assert.equal(readState(cm).exp, 80);

    const { cm: cm2 } = newCM();
    await seedCultivation(cm2, { injured: 3, inventory: { liaoshang: 1 } });
    await cm2.useItem('liaoshang');
    assert.equal(readState(cm2).injured, 0);

    const { cm: cm3 } = newCM();
    await seedCultivation(cm3, { demon: 60, inventory: { qingxin: 1 } });
    await cm3.useItem('qingxin');
    assert.equal(readState(cm3).demon, 20);
  });

  test('无物品使用拒绝（reason:no_item）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    assert.equal((await cm.useItem('yangqi')).reason, 'no_item');
  });
});

// ===== 机缘 =====

describe('机缘', () => {
  test('rollFortuneGate：25% 触发、每日上限 2 次', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    seedRand(cm, [0.01]);
    const r = await cm.rollFortuneGate();
    assert.equal(r.triggered, true);
    assert.equal(r.remaining, 1);
    seedRand(cm, [0.01]);
    const r2 = await cm.rollFortuneGate();
    assert.equal(r2.triggered, true);
    assert.equal(r2.remaining, 0);
    seedRand(cm, [0.01]);
    const r3 = await cm.rollFortuneGate();
    assert.equal(r3.triggered, false); // 达上限
  });

  test('rollFortuneGate：rand≥0.25 不触发', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    seedRand(cm, [0.99]);
    const r = await cm.rollFortuneGate();
    assert.equal(r.triggered, false);
    assert.equal(r.remaining, 2);
  });

  test('rollFortuneGate：命中时返回掷签档位 tier', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    seedRand(cm, [0.01, 0.10]); // 触发(0.01<0.25) → tier great(0.10<0.15)
    const r = await cm.rollFortuneGate();
    assert.equal(r.triggered, true);
    assert.equal(r.tier, 'great');
  });

  test('sanitizeFortune：按档钳制（great 修为 -50 → 20；bad 灵石 -999 → -25）', () => {
    const r = CultivationManager.sanitizeFortune({ tier: 'great', stones: 999, exp: -50 });
    assert.equal(r.stones, 60);
    assert.equal(r.exp, 20);
    const r2 = CultivationManager.sanitizeFortune({ tier: 'bad', stones: -999, exp: 999 });
    assert.equal(r2.stones, -25);
    assert.equal(r2.exp, 0);
    const r3 = CultivationManager.sanitizeFortune({ tier: 'good', item: { name: '聚灵丹', kind: 'pill', effect: 'exp', effectValue: 999 } });
    assert.equal(r3.item.effectValue, 30);
  });

  test('sanitizeFortune：tierHint 优先；道具仅大吉/吉档；顿悟仅大吉档', () => {
    const r = CultivationManager.sanitizeFortune({ stones: 999 }, 'bad');
    assert.equal(r.tier, 'bad');
    assert.equal(r.stones, 0); // bad 档钳到 ≤0
    const r2 = CultivationManager.sanitizeFortune({ tier: 'plain', item: { name: 'x', kind: 'pill', effect: 'exp', effectValue: 10 }, breakthrough: true }, 'plain');
    assert.equal(r2.item, undefined);
    assert.equal(r2.breakthrough, undefined);
  });

  test('applyFortune：套用灵石/修为；顿悟突破需修为圆满', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: T1 });
    const r = await cm.applyFortune({ tier: 'great', stones: 50, exp: 10, breakthrough: true, narrative: '路过山洞得前辈灌顶' });
    assert.equal(r.breakthroughReady, true);
    const realm = await cm.breakthroughByFortune('前辈灌顶');
    assert.equal(realm.name, '筑基');
  });

  test('applyFortune：未圆满时 breakthroughReady=false', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: 10 });
    const r = await cm.applyFortune({ tier: 'great', breakthrough: true });
    assert.equal(r.breakthroughReady, false);
  });

  test('applyFortune：tier=none 记无机缘日志', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.applyFortune({ tier: 'none' }, 'none');
    const logs = readState(cm).log;
    assert.ok(logs.some(l => l.type === 'fortune' && l.text.includes('无甚机缘')));
  });
});

// ===== 洞府探索 =====

describe('洞府探索', () => {
  test('consumeExplore：日限 3 次，第 4 次拒绝', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    assert.equal((await cm.consumeExplore()).success, true);
    assert.equal((await cm.consumeExplore()).success, true);
    assert.equal((await cm.consumeExplore()).success, true);
    const r = await cm.consumeExplore();
    assert.equal(r.success, false);
    assert.equal(r.reason, 'limit_reached');
  });

  test('家世 perk explore1：日限 +1', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { background: { perk: 'explore1' } });
    for (let i = 0; i < 4; i++) await cm.consumeExplore();
    assert.equal((await cm.consumeExplore()).reason, 'limit_reached');
  });

  test('sanitizeExploreResult：按档钳制（great 灵石 999→45；plain 灵石 22→10；bad 伤势 9→3）', () => {
    const r = CultivationManager.sanitizeExploreResult({ tier: 'great', stones: 999, exp: 999 });
    assert.equal(r.stones, 45);
    assert.equal(r.exp, 30);
    const r2 = CultivationManager.sanitizeExploreResult({ tier: 'plain', stones: 22, exp: 1 });
    assert.equal(r2.stones, 10);
    assert.equal(r2.exp, 3); // plain 档下限 3
    const r3 = CultivationManager.sanitizeExploreResult({ tier: 'bad', injuryDays: 9 });
    assert.equal(r3.injuryDays, 3);
    const r4 = CultivationManager.sanitizeExploreResult({ tier: 'bad', stones: -50 });
    assert.equal(r4.stones, -15); // bad 档下限 -15
  });

  test('sanitizeExploreResult：突破丹/道具/顿悟仅对应档位；tierHint 优先', () => {
    const r = CultivationManager.sanitizeExploreResult({ tier: 'good', pillKey: 'zhuji', breakthrough: true }, 'good');
    assert.equal(r.pillKey, undefined); // 突破丹仅大吉
    assert.equal(r.breakthrough, undefined);
    const r2 = CultivationManager.sanitizeExploreResult({ pillKey: 'zhuji', item: { name: 'x', kind: 'pill', effect: 'exp', effectValue: 10 }, breakthrough: true }, 'great');
    assert.equal(r2.pillKey, 'zhuji');
    assert.equal(r2.breakthrough, true);
    assert.ok(r2.item);
    const r3 = CultivationManager.sanitizeExploreResult({ tier: 'weird', stones: 1 }, 'weird');
    assert.equal(r3.tier, 'plain');
    const r4 = CultivationManager.sanitizeExploreResult({ pillKey: 'fake-pill' }, 'great');
    assert.equal(r4.pillKey, undefined);
  });

  test('applyExploreResult：套用灵石/修为/伤势/道具入包', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    const r = await cm.applyExploreResult({ tier: 'great', stones: 30, exp: 20, item: { name: '聚灵丹', kind: 'pill', effect: 'exp', effectValue: 15 }, narrative: '古修遗府，得一玉瓶' });
    const s = readState(cm);
    assert.equal(s.stones, 50);
    assert.equal(s.exp, 20);
    assert.equal(r.tier, 'great');
    const invKeys = Object.keys(s.inventory);
    assert.equal(invKeys.length, 1);
    assert.equal((await cm.getCustomItems())[0].name, '聚灵丹');
  });

  test('applyExploreResult：突破丹直接入背包', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.applyExploreResult({ tier: 'great', pillKey: 'zhuji' });
    assert.equal(readState(cm).inventory.zhuji, 1);
  });
});

// ===== 小境界（v3.29.0：每境初期/中期/后期/大圆满四段）=====

describe('小境界', () => {
  test('realmOfState 按境内进度分 4 段：0/25%/50%/75%', () => {
    const span = T1 - 0; // 炼气境 0→240
    const st = (exp) => CultivationManager.realmOfState({ realm: 1, exp });
    assert.equal(st(0).subName, '初期');
    assert.equal(st(Math.floor(span * 0.25)).subName, '中期');
    assert.equal(st(Math.floor(span * 0.5)).subName, '后期');
    assert.equal(st(Math.floor(span * 0.75)).subName, '大圆满');
    assert.equal(st(T1).subName, '大圆满'); // 圆满未突破仍是大圆满
    assert.equal(st(0).fullName, '炼气·初期');
  });

  test('满级（realm 10）恒为大圆满', () => {
    const r = CultivationManager.realmOfState({ realm: 10, exp: 99999 });
    assert.equal(r.subName, '大圆满');
    assert.equal(r.fullName, '金仙·大圆满');
  });

  test('跨小境界记「境界精进」日志', async () => {
    const { cm } = newCM();
    // 炼气 0→240：235 + 10 修为 → 245？不，235+10=245 已破境；用 55+10=65 跨 60（25%）
    await seedCultivation(cm, { exp: 55, root: 'metal' }); // 金灵根运动亲和 +25% → +13
    await cm.onExercise(); // 55 → 68，跨过 60 → 中期
    const logs = readState(cm).log;
    assert.ok(logs.some(l => l.type === 'subrealm' && l.text.includes('炼气·中期')));
  });

  test('summaryLine 含小境界名', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: Math.floor(T1 * 0.3) }); // 炼气·中期
    assert.ok((await cm.summaryLine()).includes('炼气中期'));
  });
});

// ===== 天道掷签（v3.28.0）=====

describe('天道掷签', () => {
  test('rollExploreTier 按权重分布：great/good/plain/bad', () => {
    assert.equal(CultivationManager.rollExploreTier(0.10), 'great'); // <0.20
    assert.equal(CultivationManager.rollExploreTier(0.40), 'good');  // <0.50
    assert.equal(CultivationManager.rollExploreTier(0.60), 'plain'); // <0.75
    assert.equal(CultivationManager.rollExploreTier(0.90), 'bad');   // 其余
  });

  test('rollFortuneTier 按权重分布：great/good/plain/bad/none', () => {
    assert.equal(CultivationManager.rollFortuneTier(0.10), 'great'); // <0.15
    assert.equal(CultivationManager.rollFortuneTier(0.30), 'good');  // <0.45
    assert.equal(CultivationManager.rollFortuneTier(0.60), 'plain'); // <0.70
    assert.equal(CultivationManager.rollFortuneTier(0.80), 'bad');   // <0.85
    assert.equal(CultivationManager.rollFortuneTier(0.95), 'none');  // 其余
  });
});

// ===== 生平档案（v3.28.0：每一世一个文档）=====

describe('生平档案', () => {
  test('startJourney 创建第 1 世生平文档（道号/灵根/分段骨架）', async () => {
    const { cm, fm } = newCM();
    const { state } = await cm.startJourney('fire', '丹阳');
    const path = CultivationManager.lifeDocPath(state);
    assert.equal(path, 'cultivation/life-1.md');
    const text = fm.files.get(path);
    assert.ok(text.includes('第1世 · 丹阳 修仙传'));
    assert.ok(text.includes('火灵根'));
    assert.ok(text.includes('## 修行纪事'));
  });

  test('身死落笔：渡劫身死后当世文档末尾记卒于', async () => {
    const { cm, fm } = newCM();
    const { state } = await cm.startJourney('water', '青崖');
    const raw = JSON.parse(fm.files.get('.meta/cultivation-state.json'));
    raw.exp = T1;
    raw.inventory = { zhuji: 1 };
    fm.files.set('.meta/cultivation-state.json', JSON.stringify(raw));
    seedRand(cm, [0.99, 0.01]);
    const r = await cm.attemptBreakthrough();
    assert.equal(r.died, true);
    const text = fm.files.get(CultivationManager.lifeDocPath(state));
    assert.ok(text.includes('卒于'));
    assert.ok(text.includes('天雷灭体'));
  });

  test('转世创建下一世文档（含前世行），getLifeDoc 读取', async () => {
    const { cm, fm } = newCM();
    const { state } = await cm.startJourney('metal', '金锋');
    const raw = JSON.parse(fm.files.get('.meta/cultivation-state.json'));
    raw.dead = true;
    fm.files.set('.meta/cultivation-state.json', JSON.stringify(raw));
    const r = await cm.reincarnate({ text: '这一世，你转世为青州富商之子，家中藏书万卷。', perk: 'stones20' });
    assert.equal(r.success, true);
    const path = CultivationManager.lifeDocPath(r.state);
    assert.equal(path, 'cultivation/life-2.md');
    const text = fm.files.get(path);
    assert.ok(text.includes('第2世'));
    assert.ok(text.includes('前世'));
    const doc = await cm.getLifeDoc();
    assert.equal(doc.path, path);
    assert.ok(doc.text.includes('青州富商之子'));
  });

  test('saveLifeDoc 落盘当前世文档', async () => {
    const { cm, fm } = newCM();
    const { state } = await cm.startJourney('wood', '青木');
    assert.equal(await cm.saveLifeDoc('# 续写测试\n\n新内容'), true);
    assert.ok(fm.files.get(CultivationManager.lifeDocPath(state)).includes('续写测试'));
  });
});

// ===== 日志与摘要 =====

describe('日志与摘要', () => {
  test('buildDayMd：无事件 → 占位文案；有事件 → 时间序列表', () => {
    const empty = CultivationManager.buildDayMd(today, []);
    assert.ok(empty.includes('（今日暂无修行动态）'));
    const md = CultivationManager.buildDayMd(today, [{ time: '08:00', type: 'reward', text: '吐纳：修为 +8' }]);
    assert.ok(md.includes('## 修行动态'));
    assert.ok(md.includes('- 08:00 吐纳：修为 +8'));
    assert.ok(md.includes('AI 只读'));
  });

  test('日志滚动 60 条', () => {
    const { cm } = newCM();
    const st = { log: [] };
    for (let i = 0; i < 70; i++) cm._addLog(st, 'reward', `第 ${i} 条`);
    assert.equal(st.log.length, 60);
    assert.equal(st.log[st.log.length - 1].text, '第 69 条');
  });

  test('summaryLine：含道号/灵根资质/境界/灵石/道心/心魔', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { streak: 3, reincarnations: 1, exp: T1 }); // 炼气圆满未突破
    const line = await cm.summaryLine();
    assert.ok(line.includes('青崖'));
    assert.ok(line.includes('水灵根'));
    assert.ok(line.includes('炼气'));
    assert.ok(line.includes(`修为${T1}/${T1}`));
    assert.ok(line.includes('灵石20'));
    assert.ok(line.includes('道心60'));
    assert.ok(line.includes('心魔0'));
    assert.ok(line.includes('第 2 世'));
    assert.ok(line.includes('可渡劫突破'));
  });

  test('summaryLine：心魔爆发/重伤状态文案', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 100 });
    assert.ok((await cm.summaryLine()).includes('心魔爆发中'));
    const { cm: cm2 } = newCM();
    await seedCultivation(cm2, { injured: 2 });
    assert.ok((await cm2.summaryLine()).includes('重伤中'));
  });

  test('extractJson：容错 code fence 与前后杂文', () => {
    assert.deepEqual(CultivationManager.extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(CultivationManager.extractJson('前言 {"a":1} 后记'), { a: 1 });
    assert.equal(CultivationManager.extractJson('没有JSON'), null);
  });
});

// ===== 心境裁定（v3.30.0：聊天内容 → 道心/心魔/修为）=====

describe('心境裁定', () => {
  test('sanitizeMoodEvents：非数组/空数组 → null', () => {
    assert.equal(CultivationManager.sanitizeMoodEvents(null), null);
    assert.equal(CultivationManager.sanitizeMoodEvents([]), null);
    assert.equal(CultivationManager.sanitizeMoodEvents({ events: [] }), null);
    assert.equal(CultivationManager.sanitizeMoodEvents('junk'), null);
  });

  test('sanitizeMoodEvents：未知类型剔除、同类型去重、delta 由系统映射', () => {
    const out = CultivationManager.sanitizeMoodEvents([
      { type: 'temptation', reason: '夜宵暴食' },
      { type: 'hacked', reason: 'x' },
      { type: 'temptation', reason: '重复' },
      { type: 'joy', reason: '心情不错' }
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].type, 'temptation');
    assert.deepEqual([out[0].mind, out[0].demon, out[0].exp], [-1, 2, 0]);
    assert.equal(out[1].type, 'joy');
    assert.deepEqual([out[1].mind, out[1].demon, out[1].exp], [1, 0, 0]);
  });

  test('sanitizeMoodEvents：超 3 条截断、reason 截 20 字、支持 {events:[...]} 包装', () => {
    const out = CultivationManager.sanitizeMoodEvents({
      events: [
        { type: 'discipline' }, { type: 'temptation' }, { type: 'stress' }, { type: 'joy' },
        { type: 'insight', reason: '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十' }
      ]
    });
    assert.equal(out.length, 3);
    assert.ok(out.every(e => e.reason.length <= 20));
  });

  test('applyMoodEvents(settlement)：套用固定 delta 并记 mood 日志', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { mind: 60, demon: 0, exp: 100 });
    const res = await cm.applyMoodEvents([{ type: 'temptation', reason: '夜宵暴食' }], yesterday, 'settlement');
    assert.equal(res.applied.length, 1);
    assert.equal(res.demonBursted, false);
    const st = readState(cm);
    assert.equal(st.mind, 59);
    assert.equal(st.demon, 2);
    assert.equal(st.exp, 100);
    assert.equal(st.lastMoodDate, yesterday);
    assert.ok(st.log.some(l => l.type === 'mood' && l.text.includes('欲念缠身')));
  });

  test('applyMoodEvents(settlement)：insight 修为 +2；幂等（同日期第二次 skipped=settled）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { exp: 100 });
    const res = await cm.applyMoodEvents({ events: [{ type: 'insight', reason: '有所感悟' }] }, yesterday, 'settlement');
    assert.equal(readState(cm).exp, 102);
    const again = await cm.applyMoodEvents([{ type: 'insight' }], yesterday, 'settlement');
    assert.equal(again.skipped, 'settled');
    assert.equal(again.applied.length, 0);
    assert.equal(readState(cm).exp, 102); // 未重复加
  });

  test('applyMoodEvents：心魔推过阈值 → 心魔爆发联动（修为 ×0.9）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 99, exp: 1000 });
    const res = await cm.applyMoodEvents([{ type: 'temptation', reason: '暴食' }], yesterday, 'settlement');
    assert.equal(res.demonBursted, true);
    const st = readState(cm);
    assert.equal(st.demon, 100);
    assert.equal(st.exp, 900);
    assert.ok(st.log.some(l => l.text.includes('心魔爆发')));
  });

  test('applyMoodEvents(realtime)：套用并累计 |delta|，达日封顶 5 后 skipped=rt_cap', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 0, mind: 60 });
    const r1 = await cm.applyMoodEvents([{ type: 'temptation' }], null, 'realtime'); // cost 3
    assert.equal(r1.applied.length, 1);
    const r2 = await cm.applyMoodEvents([{ type: 'stress' }], null, 'realtime');     // cost 2
    assert.equal(r2.applied.length, 1);
    assert.equal(readState(cm).behavior.moodRtAbs, 5);
    const r3 = await cm.applyMoodEvents([{ type: 'joy' }], null, 'realtime');        // 额度尽
    assert.equal(r3.skipped, 'rt_cap');
    assert.equal(r3.applied.length, 0);
    const st = readState(cm);
    assert.equal(st.demon, 3); // temptation+2 stress+1，joy 未套用
    assert.equal(st.mind, 58); // 60 -1(temptation) -1(stress)
  });

  test('applyMoodEvents(realtime)：跨天 behavior 重置后额度恢复', async () => {
    const { cm } = newCM();
    await seedCultivation(cm);
    await cm.applyMoodEvents([{ type: 'temptation' }], null, 'realtime');
    assert.equal(readState(cm).behavior.moodRtAbs, 3);
    // 模拟跨天：behavior.date 拨回昨天
    const st = readState(cm);
    st.behavior.date = yesterday;
    cm.fm.files.set('.meta/cultivation-state.json', JSON.stringify(st));
    const r = await cm.applyMoodEvents([{ type: 'joy' }], null, 'realtime');
    assert.equal(r.applied.length, 1);
    assert.equal(readState(cm).behavior.moodRtAbs, 1);
  });

  test('applyMoodEvents：身死态冻结（skipped=dead，settlement 落 lastMoodDate 防重）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { dead: true, demon: 50 });
    const res = await cm.applyMoodEvents([{ type: 'temptation' }], yesterday, 'settlement');
    assert.equal(res.skipped, 'dead');
    const st = readState(cm);
    assert.equal(st.demon, 50); // 未变动
    assert.equal(st.lastMoodDate, yesterday);
    const again = await cm.applyMoodEvents([{ type: 'temptation' }], yesterday, 'settlement');
    assert.equal(again.skipped, 'settled');
  });

  test('tickDaily 回归：心魔 ≥100 爆发，修为 ×0.9（_resolveDemonBurst 抽取后行为不变）', async () => {
    const { cm } = newCM();
    await seedCultivation(cm, { demon: 100, exp: 1000, lastTickDate: null });
    const res = await cm.tickDaily(yesterday, { hasHabits: false });
    assert.equal(res.demonBursted, true);
    const st = readState(cm);
    assert.equal(st.exp, 900);
    assert.equal(st.lastTickDate, yesterday);
    assert.ok(st.log.some(l => l.text.includes('心魔爆发')));
  });

  test('saveLifeDoc：上限 6000 字（v3.30.0 小说连载扩容）', async () => {
    const { cm, fm } = newCM();
    const { state } = await cm.startJourney('wood', '青木');
    await cm.saveLifeDoc('x'.repeat(7000));
    assert.equal(fm.files.get(CultivationManager.lifeDocPath(state)).length, 6000);
  });
});
