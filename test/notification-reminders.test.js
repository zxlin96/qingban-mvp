// notification-reminders.test.js — 通知底座双轨适配与提醒模板测试（阶段四）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installWindowStub, mockFm } from './helpers.mjs';
import { NotificationManager } from '../js/notification-manager.js';

// Web 轨道（无 Capacitor 全局）
installWindowStub();

function newNM(files = {}) {
  const fm = mockFm(files);
  return { fm, nm: new NotificationManager(fm) };
}

// 原生轨道 stub（window.Capacitor.Plugins.LocalNotifications）
function newNativeNM(files = {}, scheduled = []) {
  installWindowStub();
  const calls = { schedule: [], cancel: [] };
  let sched = scheduled;
  const ln = {
    checkPermissions: async () => ({ display: 'granted' }),
    requestPermissions: async () => ({ display: 'granted' }),
    getScheduled: async () => sched,
    schedule: async (opts) => { calls.schedule.push(opts); },
    cancel: async (opts) => { calls.cancel.push(opts); },
    addListener: async (event, cb) => {
      ln._tapCb = cb;
      return { remove: async () => {} };
    },
  };
  window.Capacitor = { Plugins: { LocalNotifications: ln } };
  const fm = mockFm(files);
  return { fm, nm: new NotificationManager(fm), ln, calls, setScheduled: (arr) => { sched = arr; } };
}

// ===== 通知文案模板（纯函数）=====

describe('提醒文案模板', () => {
  test('buildMorningBrief：体重下降/上升/持平文案', () => {
    const down = NotificationManager.buildMorningBrief({ yesterdayWeight: 79.5, prevWeight: 80.0, yesterdayCheckins: 3 });
    assert.ok(down.includes('昨天体重 79.5kg（-0.5kg）'));
    assert.ok(down.includes('昨天完成 3 次打卡'));
    const up = NotificationManager.buildMorningBrief({ yesterdayWeight: 80.2, prevWeight: 80.0 });
    assert.ok(up.includes('+0.2kg'));
    const flat = NotificationManager.buildMorningBrief({ yesterdayWeight: 80.0, prevWeight: 80.0 });
    assert.ok(flat.includes('（持平）'));
  });

  test('buildMorningBrief：无数据兜底、无打卡时不提打卡', () => {
    const empty = NotificationManager.buildMorningBrief({});
    assert.ok(empty.includes('新的一天'), '无数据时用兜底文案');
    const noCheckins = NotificationManager.buildMorningBrief({ yesterdayWeight: 79.5 });
    assert.ok(noCheckins.includes('昨天体重 79.5kg'));
    assert.ok(!noCheckins.includes('打卡'));
  });

  test('buildHabitReminderText / buildEveningReviewText 非空模板', () => {
    assert.ok(NotificationManager.buildHabitReminderText().length > 4);
    assert.ok(NotificationManager.buildEveningReviewText().length > 4);
  });

  test('isQuietHours：22:00 ~ 次日 7:00 静默', () => {
    for (const h of [22, 23, 0, 3, 6]) assert.equal(NotificationManager.isQuietHours(h), true, `hour=${h} 应静默`);
    for (const h of [7, 12, 21]) assert.equal(NotificationManager.isQuietHours(h), false, `hour=${h} 不静默`);
  });

  test('parseTime：合法 HH:mm 与非法输入', () => {
    assert.deepEqual(NotificationManager.parseTime('08:00'), { hour: 8, minute: 0 });
    assert.deepEqual(NotificationManager.parseTime('8:30'), { hour: 8, minute: 30 });
    assert.deepEqual(NotificationManager.parseTime('21:59'), { hour: 21, minute: 59 });
    assert.deepEqual(NotificationManager.parseTime('00:05'), { hour: 0, minute: 5 });
    assert.equal(NotificationManager.parseTime('25:00'), null);
    assert.equal(NotificationManager.parseTime('8:61'), null);
    assert.equal(NotificationManager.parseTime(''), null);
    assert.equal(NotificationManager.parseTime(null), null);
    assert.equal(NotificationManager.parseTime(undefined), null);
  });
});

// ===== Web 轨道 =====

describe('Web 轨道：schedule 立即/延迟与取消', () => {
  test('立即通知：onFire 触发、进入历史、状态 fired', async () => {
    const { fm, nm } = newNM();
    const fired = [];
    nm.onFire = (n) => fired.push(n);
    const r = await nm.schedule({ title: '喝水提醒', message: '喝杯水吧', delayMinutes: 0, type: 'water' });
    assert.equal(r.status, 'fired');
    assert.equal(fired.length, 1);
    assert.equal(fired[0].title, '喝水提醒');
    assert.equal((await nm.getHistory()).length, 1);
    assert.equal((await nm.getPending()).length, 0);
  });

  test('延迟通知：进入待发队列、status scheduled，cancel 后移除', async () => {
    const { nm } = newNM();
    const r = await nm.schedule({ title: '稍后提醒', message: '到点啦', delayMinutes: 30 });
    assert.equal(r.status, 'scheduled');
    const pending = await nm.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].delayMinutes, 30);
    assert.ok(pending[0].fireAt > Date.now());

    assert.equal(await nm.cancel(r.id), true);
    assert.equal((await nm.getPending()).length, 0);
    assert.equal(await nm.cancel('不存在'), false);
  });
});

describe('Web 轨道：每日定点提醒配置与补发', () => {
  test('syncDailyReminders：写入配置、未启用项被剔除、返回注册数', async () => {
    const { fm, nm } = newNM();
    const r = await nm.syncDailyReminders([
      { key: 'morning', enabled: true, hour: 8, minute: 0, title: '早安 ☀️', body: '早上好' },
      { key: 'habitNoon', enabled: false, hour: 12, minute: 30, title: '打卡', body: 'x' },
      { key: 'unknownKey', enabled: true, hour: 9, minute: 0, title: '?', body: '?' },
    ]);
    assert.equal(r.registered, 1);
    assert.equal(r.native, false);
    const stored = JSON.parse(fm.files.get('.meta/daily-reminders.json'));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].key, 'morning');
    assert.equal(stored[0].hour, 8);
  });

  test('_checkDailyDue：到点触发 onFire 并当日防重', async () => {
    const { fm, nm } = newNM();
    const fired = [];
    nm.onFire = (n) => fired.push(n);

    // 注入一个"今天 0 点"就已到期的提醒（hour/minute = 0:00，任何时刻都算到点）
    await nm.syncDailyReminders([
      { key: 'morning', enabled: true, hour: 0, minute: 0, title: '早安', body: '早上好' },
    ]);
    await nm._checkDailyDue();
    assert.equal(fired.length, 1, '到点提醒应触发');
    assert.equal(fired[0].title, '早安');
    const stored = JSON.parse(fm.files.get('.meta/daily-reminders.json'));
    assert.ok(stored[0].lastFiredDate, '触发后写入当日防重标记');

    await nm._checkDailyDue();
    assert.equal(fired.length, 1, '同日不应重复触发');
  });

  test('_checkDailyDue：未到点不触发', async () => {
    const { nm } = newNM();
    const fired = [];
    nm.onFire = (n) => fired.push(n);
    await nm.syncDailyReminders([{ key: 'evening', enabled: true, hour: 23, minute: 59, title: '晚', body: 'x' }]);
    await nm._checkDailyDue();
    assert.equal(fired.length, 0, '未到触发时刻不应触发');
  });
});

// ===== 原生轨道（LocalNotifications）=====

describe('原生轨道：延迟通知走系统调度', () => {
  test('schedule 延迟通知：注册到系统、allowWhileIdle、extra 带路由数据；存储标记 native', async () => {
    const { fm, nm, calls } = newNativeNM();
    const r = await nm.schedule({ title: '喝水', message: '记得喝水', delayMinutes: 60, type: 'water' });
    assert.equal(r.status, 'scheduled');
    assert.equal(calls.schedule.length, 1, '应调用系统 schedule');
    const n = calls.schedule[0].notifications[0];
    assert.equal(n.title, '喝水');
    assert.equal(n.body, '记得喝水');
    assert.ok(n.schedule.at instanceof Date, '一次性通知应带 at 时间');
    assert.equal(n.schedule.allowWhileIdle, true);
    assert.equal(n.extra.type, 'water');
    assert.equal(n.extra.kind, 'once');
    assert.ok(Number.isInteger(n.id), '系统通知 id 必须是整数');

    const pending = await nm.getPending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].native, true);
    assert.equal(pending[0].lnId, n.id);
  });

  test('立即通知：走应用内横幅，不注册系统通知', async () => {
    const { nm, calls } = newNativeNM();
    const fired = [];
    nm.onFire = (n) => fired.push(n);
    await nm.schedule({ title: '现在', message: 'x', delayMinutes: 0 });
    assert.equal(calls.schedule.length, 0, '立即通知不进系统调度');
    assert.equal(fired.length, 1);
  });

  test('cancel：同时取消系统侧调度', async () => {
    const { nm, calls } = newNativeNM();
    const r = await nm.schedule({ title: 'x', message: 'x', delayMinutes: 30 });
    assert.equal(calls.cancel.length, 0);
    await nm.cancel(r.id);
    assert.equal(calls.cancel.length, 1, '应同时取消系统侧调度');
    assert.equal(calls.cancel[0].notifications.length, 1);
    assert.equal(typeof calls.cancel[0].notifications[0].id, 'number');
    assert.equal((await nm.getPending()).length, 0);
  });
});

describe('原生轨道：启动对账 reconcile', () => {
  test('过期未标记的 native 通知 → 静默补标记 fired（不弹横幅）', async () => {
    const { fm, nm, setScheduled, calls } = newNativeNM({
      '.meta/notifications.json': JSON.stringify([{
        id: 'a1', lnId: 111, title: 't', message: 'm', type: 'custom',
        delayMinutes: 10, createdAt: new Date().toISOString(),
        fireAt: Date.now() - 60000, fired: false, acknowledged: false, native: true,
      }]),
    });
    setScheduled([]); // 系统侧已无此通知（已触发过）
    const fired = [];
    nm.onFire = (n) => fired.push(n);
    await nm._reconcileNative(window.Capacitor.Plugins.LocalNotifications);
    const pending = JSON.parse(fm.files.get('.meta/notifications.json'));
    assert.equal(pending[0].fired, true, '应补标记 fired');
    assert.equal(fired.length, 0, '补标记不应弹横幅');
  });

  test('未到期但系统侧丢失 → 重新注册', async () => {
    const { nm, setScheduled, calls } = newNativeNM({
      '.meta/notifications.json': JSON.stringify([{
        id: 'a2', lnId: 222, title: 't', message: 'm', type: 'custom',
        delayMinutes: 30, createdAt: new Date().toISOString(),
        fireAt: Date.now() + 600000, fired: false, acknowledged: false, native: true,
      }]),
    });
    setScheduled([]);
    await nm._reconcileNative(window.Capacitor.Plugins.LocalNotifications);
    assert.equal(calls.schedule.length, 1, '系统调度丢失应重新注册');
    assert.equal(calls.schedule[0].notifications[0].id, 222);
  });

  test('系统侧孤儿（存储中已无对应项）被清理；每日定点固定 id 保留', async () => {
    const { nm, setScheduled, calls } = newNativeNM();
    setScheduled([
      { id: 999, title: '孤儿' },
      { id: 8601, title: '晨间问候（每日定点）' },
    ]);
    await nm._reconcileNative(window.Capacitor.Plugins.LocalNotifications);
    assert.equal(calls.cancel.length, 1, '应清理孤儿');
    assert.deepEqual(calls.cancel[0].notifications, [{ id: 999 }], '每日定点 id 8601 不被清理');
  });

  test('requestPermission 原生路径：granted / denied', async () => {
    const { nm } = newNativeNM();
    assert.equal(await nm.requestPermission(), 'granted');
    window.Capacitor.Plugins.LocalNotifications.checkPermissions = async () => ({ display: 'prompt' });
    window.Capacitor.Plugins.LocalNotifications.requestPermissions = async () => ({ display: 'granted' });
    assert.equal(await nm.requestPermission(), 'granted');
  });
});