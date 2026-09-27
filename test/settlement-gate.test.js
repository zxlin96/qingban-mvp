// settlement-gate.test.js — 结算队列单一入口闸门（v3.12.0 防冲突核心）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SettlementGate } from '../js/settlement-gate.js';

function makeGate({ now = new Date(2026, 8, 28, 5, 0), ...rest } = {}) {
  const timers = [];
  const gate = new SettlementGate({
    setTimeoutFn: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeoutFn: (t) => { const i = timers.findIndex((_, idx) => idx + 1 === t); if (i >= 0) timers.splice(i, 1); },
    nowFn: () => now,
    ...rest,
  });
  return { gate, timers };
}

describe('SettlementGate 单一入口闸门', () => {
  test('claim：idle 可认领，running 拒绝，release 归还', () => {
    const { gate } = makeGate();
    assert.equal(gate.claim(), true);
    assert.equal(gate.state, 'running');
    assert.equal(gate.claim(), false, 'running 时第二个入口必须被拒');
    gate.release();
    assert.equal(gate.state, 'idle');
    assert.equal(gate.claim(), true);
  });

  test('scheduleRetry：running 时拒绝；窗口外（9 点后）拒绝；超轮数拒绝', () => {
    const { gate } = makeGate();
    gate.claim();
    assert.equal(gate.scheduleRetry(() => {}), false, 'running 时不得排程');
    gate.release();

    const { gate: g10 } = makeGate({ now: new Date(2026, 8, 28, 10, 0) });
    assert.equal(g10.scheduleRetry(() => {}), false, '9 点封顶，窗口外不排程');

    const { gate: g4 } = makeGate({ now: new Date(2026, 8, 28, 3, 0) });
    assert.equal(g4.scheduleRetry(() => {}), false, '4 点前不排程');

    const { gate: gMax } = makeGate();
    gMax.retryRounds = 2;
    assert.equal(gMax.scheduleRetry(() => {}), false, '整夜至多 2 轮');
  });

  test('scheduleRetry 成功后：15 分钟定时器挂起，claim 接管时取消重试（防冲突核心）', () => {
    const { gate, timers } = makeGate();
    gate.claim();
    gate.release();
    let fired = 0;
    assert.equal(gate.scheduleRetry(() => fired++), true);
    assert.equal(gate.state, 'retryScheduled');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 15 * 60 * 1000);

    // 用户打开 App → 恢复路径 claim 接管 → 挂起的重试被取消
    assert.equal(gate.claim(), true);
    assert.equal(timers.length, 0, '挂起的重试定时器必须被取消');

    // 重试回调永不触发
    gate.release();
    assert.equal(fired, 0);
  });

  test('重试轮数：每次排程 +1，resetRounds 清零（新的一天全新结算）', () => {
    const { gate } = makeGate();
    gate.release();
    gate.scheduleRetry(() => {});
    gate.release();
    gate.scheduleRetry(() => {});
    gate.release();
    assert.equal(gate.scheduleRetry(() => {}), false, '2 轮后不再排程');
    assert.equal(gate.retryRounds, 2);
    gate.resetRounds();
    assert.equal(gate.scheduleRetry(() => {}), true);
  });

  test('真实定时器：到点触发回调（端到端冒烟）', async () => {
    // 注入假时钟保证在重试窗口内（真实时钟可能不在 4-9 点）
    const gate = new SettlementGate({ retryDelayMs: 15, nowFn: () => new Date(2026, 8, 28, 5, 0) });
    gate.claim();
    gate.release();
    let fired = 0;
    gate.scheduleRetry(() => { fired++; gate.release(); });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(fired, 1);
  });
});
