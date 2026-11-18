// pet-manager.test.js — 虚拟宠物测试（v3.23.0 宠物系统）：创建/行为奖励/去重/升级/跨天衰减/生病/出走/商店/物品
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { PetManager } from '../js/pet-manager.js';

function newPM(initial = {}) {
  const fm = mockFm(initial);
  const pm = new PetManager(fm);
  return { fm, pm };
}

// 与 PetManager._getToday 同口径的本地时区日期工具
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

async function seedPet(pm, overrides = {}) {
  const { state } = await pm.createPet('chick', '球球');
  if (Object.keys(overrides).length > 0) {
    const raw = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    const merged = { ...raw, ...overrides };
    // 深合并 stats
    if (overrides.stats) merged.stats = { ...raw.stats, ...overrides.stats };
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(merged));
    return merged;
  }
  return state;
}

// ===== 创建 =====

describe('创建宠物', () => {
  test('ensureCreated：无宠物返回 null，createPet 建初始状态（开局10币、log 有出生事件）', async () => {
    const { pm } = newPM();
    assert.equal(await pm.ensureCreated(), null);
    const { state, created } = await pm.createPet('penguin', '小冰');
    assert.equal(created, true);
    assert.equal(state.name, '小冰');
    assert.equal(state.species, 'penguin');
    assert.equal(state.level, 1);
    assert.equal(state.coins, 10);
    assert.deepEqual(state.stats, { hunger: 80, clean: 80, mood: 80, health: 100 });
    assert.equal(state.log.length, 1);
    assert.equal(state.log[0].type, 'birth');
  });

  test('重复 createPet：不重建（created:false，名字保留）', async () => {
    const { pm } = newPM();
    await pm.createPet('chick', '球球');
    const { state, created } = await pm.createPet('cat', '咪咪');
    assert.equal(created, false);
    assert.equal(state.name, '球球');
  });

  test('空名字兜底"球球"，超长截断 8 字', async () => {
    const { pm } = newPM();
    const { state } = await pm.createPet('cat', '   ');
    assert.equal(state.name, '球球');
    const { pm: pm2 } = newPM();
    const { state: s2 } = await pm2.createPet('cat', '一二三四五六七八九');
    assert.equal(s2.name, '一二三四五六七八');
  });
});

// ===== 等级计算 =====

describe('levelOf 等级计算', () => {
  test('exp 阈值边界：0→Lv1，30→Lv2，29→Lv1，2200→Lv10 满级', () => {
    assert.equal(PetManager.levelOf(0).level, 1);
    assert.equal(PetManager.levelOf(29).level, 1);
    assert.equal(PetManager.levelOf(30).level, 2);
    assert.equal(PetManager.levelOf(2200).level, 10);
    const max = PetManager.levelOf(9999);
    assert.equal(max.level, 10);
    assert.equal(max.nextExp, null);
    assert.equal(max.progress, 1);
  });

  test('进度计算：Lv1 内 exp=15 → 0.5', () => {
    const info = PetManager.levelOf(15);
    assert.equal(info.level, 1);
    assert.ok(Math.abs(info.progress - 0.5) < 0.001);
  });
});

// ===== 行为奖励 =====

describe('行为奖励', () => {
  test('onCheckin：+2币 +5心情 +8exp，掉落苹果×1（合并返回不带 drop，看背包）', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const r = await pm.onCheckin('habit-1');
    assert.ok(r);
    assert.equal(r.coins, 2);
    assert.equal(r.type, 'checkin');
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 12);
    assert.equal(state.exp, 8);
    assert.equal(state.stats.mood, 85);
    assert.equal(state.inventory.apple, 1);
  });

  test('onCheckin 同习惯当日去重：第二次返回 null，数值不变', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('habit-1');
    const r2 = await pm.onCheckin('habit-1');
    assert.equal(r2, null);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 12);
    assert.equal(state.exp, 8);
  });

  test('allDone 全达标奖励一次性发放（+5币 +10心情，无 exp）', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('habit-1', { allDone: true });
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 10 + 2 + 5);
    assert.equal(state.exp, 8); // allDone 无 exp
    assert.equal(state.stats.mood, 80 + 5 + 10);
    assert.equal(state.behavior.allDone, true);
    // 第二次 allDone 不重复，但 habit-2 打卡奖励照发
    await pm.onCheckin('habit-2', { allDone: true });
    const state2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state2.coins, 17 + 2);
    assert.equal(state2.exp, 16);
  });

  test('里程碑奖励：streak=7 → +10 币 +30 exp，同档去重', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('habit-1', { streak: 7 }); // 打卡(+2/+8) + 里程碑(+10/+30)
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 10 + 2 + 10);
    assert.equal(state.exp, 8 + 30);
    assert.equal(state.behavior.milestoneStreaks[7], 1);
    // 同档不重复（habit-2 打卡奖励照发）
    await pm.onCheckin('habit-2', { streak: 7 });
    const state2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state2.coins, 22 + 2);
    assert.equal(state2.exp, 38 + 8);
    // 非里程碑 streak：无里程碑奖励
    await pm.onCheckin('habit-3', { streak: 5 });
    const state3 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state3.coins, 24 + 2);
    assert.equal(state3.exp, 46 + 8);
  });

  test('onMeal：每日 3 次上限，第 4 次拒绝', async () => {
    const { pm } = newPM();
    await seedPet(pm, { stats: { hunger: 50, clean: 80, mood: 80, health: 100 } }); // 压低饱食避免 clamp 干扰
    assert.ok(await pm.onMeal());
    assert.ok(await pm.onMeal());
    assert.ok(await pm.onMeal());
    assert.equal(await pm.onMeal(), null);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.hunger, 50 + 30);
    assert.equal(state.coins, 10 + 6);
  });

  test('onExercise：每次都奖，清洁 -10（出汗）+ 掉落胡萝卜', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const r = await pm.onExercise();
    assert.equal(r.coins, 5);
    assert.equal(r.drop, 'carrot');
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 15);
    assert.equal(state.stats.clean, 70);
    assert.equal(state.stats.mood, 90);
    assert.equal(state.inventory.carrot, 1);
    await pm.onExercise();
    const state2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state2.coins, 20);
  });

  test('onWeight：每日一次，第二次拒绝', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const r = await pm.onWeight();
    assert.equal(r.coins, 5);
    assert.equal(await pm.onWeight(), null);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.exp, 15);
  });

  test('exp 累计升级：exp≥30 时 level 跳 2 且 log 有升级事件', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    // 15+15=30（体重）→ 升级
    await pm.onExercise(); // 10
    await pm.onWeight();   // 15
    await pm.onMeal();     // 5 → 30
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.exp, 30);
    assert.equal(state.level, 2);
    assert.ok(state.log.some(l => l.type === 'levelup'));
  });
});

// ===== 互动与商店 =====

describe('互动与商店', () => {
  test('buy：扣币入包；余额不足拒绝 reason=insufficient_coins', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const r = await pm.buy('apple');
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 7);
    assert.equal(state.inventory.apple, 1);
    const r2 = await pm.buy('bento'); // 15 > 7
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'insufficient_coins');
  });

  test('useItem 喂食：耗库存加饱食；饥饿满拒绝 reason=not_hungry', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.buy('apple');
    const r = await pm.useItem('apple');
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.hunger, 95);
    assert.equal(state.inventory.apple, 0);
    // 饱食满
    await pm.buy('riceball'); // 6 ≤ 7
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify({ ...JSON.parse(pm.fm.files.get('.meta/pet-state.json')), stats: { hunger: 100, clean: 80, mood: 80, health: 100 } }));
    const r2 = await pm.useItem('riceball');
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'not_hungry');
  });

  test('useItem 吃药：未生病拒绝 reason=not_sick；生病治愈（sick 清零、健康+50）', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 50 });
    assert.equal((await pm.useItem('medicine')).reason, 'no_item');
    await pm.buy('medicine');
    const r1 = await pm.useItem('medicine');
    assert.equal(r1.success, false);
    assert.equal(r1.reason, 'not_sick');
    // 手动置病
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.sick = true; s.sickSince = yesterday; s.stats.health = 30;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    const r2 = await pm.useItem('medicine');
    assert.equal(r2.success, true);
    const s2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(s2.sick, false);
    assert.equal(s2.sickSince, null);
    assert.equal(s2.stats.health, 80);
  });

  test('freePlay：每日 3 次上限，超出 reason=limit_reached', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    assert.ok((await pm.freePlay()).success);
    assert.ok((await pm.freePlay()).success);
    const r3 = await pm.freePlay();
    assert.ok(r3.success);
    assert.equal((await pm.freePlay()).reason, 'limit_reached');
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.mood, 80 + 12);
  });

  test('出走态下互动/购买/奖励全部拒绝 reason=ran_away', async () => {
    const { pm } = newPM();
    await seedPet(pm, { ranAway: true });
    assert.equal((await pm.useItem('apple')).reason, 'ran_away');
    assert.equal((await pm.buy('apple')).reason, 'ran_away');
    assert.equal((await pm.freePlay()).reason, 'ran_away');
    assert.equal(await pm.onCheckin('h1'), null);
    assert.equal(await pm.onMeal(), null);
    assert.equal(await pm.onExercise(), null);
    assert.equal(await pm.onWeight(), null);
  });

  test('comeBack：接回家恢复 COMEBACK_STATS，生病清零；未出走时拒绝', async () => {
    const { pm } = newPM();
    await seedPet(pm, { ranAway: true, sick: true, sickSince: yesterday });
    const r = await pm.comeBack();
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.ranAway, false);
    assert.equal(state.sick, false);
    assert.deepEqual(state.stats, { hunger: 40, clean: 40, mood: 40, health: 60 });
    assert.ok(state.log.some(l => l.type === 'comeback'));
    const r2 = await pm.comeBack();
    assert.equal(r2.success, false);
    assert.equal(r2.reason, 'not_away');
  });
});

// ===== 跨天结算 =====

describe('tickDaily 跨天结算', () => {
  test('自然衰减：hunger-28 clean-22 mood-14', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const r = await pm.tickDaily(yesterday);
    assert.equal(r.changed, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.hunger, 52);
    assert.equal(state.stats.clean, 58);
    assert.equal(state.stats.mood, 66);
    assert.equal(state.lastTickDate, yesterday);
  });

  test('幂等：同日二次结算数值不变（changed:false）', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.tickDaily(yesterday);
    const r2 = await pm.tickDaily(yesterday);
    assert.equal(r2.changed, false);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.hunger, 52);
  });

  test('低水位连续 2 天 → 生病（becameSick:true），1 天不病', async () => {
    const { pm } = newPM();
    await seedPet(pm, { stats: { hunger: 10, clean: 80, mood: 80, health: 100 } });
    const d1 = shift(today, -2);
    const r1 = await pm.tickDaily(d1);
    assert.equal(r1.becameSick, false);
    const r2 = await pm.tickDaily(yesterday);
    assert.equal(r2.becameSick, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.sick, true);
    assert.equal(state.sickSince, yesterday);
  });

  test('恢复到阈值以上 → lowSince 清空不生病', async () => {
    const { pm } = newPM();
    await seedPet(pm, { stats: { hunger: 10, clean: 80, mood: 80, health: 100 } });
    await pm.tickDaily(shift(today, -2));
    // 喂食拉回安全水位（直接改状态模拟）
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.stats.hunger = 60;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    const r2 = await pm.tickDaily(yesterday);
    assert.equal(r2.becameSick, false);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.sick, false);
    assert.equal(state.lowSince, null);
  });

  test('生病期间健康逐日 -20；连续第 7 天 → 离家出走', async () => {
    const { pm } = newPM();
    // 手动置为 6 天前生病（sickSince），从 5 天前开始结算到昨天共 6 次 → 第 6 次时 sickDays=7 → 出走
    const sickSince = shift(today, -7);
    await seedPet(pm, { sick: true, sickSince, stats: { hunger: 0, clean: 80, mood: 30, health: 60 } });
    let last;
    for (let i = 6; i >= 1; i--) {
      last = await pm.tickDaily(shift(today, -i));
    }
    assert.equal(last.ranAway, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.ranAway, true);
    assert.ok(state.log.some(l => l.type === 'ranaway'));
  });

  test('出走后结算冻结（数值不变，changed:false）', async () => {
    const { pm } = newPM();
    await seedPet(pm, { ranAway: true, stats: { hunger: 30, clean: 30, mood: 30, health: 20 } });
    const r = await pm.tickDaily(yesterday);
    assert.equal(r.changed, false);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.deepEqual(state.stats, { hunger: 30, clean: 30, mood: 30, health: 20 });
  });

  test('结算日志归属昨日：pet/昨日.md 含衰减事件', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.tickDaily(yesterday);
    const md = pm.fm.files.get(`pet/${yesterday}.md`);
    assert.ok(md, '昨日宠物日志应存在');
    assert.ok(md.includes('过了漫长的一天'));
  });
});

// ===== 日志与摘要 =====

describe('buildDayMd 与摘要', () => {
  test('buildDayMd：无事件输出占位；有事件输出时间+文本', () => {
    const empty = PetManager.buildDayMd(today, []);
    assert.ok(empty.includes('今日暂无宠物动态'));
    const md = PetManager.buildDayMd(today, [
      { date: today, time: '08:12', type: 'care', text: '🍎 吃了苹果（饱食 +15）' }
    ]);
    assert.ok(md.includes('08:12 🍎 吃了苹果'));
    assert.ok(md.includes(`date: ${today}`));
  });

  test('summaryLine：含名字/等级/状态/轻币/背包', () => {
    const state = {
      name: '球球', species: 'chick', level: 3, coins: 120,
      stats: { hunger: 70, clean: 55, mood: 80, health: 100 },
      sick: false, ranAway: false,
      inventory: { apple: 2, soap: 1 }
    };
    const line = PetManager.summaryLine(state);
    assert.ok(line.includes('球球'));
    assert.ok(line.includes('Lv.3'));
    assert.ok(line.includes('状态正常'));
    assert.ok(line.includes('轻币120'));
    assert.ok(line.includes('苹果×2'));
    // 生病/出走态文案
    assert.ok(PetManager.summaryLine({ ...state, sick: true }).includes('生病中'));
    assert.ok(PetManager.summaryLine({ ...state, ranAway: true }).includes('已离家出走'));
  });
});
