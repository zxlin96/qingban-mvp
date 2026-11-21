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

  test('summaryLine：含名字/等级/状态/轻币/背包，动态物品名可解析', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 160, level: 3, coins: 120, inventory: { apple: 2, soap: 1 } }); // 160 = Lv.3
    await pm.addCustomItem({ name: '老板牌浓缩咖啡', icon: '☕', kind: 'toy', mood: 15, price: 8, source: 'daily', buyable: true });
    const items = await pm.getCustomItems();
    const ck = items[0].key;
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.inventory[ck] = 1;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    const line = await pm.summaryLine();
    assert.ok(line.includes('球球'));
    assert.ok(line.includes('Lv.3'));
    assert.ok(line.includes('状态正常'));
    assert.ok(line.includes('轻币120'));
    assert.ok(line.includes('苹果×2'));
    assert.ok(line.includes('老板牌浓缩咖啡×1')); // 动态物品名解析
    // 生病/出走态文案
    const s2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s2.sick = true;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s2));
    assert.ok((await pm.summaryLine()).includes('生病中'));
    s2.ranAway = true;
    s2.sick = false;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s2));
    assert.ok((await pm.summaryLine()).includes('已离家出走'));
  });
});

// ===== 旅行系统（v3.24.0 旅行青蛙式）=====

describe('旅行纯函数', () => {
  test('rollTripDays：1件→1/2天，2件以上→2/3天（r 注入确定化）', () => {
    assert.equal(PetManager.rollTripDays(1, 0.3), 1);
    assert.equal(PetManager.rollTripDays(1, 0.8), 2);
    assert.equal(PetManager.rollTripDays(2, 0.3), 2);
    assert.equal(PetManager.rollTripDays(3, 0.8), 3);
    assert.equal(PetManager.rollTripDays(0, 0.9), 2); // 无行李兜底 2 天
  });

  test('rollPostcard：r<0.6 寄卡，r>=0.6 不寄', () => {
    assert.equal(PetManager.rollPostcard(0.3), true);
    assert.equal(PetManager.rollPostcard(0.59), true);
    assert.equal(PetManager.rollPostcard(0.6), false);
    assert.equal(PetManager.rollPostcard(0.9), false);
  });

  test('pickDestination：r 注入确定性，越界兜底', () => {
    assert.equal(PetManager.pickDestination(0).key, PetManager.DESTINATIONS[0].key);
    assert.equal(PetManager.pickDestination(0.35).key, PetManager.DESTINATIONS[3].key);
    assert.equal(PetManager.pickDestination(0.999).key, PetManager.DESTINATIONS[9].key);
  });

  test('buildPostcardTemplate：含地名，全达标有夸奖', () => {
    const t = PetManager.buildPostcardTemplate('seaside', 2, true);
    assert.ok(t.includes('海边'));
    assert.ok(t.includes('全都做到'));
    const t2 = PetManager.buildPostcardTemplate('park', 1, false);
    assert.ok(t2.includes('公园'));
  });
});

describe('装行李与出发', () => {
  test('未到 Lv.5：packBag 拒绝 reason=locked', async () => {
    const { pm } = newPM();
    await seedPet(pm, { inventory: { riceball: 1 } }); // Lv.1
    const r = await pm.packBag('riceball');
    assert.equal(r.success, false);
    assert.equal(r.reason, 'locked');
  });

  test('Lv.5 解锁：装包成功转 ready；非食物/无货拒绝', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 280, inventory: { riceball: 1, yarn: 1 } }); // 280 = Lv.5 轻盈
    const r1 = await pm.packBag('yarn'); // 玩具
    assert.equal(r1.reason, 'not_food');
    const r2 = await pm.packBag('bento'); // 背包无货
    assert.equal(r2.reason, 'no_item');
    const r3 = await pm.packBag('riceball');
    assert.equal(r3.success, true);
    assert.equal(r3.bagCount, 1);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.travel.status, 'ready');
    assert.equal(state.travel.bag.riceball, 1);
    assert.equal(state.inventory.riceball, 0);
  });

  test('unpackBag：取出回背包，取空回 home', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 280, inventory: { apple: 1, cake: 1 } });
    await pm.packBag('apple');
    await pm.packBag('cake');
    const r = await pm.unpackBag('apple');
    assert.equal(r.success, true);
    assert.equal(r.bagCount, 1);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.inventory.apple, 1);
    assert.equal(state.travel.status, 'ready');
    await pm.unpackBag('cake');
    const state2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state2.travel.status, 'home');
    const r2 = await pm.unpackBag('cake');
    assert.equal(r2.reason, 'no_item');
  });

  test('ready + 跨天 → 出发：traveling、目的地合法、时长由行李件数定（随机注入 0.3）', async () => {
    const { pm } = newPM();
    const realRandom = Math.random;
    try {
      Math.random = () => 0.3;
      await seedPet(pm, { exp: 280, inventory: { riceball: 2 } });
      await pm.packBag('riceball');
      const r = await pm.tickDaily(yesterday);
      assert.equal(r.departed, true);
      const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      assert.equal(state.travel.status, 'traveling');
      assert.equal(state.travel.days, 1); // 1 件 + 0.3 → 1 天
      assert.ok(PetManager.DESTINATIONS.some(d => d.key === state.travel.destination));
    } finally {
      Math.random = realRandom;
    }
  });

  test('旅行中：不衰减不生病（饥饿0也不病）、到期回家+寄卡意图', async () => {
    const { pm } = newPM();
    const realRandom = Math.random;
    try {
      Math.random = () => 0.3; // rollPostcard: 0.3 < 0.6 → 寄卡
      await seedPet(pm, { exp: 280, inventory: { riceball: 2 } });
      await pm.packBag('riceball');
      await pm.tickDaily(yesterday); // 出发
      // 旅行中：饥饿/清洁清零也不会生病（衰减暂停、生病判定跳过）
      const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      s.stats = { hunger: 0, clean: 0, mood: 50, health: 100 };
      pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
      const r = await pm.tickDaily(shift(today, 1)); // tripDay = daysBetween(yesterday, today) = 1，days=1 → 回家
      assert.equal(r.returned, true);
      assert.ok(r.postcardIntent); // 0.3 < 0.6
      assert.equal(r.postcardIntent.allDone, false); // behavior.date 是今天非昨天，不算达标
      const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      assert.equal(state.travel.status, 'home'); // 已回家
      assert.equal(state.stats.hunger, 0); // 未衰减
      assert.equal(state.sick, false); // 未生病
    } finally {
      Math.random = realRandom;
    }
  });

  test('旅行回家结算：特产入包、exp/coins 基础+达标加成、状态回 home', async () => {
    const { pm } = newPM();
    const realRandom = Math.random;
    try {
      Math.random = () => 0.3;
      await seedPet(pm, { exp: 280, inventory: { riceball: 2 } });
      await pm.packBag('riceball');
      await pm.packBag('riceball');
      await pm.tickDaily(yesterday); // 出发，2 件 → 2 天
      // 旅行第 1 天：当次 tick 的"昨日"（today）全达标
      const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      s.behavior = { date: today, checkins: {}, meals: 0, weights: 0, freePlays: 0, allDone: true, milestoneStreaks: {} };
      pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
      await pm.tickDaily(today); // tripDay = 1 < 2 → 继续旅行
      // 旅行第 2 天：昨日全达标 + 回家
      const s2 = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      s2.behavior = { date: shift(today, 1), checkins: {}, meals: 0, weights: 0, freePlays: 0, allDone: true, milestoneStreaks: {} };
      pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s2));
      const r = await pm.tickDaily(shift(today, 1)); // tripDay = 2 >= 2 → 回家
      assert.equal(r.returned, true);
      assert.equal(r.travelSummary.allDoneDays, 2);
      assert.equal(r.travelSummary.bonusExp, 30);
      assert.equal(r.travelSummary.bonusCoins, 6);
      assert.ok(r.souvenirIntent); // v3.26.0 特产意图（app.js 调 LLM 现编，失败降级静态）
      assert.equal(r.souvenirIntent.destination, r.travelSummary.destination);
      const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      assert.equal(state.travel.status, 'home');
      assert.deepEqual(state.travel.bag, {});
      assert.equal(state.travel.departDate, null);
      assert.equal(state.exp, 280 + 30 + 30); // 基础 30 + 2 天全达标 30
      assert.equal(state.coins, 10 + 10 + 6); // 初始 10 + 回家基础 10 + 2 天加成 6
      // 结算本身不再掉落静态特产（由 app.js souvenirIntent 处理后 grantItem 落包）
      const souvenirKeys = Object.keys(state.inventory).filter(k => PetManager.TRAVEL_SOUVENIRS.includes(k));
      assert.equal(souvenirKeys.length, 0);
      assert.ok(state.log.some(l => l.type === 'travel' && l.text.includes('回来了')));
    } finally {
      Math.random = realRandom;
    }
  });

  test('旅行中不寄卡分支（随机 0.9）', async () => {
    const { pm } = newPM();
    const realRandom = Math.random;
    try {
      await seedPet(pm, { exp: 280, inventory: { riceball: 2 } });
      await pm.packBag('riceball');
      await pm.packBag('riceball');
      Math.random = () => 0.3;
      await pm.tickDaily(yesterday); // 出发，2 件 → 2 天
      Math.random = () => 0.9; // 0.9 >= 0.6 不寄卡
      const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
      s.behavior = { date: yesterday, checkins: {}, meals: 0, weights: 0, freePlays: 0, allDone: true, milestoneStreaks: {} };
      pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
      const r = await pm.tickDaily(today);
      assert.equal(r.postcardIntent, null);
      assert.equal(r.returned, false);
    } finally {
      Math.random = realRandom;
    }
  });

  test('出走态不能装行李', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 280, ranAway: true });
    const r = await pm.packBag('apple');
    assert.equal(r.reason, 'ran_away');
  });

  test('明信片存取：插最前、滚动保留 30 张', async () => {
    const { pm } = newPM();
    for (let i = 0; i < 32; i++) {
      await pm.addPostcard({ destination: 'seaside', icon: '🌊', text: `卡${i}`, date: today });
    }
    const list = await pm.getPostcards();
    assert.equal(list.length, 30);
    assert.equal(list[0].text, '卡31'); // 最新在前
    assert.equal(list[29].text, '卡2');
  });

  test('getTravelStatus：各状态摘要与明信片数', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 280, inventory: { riceball: 1 } });
    const s0 = await pm.getTravelStatus();
    assert.equal(s0.unlocked, true);
    assert.equal(s0.status, 'home');
    await pm.packBag('riceball');
    const s1 = await pm.getTravelStatus();
    assert.equal(s1.status, 'ready');
    assert.equal(s1.bagCount, 1);
    await pm.addPostcard({ destination: 'park', icon: '🌳', text: 'hi', date: today });
    const s2 = await pm.getTravelStatus();
    assert.equal(s2.postcardCount, 1);
  });

  test('v3.23 老存档无 travel 字段：packBag 时自动补齐不报错', async () => {
    const { pm } = newPM();
    await seedPet(pm, { exp: 280, inventory: { riceball: 1 } });
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    delete s.travel;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    const r = await pm.packBag('riceball');
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.travel.status, 'ready');
  });
});

// ===== LLM 深度集成（v3.25.0）：奖励聚合/心声解析/日记/周报段 =====

describe('奖励播报数据（rewardsToday）', () => {
  test('多次奖励聚合：coins/exp/drops 累计，drops 记 key 序列', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('h1');        // +2币 +8exp 苹果
    await pm.onMeal();               // +2币 +5exp
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.rewardsToday.date, today);
    assert.equal(state.rewardsToday.coins, 4);
    assert.equal(state.rewardsToday.exp, 13);
    assert.deepEqual(state.rewardsToday.drops, ['apple']);
  });

  test('跨日重置：rewardsToday.date 被改成昨天后，新奖励触发重置', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('h1');
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.rewardsToday = { date: yesterday, coins: 50, exp: 100, drops: ['carrot'] };
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    await pm.onExercise();
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.rewardsToday.date, today);
    assert.equal(state.rewardsToday.coins, 5); // 昨天的 50 币不带入
    assert.deepEqual(state.rewardsToday.drops, ['carrot']);
  });
});

describe('parseVoiceReply 心声解析', () => {
  test('正常 JSON：提取 diary 与 personalityMd', () => {
    const r = PetManager.parseVoiceReply('{"diary":"今天吃到了主人给的苹果，超开心！","personalityMd":"# 宠物性格档案\\n## 近期观察\\n- 主人很勤快"}');
    assert.equal(r.diary, '今天吃到了主人给的苹果，超开心！');
    assert.ok(r.personalityMd.includes('主人很勤快'));
  });

  test('code fence 包裹与前后杂文容错', () => {
    const r = PetManager.parseVoiceReply('好的，以下是我的输出：\n```json\n{"diary":"今天晒了太阳很舒服，心情不错哦。","personalityMd":"# 宠物性格档案\\n## 性格特质\\n- 活泼粘人，最近变得很关心主人"}\n```\n希望有帮助');
    assert.ok(r.diary.includes('晒了太阳'));
    assert.ok(r.personalityMd.includes('活泼粘人'));
  });

  test('无 JSON / 空串 / 缺字段 → null 或字段为 null', () => {
    assert.equal(PetManager.parseVoiceReply('纯文本没有JSON'), null);
    assert.equal(PetManager.parseVoiceReply(''), null);
    assert.equal(PetManager.parseVoiceReply(null), null);
    const r = PetManager.parseVoiceReply('{"diary":"短"}'); // diary 过短 → null
    assert.equal(r.diary, null);
    assert.equal(r.personalityMd, null);
  });
});

describe('今日心声与日记落盘', () => {
  test('saveDiary：更新 state.diary 并写入 pet/日期.md 的「今日心声」段', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    await pm.onCheckin('h1'); // 产生当日事件
    assert.equal(await pm.saveDiary(today, '今天主人打卡了，我分到了苹果，心满意足地打了个盹。'), true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.diary.date, today);
    const md = pm.fm.files.get(`pet/${today}.md`);
    assert.ok(md.includes('## 今日心声'));
    assert.ok(md.includes('心满意足'));
    assert.ok(md.indexOf('## 今日心声') < md.indexOf('## 宠物动态')); // 心声段在动态前
  });

  test('saveDiary 空文本拒绝；buildDayMd diary 参数直接输出心声段', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    assert.equal(await pm.saveDiary(today, '   '), false);
    const md = PetManager.buildDayMd(today, [{ date: today, time: '08:00', type: 'care', text: 'x' }], { date: today, text: '心声内容' });
    assert.ok(md.includes('## 今日心声'));
    const mdNoDiary = PetManager.buildDayMd(today, [], null);
    assert.ok(!mdNoDiary.includes('今日心声'));
  });
});

describe('周报宠物段', () => {
  test('getWeeklyDigest + buildWeeklyDigestText：统计出发/回家/明信片/升级', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    // 种本周 log
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.log.push(
      { date: today, time: '08:00', type: 'travel', text: '🎒 背上行囊出发去海边了（约 2 天）' },
      { date: today, time: '09:00', type: 'levelup', text: '🎉 升到 Lv.2（蹒跚）' },
      { date: yesterday, time: '10:00', type: 'travel', text: '🏠 从海边回来了！带回 🍵 高山茶' },
      { date: shift(today, -3), time: '11:00', type: 'sick', text: '🤒 生病了' }
    );
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    await pm.addPostcard({ destination: 'seaside', icon: '🌊', text: 'hi', date: yesterday });
    await pm.addPostcard({ destination: 'park', icon: '🌳', text: 'hi2', date: shift(today, -5) });
    const digest = await pm.getWeeklyDigest(shift(today, -6), today);
    assert.equal(digest.departures, 1);
    assert.equal(digest.returns, 1);
    assert.equal(digest.levelUps, 1);
    assert.equal(digest.sickCount, 1);
    assert.equal(digest.postcards, 2);
    const text = PetManager.buildWeeklyDigestText(digest);
    assert.ok(text.includes('出行 1 次'));
    assert.ok(text.includes('明信片 2 张'));
    assert.ok(text.includes('升级 1 次'));
    assert.ok(text.includes('生病 1 次'));
  });

  test('无动态周：安静待在家文案', () => {
    const text = PetManager.buildWeeklyDigestText({ name: '小冰', level: 3, departures: 0, returns: 0, sickCount: 0, levelUps: 0, postcards: 0 });
    assert.ok(text.includes('安静地待在家里'));
    assert.ok(text.includes('Lv.3'));
    assert.equal(PetManager.buildWeeklyDigestText(null), '（本周宠物无动态）');
  });
});

// ===== 动态物品池与 LLM 生成（v3.26.0）=====

describe('sanitizeCustomItem 生成收敛', () => {
  test('food：hunger clamp 50、mood clamp 10、name/icon/desc/price 限长限幅', () => {
    const r = PetManager.sanitizeCustomItem({ name: '老板牌浓缩咖啡', icon: '☕☕☕☕☕', kind: 'food', hunger: 999, mood: 99, price: 999, desc: 'x'.repeat(99) });
    assert.equal(r.hunger, 50);
    assert.equal(r.mood, 10);
    assert.equal(r.price, 20);
    assert.equal(r.icon.length, 4);
    assert.equal(r.desc.length, 40);
    assert.equal(r.name, '老板牌浓缩咖啡');
  });

  test('food hunger 缺省 15；toy mood 缺省 12；care clean 缺省 25（主效果必有）', () => {
    assert.equal(PetManager.sanitizeCustomItem({ name: 'a', icon: '🍎', kind: 'food' }).hunger, 15);
    assert.equal(PetManager.sanitizeCustomItem({ name: 'b', icon: '🧶', kind: 'toy' }).mood, 12);
    assert.equal(PetManager.sanitizeCustomItem({ name: 'c', icon: '🧼', kind: 'care' }).clean, 25);
  });

  test('无效拒绝：空名/非法 kind/非对象；price 下限 3', () => {
    assert.equal(PetManager.sanitizeCustomItem({ name: '', icon: '🍎', kind: 'food' }), null);
    assert.equal(PetManager.sanitizeCustomItem({ name: 'x', icon: '💊', kind: 'heal' }), null); // heal 不开放
    assert.equal(PetManager.sanitizeCustomItem(null), null);
    assert.equal(PetManager.sanitizeCustomItem({ name: 'x', icon: '🍎', kind: 'food', price: 1 }).price, 3);
  });
});

describe('craftItem AI 现场制作', () => {
  test('成功：扣 5 材料费、入包、behavior.crafts 计数、动态池可解析', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 30 });
    const r = await pm.craftItem({ name: '元气小饭团', icon: '🍙', kind: 'food', hunger: 30, mood: 5, price: 8, desc: '主人的心意' });
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 25);
    assert.equal(state.behavior.crafts, 1);
    const genKey = Object.keys(state.inventory).find(k => k.startsWith('gen-'));
    assert.ok(genKey);
    assert.equal(state.inventory[genKey], 1);
    const item = await pm.resolveItem(genKey);
    assert.equal(item.name, '元气小饭团');
    assert.equal(item.buyable, false); // craft 物品不可购买
    assert.ok(state.log.some(l => l.type === 'craft' && l.text.includes('元气小饭团')));
  });

  test('每日 2 次限：第 3 次 limit_reached', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 100 });
    assert.ok((await pm.craftItem({ name: '甲', icon: '🎁', kind: 'toy', mood: 10 })).success);
    assert.ok((await pm.craftItem({ name: '乙', icon: '🎁', kind: 'toy', mood: 10 })).success);
    const r3 = await pm.craftItem({ name: '丙', icon: '🎁', kind: 'toy', mood: 10 });
    assert.equal(r3.reason, 'limit_reached');
  });

  test('材料费不足 insufficient_coins；旅行中拒绝 traveling', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 3 });
    assert.equal((await pm.craftItem({ name: '甲', icon: '🎁', kind: 'toy', mood: 10 })).reason, 'insufficient_coins');
    await seedPet(pm, { coins: 30, travel: { status: 'traveling', bag: {}, departDate: today, days: 2, destination: 'seaside', tripLog: [] } });
    assert.equal((await pm.craftItem({ name: '乙', icon: '🎁', kind: 'toy', mood: 10 })).reason, 'traveling');
  });

  test('无效参数 invalid_item（空名/非法 kind）', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 30 });
    assert.equal((await pm.craftItem({ name: '', icon: '🎁', kind: 'toy' })).reason, 'invalid_item');
    assert.equal((await pm.craftItem({ name: '甲', icon: '💊', kind: 'heal' })).reason, 'invalid_item');
  });
});

describe('动态物品的购买与使用', () => {
  test('buy：daily 物品可买（按 price 扣币）；craft/travel 物品不可买；过期下架', async () => {
    const { pm } = newPM();
    await seedPet(pm, { coins: 50 });
    const daily = await pm.addCustomItem({ name: '老板牌浓缩咖啡', icon: '☕', kind: 'toy', mood: 15, price: 8, source: 'daily', buyable: true, date: today });
    assert.equal((await pm.buy(daily.key)).success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.coins, 42);
    assert.equal(state.inventory[daily.key], 1);
    // craft 物品不可买
    const crafted = await pm.addCustomItem({ name: '手作饼干', icon: '🍪', kind: 'food', hunger: 20, price: 6, source: 'craft', buyable: false, date: today });
    assert.equal((await pm.buy(crafted.key)).reason, 'not_for_sale');
    // 过期下架（4 天前上架）
    const stale = await pm.addCustomItem({ name: '昨日特供', icon: '🥐', kind: 'food', hunger: 20, price: 6, source: 'daily', buyable: true, date: shift(today, -4) });
    assert.equal((await pm.buy(stale.key)).reason, 'off_shelf');
  });

  test('useItem/packBag 对动态物品透明生效', async () => {
    const { pm } = newPM();
    await seedPet(pm, { inventory: {} });
    const toy = await pm.addCustomItem({ name: '纸糊皮球', icon: '⚽', kind: 'toy', mood: 20, price: 5, source: 'craft', buyable: false, date: today });
    await pm.grantItem(toy.key, 1);
    const r = await pm.useItem(toy.key);
    assert.equal(r.success, true);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.stats.mood, 100); // 80 + 20
    // 动态食物可进行李
    await seedPet(pm, { exp: 280 });
    const food = await pm.addCustomItem({ name: '加班回血便当', icon: '🍱', kind: 'food', hunger: 40, price: 10, source: 'daily', buyable: true, date: today });
    const s = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    s.inventory[food.key] = 1;
    pm.fm.files.set('.meta/pet-state.json', JSON.stringify(s));
    const r2 = await pm.packBag(food.key);
    assert.equal(r2.success, true);
  });

  test('grantItem：落包 + 日志记录', async () => {
    const { pm } = newPM();
    await seedPet(pm);
    const it = await pm.addCustomItem({ name: '海边贝壳', icon: '🐚', kind: 'toy', mood: 10, price: 5, source: 'travel', buyable: false, date: today });
    await pm.grantItem(it.key, 2);
    const state = JSON.parse(pm.fm.files.get('.meta/pet-state.json'));
    assert.equal(state.inventory[it.key], 2);
    assert.ok(state.log.some(l => l.text.includes('旅行的特产') && l.text.includes('贝壳')));
  });
});

describe('parseItemsReply 特供解析', () => {
  test('正常解析 + sanitize + 截断至 2 个', () => {
    const r = PetManager.parseItemsReply('{"specials":[{"name":"老板牌浓缩咖啡","icon":"☕","kind":"food","hunger":10,"mood":8,"price":8,"desc":"加班后的救赎"},{"name":"山径杖","icon":"🥾","kind":"care","clean":50,"price":9,"desc":"周末爬山的收尾"},{"name":"第三个","icon":"🎁","kind":"toy","mood":5}]}');
    assert.equal(r.length, 2);
    assert.equal(r[0].name, '老板牌浓缩咖啡');
    assert.equal(r[1].kind, 'care');
  });

  test('容错：无 specials/全无效 → 空数组', () => {
    assert.deepEqual(PetManager.parseItemsReply('{"msg":"没有specials"}'), []);
    assert.deepEqual(PetManager.parseItemsReply('{"specials":[{"name":"","icon":"🎁","kind":"food"}]}'), []);
    assert.deepEqual(PetManager.parseItemsReply('纯文本'), []);
    assert.deepEqual(PetManager.parseItemsReply(null), []);
  });

  test('fence 包裹正常解析', () => {
    const r = PetManager.parseItemsReply('```json\n{"specials":[{"name":"山野饭团","icon":"🍙","kind":"food","hunger":30,"price":7,"desc":"溪水边捏的饭团"}]}\n```');
    assert.equal(r.length, 1);
    assert.equal(r[0].name, '山野饭团');
  });
});