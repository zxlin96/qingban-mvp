// stats-manager.test.js — 数据解析层与 SVG 生成测试（阶段三）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { StatsManager } from '../js/stats-manager.js';

const METRICS_MD = `---
updated: 2026-09-18
---

# 身体指标追踪

## 最新数据
- 日期: 2026-09-18
- 体重: 78.2kg

## 体重趋势
| 日期 | 体重 | 变化 |
|------|------|------|
| (暂无记录) | | |
| 08-15 | 80.0 | - |
| 08-20 | 79.5 | -0.5 |
| 01-10 | 77.0 | -2.5 |
| 08-20 | 79.6 | -0.4 |`;

describe('parseBodyMetrics 体重表解析', () => {
  test('解析 MM-DD 行并按今天推算年份（1月日期归上一年）', () => {
    const out = StatsManager.parseBodyMetrics(METRICS_MD, '2026-09-18');
    assert.deepEqual(out.map((w) => w.date), ['2026-01-10', '2026-08-15', '2026-08-20']);
    assert.equal(out[0].weight, 77.0);
    assert.equal(out[1].weight, 80.0);
  });

  test('同日多条取最后一条', () => {
    const out = StatsManager.parseBodyMetrics(METRICS_MD, '2026-09-18');
    assert.equal(out.find((w) => w.date === '2026-08-20').weight, 79.6);
  });

  test('跨年场景：1月视角下 12 月日期属于上一年', () => {
    const md = '| 12-20 | 81.0 | - |\n| 01-05 | 80.0 | -1.0 |';
    const out = StatsManager.parseBodyMetrics(md, '2026-01-06');
    assert.deepEqual(out.map((w) => w.date), ['2025-12-20', '2026-01-05']);
  });

  test('空内容返回空数组', () => {
    assert.deepEqual(StatsManager.parseBodyMetrics(null, '2026-09-18'), []);
    assert.deepEqual(StatsManager.parseBodyMetrics('# 空', '2026-09-18'), []);
  });
});

describe('parseDietMd 饮食文件解析', () => {
  const FULL = `---
date: 2026-09-18
---

## 早餐
- 食物: 包子2个、豆浆1杯
- 估算热量: ~450 kcal

## 午餐
- 食物: 红烧排骨、米饭
- 估算热量: ~650 kcal

## 加餐
- 食物: 苹果1个
- 估算热量: ~80 kcal

## 当日汇总
- 总估算热量: ~1180 kcal
- 记录餐次: 3 餐`;

  test('有汇总段：总热量取汇总值，餐次列表正确', () => {
    const out = StatsManager.parseDietMd(FULL);
    assert.equal(out.total, 1180);
    assert.deepEqual(out.meals, ['早餐', '午餐', '加餐']);
  });

  test('无汇总段：返回 null 总热量但保留餐次', () => {
    const noSummary = FULL.split('## 当日汇总')[0];
    const out = StatsManager.parseDietMd(noSummary);
    assert.equal(out.total, null);
    assert.equal(out.meals.length, 3);
  });

  test('无热量数据返回 null', () => {
    assert.equal(StatsManager.parseDietMd(null), null);
    assert.equal(StatsManager.parseDietMd('# 今天没吃啥'), null);
    assert.equal(StatsManager.parseDietMd('## 早餐\n- 食物: 喝了口水（无热量标注）'), null);
  });
});

describe('getDailyStats 缓存与重建', () => {
  function makeFm() {
    const metricsMd = METRICS_MD;
    const dietA = '## 早餐\n- 估算热量: ~400 kcal\n\n## 当日汇总\n- 总估算热量: ~400 kcal';
    const dietB = '## 午餐\n- 估算热量: ~600 kcal\n\n## 当日汇总\n- 总估算热量: ~600 kcal';
    const fm = mockFm({
      'BODY_METRICS.md': metricsMd,
      'diet/2026-09-17.md': dietA,
      'diet/2026-09-18.md': dietB,
    });
    // mockFm 默认 updatedAt 为空串 — 这里给固定时间戳模拟真实元数据
    let tick = 0;
    fm.listFiles = async () => [...fm.files.entries()]
      .map(([path, content]) => ({ path, updatedAt: path === 'BODY_METRICS.md' ? 'm1' : `t${Math.min(tick, 1)}`, size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    fm.bumpDiet = () => { tick = 2; };
    return { fm };
  }

  test('首次解析出全部数据并写缓存，源未变时命中缓存', async () => {
    const { fm } = makeFm();
    const sm = new StatsManager(fm);
    const s1 = await sm.getDailyStats();
    assert.equal(s1.weights.length, 3);
    assert.equal(s1.calories.length, 2);
    assert.equal(s1.calories[0].total, 400);
    assert.equal(s1.calories[1].total, 600);
    assert.ok(fm.files.has('.meta/daily-stats.json'));

    // 缓存命中验证：保持签名不变、篡改缓存数据 → 返回的是被篡改的缓存（证明未重建）
    const raw = JSON.parse(fm.files.get('.meta/daily-stats.json'));
    raw.weights = [{ date: '2099-01-01', weight: 999 }];
    fm.files.set('.meta/daily-stats.json', JSON.stringify(raw));
    const s2 = await sm.getDailyStats();
    assert.equal(s2.weights[0].weight, 999, '签名未变应直接返回缓存内容');

    // 源未变但手动 force → 重建，数据恢复真实值
    const s3 = await sm.getDailyStats(true);
    assert.equal(s3.weights.length, 3);
    assert.ok(!s3.weights.some((w) => w.weight === 999));
  });

  test('源文件变化时重建缓存', async () => {
    const { fm } = makeFm();
    const sm = new StatsManager(fm);
    await sm.getDailyStats();
    fm.bumpDiet();
    fm.files.set('diet/2026-09-18.md', '## 晚餐\n- 估算热量: ~900 kcal\n\n## 当日汇总\n- 总估算热量: ~900 kcal');
    const s = await sm.getDailyStats();
    assert.equal(s.calories[1].total, 900, 'diet 文件更新后应重新解析');
  });

  test('force=true 强制重建', async () => {
    const { fm } = makeFm();
    const sm = new StatsManager(fm);
    await sm.getDailyStats();
    fm.files.set('diet/2026-09-18.md', '## 加餐\n- 估算热量: ~100 kcal');
    const raw = JSON.parse(fm.files.get('.meta/daily-stats.json'));
    raw.calories = [];
    fm.files.set('.meta/daily-stats.json', JSON.stringify(raw));
    const s = await sm.getDailyStats(true);
    assert.equal(s.calories.length, 2);
  });
});

describe('SVG 图表生成', () => {
  test('buildWeightSvg：有数据输出折线与数值，无数据输出空态', () => {
    const weights = [
      { date: '2026-09-01', weight: 80 },
      { date: '2026-09-10', weight: 79 },
      { date: '2026-09-18', weight: 78.2 },
    ];
    const svg = StatsManager.buildWeightSvg(weights, { today: '2026-09-18' });
    assert.ok(svg.includes('<polyline'));
    assert.ok(svg.includes('78.2kg'));
    assert.ok(svg.includes('trend-svg'));
    const empty = StatsManager.buildWeightSvg([], { today: '2026-09-18' });
    assert.ok(empty.includes('trend-empty'));
  });

  test('buildCaloriesSvg：7 天槽位补齐，无记录天为占位线，目标线可选', () => {
    const calories = [{ date: '2026-09-18', total: 1500, meals: ['早餐', '午餐'] }];
    const svg = StatsManager.buildCaloriesSvg(calories, { today: '2026-09-18', goal: 1800 });
    assert.ok(svg.includes('1500'));
    assert.ok(svg.includes('var(--accent2)'), '超/标目线使用强调色');
    assert.ok(svg.includes('目标'));
    const empty = StatsManager.buildCaloriesSvg([], { today: '2026-09-18' });
    assert.ok(empty.includes('trend-empty'));
  });

  test('buildHabitHeatmap：28 格 + 打卡次数聚合', () => {
    const counts = StatsManager.aggregateCheckinCounts([
      { date: '2026-09-18', amount: 1 },
      { date: '2026-09-18', amount: 1 },
      { date: '2026-09-17', amount: 1 },
    ]);
    assert.equal(counts['2026-09-18'], 2);
    assert.equal(counts['2026-09-17'], 1);
    const svg = StatsManager.buildHabitHeatmap(counts, { today: '2026-09-18' });
    assert.equal((svg.match(/<rect /g) || []).length, 28);
    assert.ok(svg.includes('2026-09-18：2 次打卡'));
  });

  test('_shiftDate 跨月与月初回退', () => {
    assert.equal(StatsManager._shiftDate('2026-09-01', -1), '2026-08-31');
    assert.equal(StatsManager._shiftDate('2026-08-31', 1), '2026-09-01');
    assert.equal(StatsManager._shiftDate('2026-09-18', -7), '2026-09-11');
  });

  test('buildWeeklyDataSection 汇总数据段', () => {
    const section = StatsManager.buildWeeklyDataSection(
      [{ date: '2026-09-18', weight: 78.2 }],
      [{ date: '2026-09-18', total: 1500, meals: ['午餐'] }],
      '- 喝水: 7/7 天达标',
      '2026-09-18'
    );
    assert.ok(section.includes('约1500kcal'));
    assert.ok(section.includes('78.2kg'));
    assert.ok(section.includes('喝水'));
  });
});
// ===== 阶段四：record_metrics 结构化双写 =====

describe('mergeCaloriesDay 双写合并', () => {
  test('无 manual 数据时返回 MD 解析结果', () => {
    const md = { total: 1180, meals: ['早餐', '午餐'] };
    assert.deepEqual(StatsManager.mergeCaloriesDay(md, undefined), md);
    assert.equal(StatsManager.mergeCaloriesDay(null, undefined), null);
  });

  test('manual total 优先于 MD total，餐次名合并去重', () => {
    const md = { total: 1180, meals: ['早餐', '午餐'] };
    const manual = { meals: [{ name: '午餐', kcal: 650 }, { name: '加餐', kcal: 80 }], total: 1300 };
    const out = StatsManager.mergeCaloriesDay(md, manual);
    assert.equal(out.total, 1300, '双写数据优先');
    assert.deepEqual(out.meals.sort(), ['加餐', '午餐', '早餐']);
  });

  test('manual 无 total 时回退 MD total，再回退 null', () => {
    const md = { total: 1180, meals: ['早餐'] };
    assert.equal(StatsManager.mergeCaloriesDay(md, { meals: [{ name: '晚餐', kcal: 500 }], total: null }).total, 1180);
    assert.equal(StatsManager.mergeCaloriesDay({ total: null, meals: ['早餐'] }, { meals: [{ name: '晚餐', kcal: 500 }], total: null }).total, null);
  });

  test('manual 无有效内容时不动 MD 结果', () => {
    const md = { total: 500, meals: ['午餐'] };
    assert.deepEqual(StatsManager.mergeCaloriesDay(md, { meals: [], total: null }), md);
  });
});

describe('recordMetrics 结构化双写', () => {
  function makeFm(initial = {}) {
    const fm = mockFm(initial);
    const mtimes = new Map();
    fm.writeFile = async (p, c) => {
      fm.files.set(p, c);
      mtimes.set(p, `u${mtimes.size + 1}`);
      return 'ok';
    };
    fm.listFiles = async () => [...fm.files.entries()]
      .map(([path, content]) => ({ path, updatedAt: mtimes.get(path) || '', size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return fm;
  }

  test('写入 manual 文件，total 缺省按餐次求和，同餐同名同热量去重', async () => {
    const fm = makeFm();
    const sm = new StatsManager(fm);
    const r1 = await sm.recordMetrics({ meals: [{ name: '午餐', kcal: 650 }, { name: '加餐', kcal: 80 }] }, '2026-09-19');
    assert.equal(r1.success, true);
    assert.equal(r1.total, 730);
    assert.equal(r1.date, '2026-09-19');

    const r2 = await sm.recordMetrics({ date: '2026-09-19', meals: [{ name: '午餐', kcal: 650 }, { name: '晚餐', kcal: 600 }] }, '2026-09-19');
    assert.equal(r2.meals.length, 3, '同餐去重、新餐追加');
    assert.equal(r2.total, 1330, 'total 按全部餐次重算');
    assert.ok(fm.files.has('.meta/metrics-manual.json'));
  });

  test('显式 total 优先于求和', async () => {
    const fm = makeFm();
    const sm = new StatsManager(fm);
    const r = await sm.recordMetrics({ meals: [{ name: '早餐', kcal: 400 }], total: 500 }, '2026-09-19');
    assert.equal(r.total, 500);
  });

  test('单独提交体重（不传 meals）', async () => {
    const fm = makeFm();
    const sm = new StatsManager(fm);
    const r = await sm.recordMetrics({ weight: 78.4 }, '2026-09-19');
    assert.equal(r.success, true);
    assert.equal(r.weight, 78.4);
    assert.deepEqual(r.meals, []);
  });

  test('date 缺省用 todayStr，非法 date 格式回退 todayStr', async () => {
    const fm = makeFm();
    const sm = new StatsManager(fm);
    const r1 = await sm.recordMetrics({ meals: [{ name: '午餐', kcal: 100 }] }, '2026-09-19');
    assert.equal(r1.date, '2026-09-19');
    const r2 = await sm.recordMetrics({ date: 'not-a-date', meals: [{ name: '晚餐', kcal: 100 }] }, '2026-09-19');
    assert.equal(r2.date, '2026-09-19');
  });

  test('非法参数拒绝：无有效餐次且无体重', async () => {
    const fm = makeFm();
    const sm = new StatsManager(fm);
    assert.equal((await sm.recordMetrics({}, '2026-09-19')).success, false);
    assert.equal((await sm.recordMetrics({ meals: [] }, '2026-09-19')).success, false);
    assert.equal((await sm.recordMetrics({ meals: [{ name: '', kcal: 100 }] }, '2026-09-19')).success, false);
    assert.equal((await sm.recordMetrics({ meals: [{ name: '午餐', kcal: -5 }] }, '2026-09-19')).success, false);
    assert.equal((await sm.recordMetrics({ meals: [{ name: '午餐', kcal: 'abc' }] }, '2026-09-19')).success, false);
    assert.equal(fm.files.has('.meta/metrics-manual.json'), false, '拒绝时不应写文件');
  });
});

describe('getDailyStats 合并双写数据', () => {
  function makeFm(initial = {}) {
    const fm = mockFm(initial);
    const mtimes = new Map();
    fm.writeFile = async (p, c) => {
      fm.files.set(p, c);
      mtimes.set(p, `u${mtimes.size + 1}`);
      return 'ok';
    };
    fm.listFiles = async () => [...fm.files.entries()]
      .map(([path, content]) => ({ path, updatedAt: mtimes.get(path) || '', size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path));
    return fm;
  }

  test('双写数据参与统计：total 优先、无 diet 文件日期补齐、体重补齐', async () => {
    const fm = makeFm({
      'BODY_METRICS.md': '| 08-20 | 79.5 | - |',
      'diet/2026-09-17.md': '## 早餐\n- 估算热量: ~400 kcal\n\n## 当日汇总\n- 总估算热量: ~400 kcal',
    });
    const sm = new StatsManager(fm);
    await sm.getDailyStats(); // 先建立缓存（无 manual）

    await sm.recordMetrics({ date: '2026-09-17', meals: [{ name: '午餐', kcal: 650 }], total: 1200 }, '2026-09-17');
    await sm.recordMetrics({ date: '2026-09-18', meals: [{ name: '晚餐', kcal: 600 }] }, '2026-09-18');
    await sm.recordMetrics({ date: '2026-09-18', weight: 78.4 }, '2026-09-18');

    const s = await sm.getDailyStats(); // manual updatedAt 变化 → 签名变化 → 重建
    const d17 = s.calories.find((c) => c.date === '2026-09-17');
    assert.equal(d17.total, 1200, '双写 total 优先于 MD 解析');
    assert.deepEqual(d17.meals.sort(), ['午餐', '早餐']);

    const d18 = s.calories.find((c) => c.date === '2026-09-18');
    assert.equal(d18.total, 600, '无 diet 文件的日期由双写数据补齐');
    assert.deepEqual(d18.meals, ['晚餐']);

    assert.ok(s.weights.some((w) => w.date === '2026-09-18' && w.weight === 78.4), 'BODY_METRICS 缺失的日期用双写体重补齐');
    assert.ok(s.weights.some((w) => w.date === '2026-08-20'), '原体重表数据保留');
  });

  test('仅双写体重、不写热量时热量不受影响', async () => {
    const fm = makeFm({ 'BODY_METRICS.md': '| 08-20 | 79.5 | - |' });
    const sm = new StatsManager(fm);
    await sm.recordMetrics({ weight: 78.0 }, '2026-09-19');
    const s = await sm.getDailyStats();
    assert.equal(s.calories.length, 0);
    assert.equal(s.weights.find((w) => w.date === '2026-09-19').weight, 78.0);
  });
});
