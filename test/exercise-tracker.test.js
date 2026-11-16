// exercise-tracker.test.js — 秒表/GPS 测距纯函数与状态持久化测试（v3.22.0 运动板块）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { ExerciseTracker } from '../js/exercise-tracker.js';

function newTracker(initial = {}) {
  const fm = mockFm(initial);
  const tracker = new ExerciseTracker(fm);
  return { fm, tracker };
}

// ===== Haversine 距离 =====

describe('haversineMeters', () => {
  test('赤道经度 0.001° ≈ 111.3 米', () => {
    const d = ExerciseTracker.haversineMeters(0, 0, 0, 0.001);
    assert.ok(Math.abs(d - 111.32) < 2, `实际 ${d}`);
  });

  test('同点距离为 0', () => {
    assert.equal(ExerciseTracker.haversineMeters(39.9, 116.4, 39.9, 116.4), 0);
  });

  test('对称性：A→B 与 B→A 相等', () => {
    const ab = ExerciseTracker.haversineMeters(39.9042, 116.4074, 31.2304, 121.4737);
    const ba = ExerciseTracker.haversineMeters(31.2304, 121.4737, 39.9042, 116.4074);
    assert.ok(Math.abs(ab - ba) < 0.001);
    assert.ok(ab > 1000000); // 北京—上海 > 1000km
  });
});

// ===== 单段判定（抖动/超速过滤）=====

describe('acceptSegment', () => {
  const now = Date.now();
  const fix = (lat, lng, dtSec) => ({ lat, lng, ts: now + dtSec * 1000 });

  test('段距 < 5m 视为 GPS 抖动拒收', () => {
    // 0.00001° ≈ 1.1 米
    assert.equal(ExerciseTracker.acceptSegment(fix(0, 0, 0), fix(0, 0.00001, 5)), null);
  });

  test('隐含速度超限拒收（防漂移瞬移）', () => {
    // 0.01° 纬度 ≈ 1113 米，5 秒内 → ~800 km/h
    assert.equal(ExerciseTracker.acceptSegment(fix(0, 0, 0), fix(0.01, 0, 5), { maxKmh: 30 }), null);
  });

  test('正常步行段接受：100 米 / 60 秒 = 6 km/h', () => {
    // 0.0009° 纬度 ≈ 100 米
    const m = ExerciseTracker.acceptSegment(fix(0, 0, 0), fix(0.0009, 0, 60), { maxKmh: 20 });
    assert.ok(m !== null && Math.abs(m - 100) < 2, `实际 ${m}`);
  });

  test('速度上限随运动类型：骑行 60km/h 可接受', () => {
    // 0.05° 纬度 ≈ 5557 米，6 分钟 → 55.6 km/h（骑行合理）
    const m = ExerciseTracker.acceptSegment(fix(0, 0, 0), fix(0.05, 0, 360), { maxKmh: 60 });
    assert.ok(m !== null);
  });
});

// ===== 批量轨迹累计 =====

describe('accumulatePath', () => {
  const now = Date.now();
  const f = (lat, lng, accuracy, dtSec) => ({ lat, lng, accuracy, ts: now + dtSec * 1000 });

  test('过滤精度差的点 + 段距抖动 + 累计正常段', () => {
    const fixes = [
      f(0, 0, 5, 0),        // 锚点
      f(0, 0.00001, 5, 5),  // 抖动 ~1m → 拒收（锚点仍更新）
      f(0, 0.0009, 5, 65),  // 正常 ~100m / 60s → 接受
      f(0, 0.0009, 80, 70), // 精度 80m > 30 → 丢弃
      f(0, 0.0018, 5, 125)  // 正常 ~100m / 60s → 接受
    ];
    const r = ExerciseTracker.accumulatePath(fixes);
    assert.ok(Math.abs(r.distanceM - 200) < 4, `实际 ${r.distanceM}`);
    assert.equal(r.usedFixes, 3);
    assert.equal(r.droppedFixes, 2);
  });

  test('瞬移点拒收并作为新锚点（后续点不被误累计大距离）', () => {
    const fixes = [
      f(0, 0, 5, 0),
      f(0.05, 0, 5, 10),    // 瞬移 ~5.5km / 10s → 拒收，成为新锚点
      f(0.0509, 0, 5, 370)  // 从新锚点走 ~100m → 接受
    ];
    const r = ExerciseTracker.accumulatePath(fixes);
    assert.ok(Math.abs(r.distanceM - 100) < 4, `实际 ${r.distanceM}`);
  });

  test('空轨迹返回 0', () => {
    assert.equal(ExerciseTracker.accumulatePath([]).distanceM, 0);
    assert.equal(ExerciseTracker.accumulatePath(null).distanceM, 0);
  });
});

// ===== 秒表格式化 =====

describe('formatElapsed', () => {
  test('mm:ss 与 h:mm:ss', () => {
    assert.equal(ExerciseTracker.formatElapsed(0), '00:00');
    assert.equal(ExerciseTracker.formatElapsed(59666), '00:59');
    assert.equal(ExerciseTracker.formatElapsed(1500000), '25:00'); // 25 分钟
    assert.equal(ExerciseTracker.formatElapsed(3660000), '1:01:00');
  });
});

// ===== 状态持久化与秒表流程 =====

describe('ExerciseTracker 秒表流程', () => {
  test('start → getRunning 活跃且 elapsed 实时计算；状态文件落盘', async () => {
    const { fm, tracker } = newTracker();
    const r = await tracker.start({ name: '饭后快走', icon: '🚶', typeKey: 'walk', presetId: 'p1', gps: false });
    assert.equal(r.started, true);
    const running = await tracker.getRunning();
    assert.ok(running);
    assert.equal(running.name, '饭后快走');
    assert.equal(running.gpsEnabled, false);
    assert.ok(running.elapsedMs >= 0 && running.elapsedMs < 5000);
    assert.ok(fm.files.has('.meta/exercise-timer.json'));
    const state = JSON.parse(fm.files.get('.meta/exercise-timer.json'));
    assert.equal(state.active, true);
  });

  test('stop 返回时长且清理状态文件', async () => {
    const { fm, tracker } = newTracker();
    await tracker.start({ name: '篮球', icon: '🏀', typeKey: 'basketball', gps: false });
    const r = await tracker.stop();
    assert.equal(r.name, '篮球');
    assert.ok(r.durationMin >= 1);
    assert.equal(r.distanceKm, null); // 无 GPS 无距离
    assert.equal(await tracker.getRunning(), null);
    assert.ok(!fm.files.has('.meta/exercise-timer.json'));
  });

  test('stop 距离取内存与持久化较大值（节流不丢距离）', async () => {
    const { tracker } = newTracker();
    await tracker.start({ name: '快走', typeKey: 'walk', gps: true });
    tracker._distanceM = 620; // 模拟内存累计（未到 15s 节流点）
    const r = await tracker.stop();
    assert.equal(r.distanceKm, 0.6);
  });

  test('cancel 清理状态', async () => {
    const { tracker } = newTracker();
    await tracker.start({ name: '测试', typeKey: 'other', gps: false });
    await tracker.cancel();
    assert.equal(await tracker.getRunning(), null);
  });

  test('重复 start 覆盖旧的计时（只允许一个活动计时）', async () => {
    const { tracker } = newTracker();
    await tracker.start({ name: '第一次', typeKey: 'walk', gps: false });
    await tracker.start({ name: '第二次', typeKey: 'run', gps: false });
    const running = await tracker.getRunning();
    assert.equal(running.name, '第二次');
  });

  test('GPS 不可用环境 start 降级为仅计时（reason=no_provider）', async () => {
    const { tracker } = newTracker();
    const r = await tracker.start({ name: '自由运动', typeKey: 'other', gps: true });
    assert.equal(r.gpsActive, false);
    assert.equal(r.gpsReason, 'no_provider');
  });

  test('_ingestFix 增量累计与 accumulatePath 口径一致', () => {
    const { tracker } = newTracker();
    const now = Date.now();
    const f = (lat, lng, dtSec) => ({ lat, lng, accuracy: 5, ts: now + dtSec * 1000 });
    tracker._ingestFix(f(0, 0, 0), 20);
    tracker._ingestFix(f(0, 0.00001, 5), 20); // 抖动拒收
    tracker._ingestFix(f(0, 0.0009, 65), 20); // ~100m 接受
    tracker._ingestFix(f(0, 0.0009, 70), 20); // 精度 5 但段距 0 → 拒收
    tracker._ingestFix(f(0, 0.0018, 125), 20); // ~100m 接受
    assert.ok(Math.abs(tracker.getLiveDistanceM() - 200) < 4, `实际 ${tracker.getLiveDistanceM()}`);
  });
});
