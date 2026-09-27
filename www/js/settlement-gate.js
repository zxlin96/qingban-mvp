// settlement-gate.js — 跨天结算队列的单一入口闸门（v3.12.0）
// 解决的冲突：夜间自动重试定时器、用户打开 App 的恢复路径、后台对齐触发、运行中跨天检测
// 都可能想启动结算队列——闸门保证同一时刻只有一个队列在跑，挂起的重试会被后来者接管时取消。
//
// 状态机: idle → running → idle；失败后在重试窗口内可排程 retryScheduled（15 分钟后回调 runFn），
// 回调触发前任何 claim() 都会取消该定时器并由调用方接管。
export class SettlementGate {
  constructor({
    retryDelayMs = 15 * 60 * 1000,
    windowStart = 4,   // 重试窗口起始小时（含）
    windowEnd = 9,     // 重试窗口结束小时（不含）——9 点封顶
    maxRetryRounds = 2,
    setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
    clearTimeoutFn = (t) => clearTimeout(t),
    nowFn = () => new Date(),
  } = {}) {
    this._retryDelayMs = retryDelayMs;
    this._windowStart = windowStart;
    this._windowEnd = windowEnd;
    this._maxRetryRounds = maxRetryRounds;
    this._setTimeoutFn = setTimeoutFn;
    this._clearTimeoutFn = clearTimeoutFn;
    this._nowFn = nowFn;
    this.state = 'idle'; // idle | running | retryScheduled
    this.retryRounds = 0; // 本轮结算已自动重试的轮数
    this._timer = null;
  }

  // 认领队列：running 时拒绝（false）；retryScheduled 时取消挂起的重试并由调用方接管（true）
  claim() {
    if (this.state === 'running') return false;
    if (this._timer) {
      this._clearTimeoutFn(this._timer);
      this._timer = null;
    }
    this.state = 'running';
    return true;
  }

  release() {
    if (this._timer) {
      this._clearTimeoutFn(this._timer);
      this._timer = null;
    }
    this.state = 'idle';
  }

  // 队列结束仍有失败时排程自动重试。窗口外 / 超过轮数上限 / 状态非 idle 时拒绝
  // 返回 true 表示已排程；runFn 触发时调用方需重新 claim()
  scheduleRetry(runFn) {
    if (this.state !== 'idle') return false;
    if (this.retryRounds >= this._maxRetryRounds) return false;
    const hour = this._nowFn().getHours();
    if (hour < this._windowStart || hour >= this._windowEnd) return false;
    this.retryRounds++;
    this.state = 'retryScheduled';
    this._timer = this._setTimeoutFn(() => {
      this._timer = null;
      runFn();
    }, this._retryDelayMs);
    return true;
  }

  // 新的一天开始全新结算 → 清零重试轮数
  resetRounds() {
    this.retryRounds = 0;
  }

  destroy() {
    this.release();
  }
}
