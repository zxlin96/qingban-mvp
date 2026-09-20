// notification-manager.js
// 通知管理模块 — 大模型可通过 send_notification 工具发送提醒通知
// 双轨适配：Capacitor 原生环境走 @capacitor/local-notifications（系统级调度，App 被杀后仍可达）；
// Web 环境降级 Web Notification API + 应用内横幅（本地开发路径，行为不回退）。
// 存储：IndexedDB（.meta/notifications.json 待发队列 / .meta/daily-reminders.json 每日定点配置）
// 启动时 reconcile：系统已注册通知与本地存储对账，静默补标记 / 重新注册 / 清理孤儿。

const DAILY_IDS = { morning: 8601, habitNoon: 8602, habitEvening: 8603, evening: 8604 };

export class NotificationManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.storageKey = '.meta/notifications.json';
    this.dailyKey = '.meta/daily-reminders.json';
    this.timers = new Map();       // id -> setTimeout handle（Web 轨道）
    this.checkInterval = null;
    this.onFire = null;            // 回调：通知触发时调用 (notif) => {}（应用内横幅）
    this.onNotificationTap = null; // 回调：系统通知被点击 (extra) => {}
  }

  // 原生插件获取（Web 环境返回 null — www 不含 node_modules，只能走 window.Capacitor 桥接）
  _native() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  // 初始化：权限检查、对账、恢复待发通知、启动定期检查、绑定点击路由
  async init() {
    const ln = this._native();
    if (ln) {
      try {
        const st = await ln.checkPermissions();
        if (st?.display === 'granted') {
          await this._reconcileNative(ln);
        }
      } catch (e) {
        console.warn('[NotificationManager] 原生通知初始化失败:', e?.message || e);
      }
      // 系统通知点击 → 路由到对应面板
      try {
        ln.addListener('localNotificationActionPerformed', (action) => {
          const extra = action?.notification?.extra || {};
          if (this.onNotificationTap) {
            try { this.onNotificationTap(extra); } catch (e) { console.error('[NotificationManager] onNotificationTap error:', e); }
          }
        });
      } catch (e) {
        console.warn('[NotificationManager] 点击监听注册失败:', e?.message || e);
      }
    }

    // 恢复待发通知（Web 轨道）
    await this._restorePending();

    // 启动定期检查（每 30 秒检查一次是否有到期通知 + Web 每日提醒兜底）
    this.checkInterval = setInterval(() => this._checkDue(), 30000);

    // 立即检查一次（可能有错过的通知）
    setTimeout(() => this._checkDue(), 2000);
  }

  // 请求通知权限（原生走 LocalNotifications，Web 走浏览器 API）
  async requestPermission() {
    const ln = this._native();
    if (ln) {
      try {
        const st = await ln.checkPermissions();
        if (st?.display === 'granted') return 'granted';
        if (st?.display === 'denied') return 'denied';
        const r = await ln.requestPermissions();
        return r?.display || 'prompt';
      } catch (e) {
        console.warn('[NotificationManager] 原生权限请求失败:', e?.message || e);
        return 'unsupported';
      }
    }
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch {
      return 'unsupported';
    }
  }

  // 调度一个通知（立即 / 延迟）
  // 返回 { id, title, message, type, fireAt, status }
  async schedule({ title, message, delayMinutes = 0, type = 'custom' }) {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const fireAt = now + delayMinutes * 60 * 1000;

    const notif = {
      id,
      lnId: Math.floor(Math.random() * 2000000000) + 100, // 原生系统通知数字 id
      title,
      message,
      type,           // water / meal / exercise / weight / sleep / custom
      delayMinutes,
      createdAt: new Date().toISOString(),
      fireAt,         // timestamp
      fired: false,
      acknowledged: false,
      native: false   // 是否已注册到系统级调度
    };

    // 存储到 IndexedDB
    const pending = await this._loadPending();
    pending.push(notif);
    await this._savePending(pending);

    if (delayMinutes <= 0) {
      // 立即通知：用户正在使用 App，应用内横幅为主（原生环境不再叠加系统通知）
      await this._fire(notif);
    } else {
      const ln = this._native();
      if (ln) {
        // 延迟通知：系统级调度，App 被杀后由系统 AlarmManager 兜底
        notif.native = true;
        await this._updatePending(notif);
        await this._scheduleNativeOnce(ln, notif);
      } else {
        const delayMs = fireAt - Date.now();
        if (delayMs > 0) {
          const timer = setTimeout(() => this._fire(notif), delayMs);
          this.timers.set(id, timer);
        } else {
          await this._fire(notif);
        }
      }
    }

    return {
      id: notif.id,
      title: notif.title,
      message: notif.message,
      type: notif.type,
      fireAt: new Date(fireAt).toISOString(),
      status: delayMinutes <= 0 ? 'fired' : 'scheduled'
    };
  }

  // 注册每日定点提醒（晨间问候 / 打卡提醒 / 晚间复盘）
  // items: [{ key, enabled, hour, minute, title, body, type }]，key 见 DAILY_IDS
  // 原生：系统级 repeating（schedule.on，allowWhileIdle）；Web：写入配置，由 _checkDue 轮询补发横幅
  // 幂等：先 cancel 旧 id 再注册；权限未授予时仅保存配置、跳过原生注册（等设置页开启时再触发）
  async syncDailyReminders(items) {
    const list = (items || []).filter(it => it && DAILY_IDS[it.key]);
    const prev = await this._loadDaily();
    const ln = this._native();

    let nativeReady = false;
    if (ln) {
      try {
        const st = await ln.checkPermissions();
        nativeReady = st?.display === 'granted';
      } catch (_) { nativeReady = false; }
    }

    // 取消之前注册过、现在未启用或已移除的
    for (const d of prev) {
      const active = list.find(x => x.key === d.key && x.enabled);
      if (!active && ln) {
        try { await ln.cancel({ notifications: [{ id: DAILY_IDS[d.key] }] }); } catch (_) {}
      }
    }

    const next = [];
    for (const it of list) {
      if (!it.enabled) continue;
      const entry = {
        key: it.key,
        hour: it.hour | 0,
        minute: it.minute | 0,
        title: it.title || '',
        body: it.body || '',
        type: it.type || 'custom',
        updatedAt: new Date().toISOString()
      };
      next.push(entry);
      if (ln && nativeReady) {
        try { await ln.cancel({ notifications: [{ id: DAILY_IDS[it.key] }] }); } catch (_) {}
        try {
          await ln.schedule({
            notifications: [{
              id: DAILY_IDS[it.key],
              title: entry.title,
              body: entry.body,
              schedule: { on: { hour: entry.hour, minute: entry.minute }, allowWhileIdle: true },
              extra: { kind: 'daily', reminderKey: it.key, type: entry.type }
            }]
          });
        } catch (e) {
          console.warn('[NotificationManager] 每日提醒注册失败:', e?.message || e);
        }
      }
    }

    await this.fm.writeFile(this.dailyKey, JSON.stringify(next));
    return { registered: next.length, native: ln ? nativeReady : false, items: next };
  }

  // 获取所有待发通知（未触发的）
  async getPending() {
    const pending = await this._loadPending();
    return pending.filter(n => !n.fired);
  }

  // 获取通知历史（已触发的）
  async getHistory() {
    const pending = await this._loadPending();
    return pending.filter(n => n.fired);
  }

  // 取消一个待发通知
  async cancel(id) {
    const pending = await this._loadPending();
    const idx = pending.findIndex(n => n.id === id);
    if (idx === -1) return false;
    const notif = pending[idx];

    pending.splice(idx, 1);
    await this._savePending(pending);

    if (notif.native && notif.lnId) {
      const ln = this._native();
      if (ln) { try { await ln.cancel({ notifications: [{ id: notif.lnId }] }); } catch (_) {} }
    }

    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    return true;
  }

  // 清除已触发的历史通知（保留最近 50 条）
  async cleanHistory() {
    const pending = await this._loadPending();
    const unfired = pending.filter(n => !n.fired);
    const fired = pending.filter(n => n.fired).slice(-50);
    await this._savePending([...unfired, ...fired]);
  }

  // ===== 通知文案模板（纯静态函数，可单测）=====
  // 约束：LocalNotifications 的内容是预置的，发送时不能跑 LLM — 文案 = 模板 + 结构化数据

  // 晨间问候：昨日体重变化 + 昨日打卡概况
  static buildMorningBrief({ yesterdayWeight, prevWeight, yesterdayCheckins } = {}) {
    const parts = [];
    if (typeof yesterdayWeight === 'number') {
      let seg = `昨天体重 ${yesterdayWeight}kg`;
      if (typeof prevWeight === 'number') {
        const delta = +(yesterdayWeight - prevWeight).toFixed(1);
        seg += delta === 0 ? '（持平）' : `（${delta > 0 ? '+' : ''}${delta}kg）`;
      }
      parts.push(seg);
    }
    if (yesterdayCheckins > 0) parts.push(`昨天完成 ${yesterdayCheckins} 次打卡，继续保持！`);
    if (parts.length === 0) parts.push('新的一天从一顿好早餐开始');
    return `${parts.join('。')}。点开和我聊聊今天的计划吧`;
  }

  // 打卡提醒（系统级定点 — 注册时无法预知当日进度，用通用文案，点击进打卡面板看真实进度）
  static buildHabitReminderText() {
    return '该打卡啦 ✅ 点开看看今天的习惯进度';
  }

  // 晚间复盘提醒
  static buildEveningReviewText() {
    return '今天还没记体重吗？睡前称一称，数据更准 ⚖️';
  }

  // 静默时段：22:00 ~ 次日 7:00
  static isQuietHours(hour) {
    return hour >= 22 || hour < 7;
  }

  // '08:30' → { hour: 8, minute: 30 }（非法返回 null）
  static parseTime(str) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str || '').trim());
    if (!m) return null;
    return { hour: parseInt(m[1]), minute: parseInt(m[2]) };
  }

  // ===== 内部方法 =====

  // 注册一次性系统通知（失败降级为 Web 轨道 setTimeout）
  async _scheduleNativeOnce(ln, notif) {
    try {
      await ln.schedule({
        notifications: [{
          id: notif.lnId,
          title: notif.title,
          body: notif.message,
          schedule: { at: new Date(notif.fireAt), allowWhileIdle: true },
          extra: { refId: notif.id, type: notif.type, kind: 'once' }
        }]
      });
    } catch (e) {
      console.warn('[NotificationManager] 系统通知注册失败，降级为内存定时:', e?.message || e);
      notif.native = false;
      await this._updatePending(notif);
      const delay = Math.max(0, notif.fireAt - Date.now());
      this.timers.set(notif.id, setTimeout(() => this._fire(notif), delay));
    }
  }

  // 启动对账：系统已注册通知 ↔ 本地待发存储
  async _reconcileNative(ln) {
    let scheduled = [];
    try { scheduled = await ln.getScheduled(); } catch { return; }
    const schedIds = new Set(scheduled.map(n => n.id));
    const pending = await this._loadPending();
    const now = Date.now();

    for (const notif of pending) {
      if (notif.fired || !notif.native) continue;
      if (schedIds.has(notif.lnId)) continue;
      if (notif.fireAt <= now) {
        // 系统已触发但 App 内未标记（触发时 App 未运行）→ 静默补标记，不弹横幅
        await this._markFired(notif);
      } else {
        // 系统调度丢失（重装/清数据）→ 重新注册
        await this._scheduleNativeOnce(ln, notif);
      }
    }

    // 清理系统侧孤儿（存储中已不存在/已触发的 once 通知）；每日定点的固定 id 始终保留
    const keepIds = new Set(
      pending.filter(n => !n.fired && n.native).map(n => n.lnId)
        .concat(Object.values(DAILY_IDS))
    );
    const orphans = scheduled.filter(n => !keepIds.has(n.id));
    if (orphans.length > 0) {
      try { await ln.cancel({ notifications: orphans.map(n => ({ id: n.id })) }); } catch (_) {}
    }
  }

  // 触发通知（标记已触发 + 横幅 + Web 系统通知）
  async _fire(notif) {
    await this._markFired(notif);

    if (this.onFire) {
      try {
        this.onFire(notif);
      } catch (e) {
        console.error('[NotificationManager] onFire error:', e);
      }
    }

    this._sendSystemNotification(notif);
  }

  // 仅标记已触发（静默，不弹 UI — reconcile 补标记用）
  async _markFired(notif) {
    notif.fired = true;
    notif.firedAt = new Date().toISOString();
    await this._updatePending(notif);
    this.timers.delete(notif.id);
  }

  // 发送系统级通知（Web 轨道，浏览器 Notification API；原生轨道已由 LocalNotifications 承担）
  _sendSystemNotification(notif) {
    if (this._native()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
      const sysNotif = new Notification(notif.title, {
        body: notif.message,
        icon: '/icon.png',
        tag: notif.id,
        requireInteraction: false
      });

      // 5 秒后自动关闭
      setTimeout(() => sysNotif.close(), 5000);

      // 点击通知聚焦窗口
      sysNotif.onclick = () => {
        window.focus();
        sysNotif.close();
      };
    } catch (e) {
      console.warn('[NotificationManager] 系统通知发送失败:', e);
    }
  }

  // 恢复待发通知（应用重启后，Web 轨道）
  async _restorePending() {
    const pending = await this._loadPending();
    const now = Date.now();

    for (const notif of pending) {
      if (notif.fired) continue;
      if (notif.native) continue; // 原生轨道由系统调度 + reconcile 对账，App 内不再挂 timer

      const fireAt = notif.fireAt;
      if (fireAt <= now) {
        await this._fire(notif);
      } else {
        const delayMs = fireAt - now;
        const timer = setTimeout(() => this._fire(notif), delayMs);
        this.timers.set(notif.id, timer);
      }
    }
  }

  // 定期检查是否有到期通知 + Web 每日提醒兜底
  async _checkDue() {
    const pending = await this._loadPending();
    const now = Date.now();

    for (const notif of pending) {
      if (notif.fired) continue;
      if (notif.native) continue; // 原生轨道由系统负责
      if (notif.fireAt <= now && !this.timers.has(notif.id)) {
        await this._fire(notif);
      }
    }

    if (!this._native()) await this._checkDailyDue();
  }

  // Web 环境每日定点提醒兜底（原生由系统 repeating 调度）
  async _checkDailyDue() {
    const daily = await this._loadDaily();
    if (daily.length === 0) return;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const d of daily) {
      if (nowMin < d.hour * 60 + d.minute) continue;
      if (d.lastFiredDate === today) continue;
      d.lastFiredDate = today;
      await this.fm.writeFile(this.dailyKey, JSON.stringify(daily));
      const notif = { id: `daily-${d.key}-${today}`, title: d.title, message: d.body, type: d.type };
      if (this.onFire) {
        try { this.onFire(notif); } catch (_) {}
      }
      this._sendSystemNotification(notif);
    }
  }

  // 从 IndexedDB 加载待发通知列表
  async _loadPending() {
    const raw = await this.fm.readFile(this.storageKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  // 保存待发通知列表到 IndexedDB
  async _savePending(notifications) {
    await this.fm.writeFile(this.storageKey, JSON.stringify(notifications));
  }

  // 更新单条待发通知
  async _updatePending(notif) {
    const pending = await this._loadPending();
    const idx = pending.findIndex(n => n.id === notif.id);
    if (idx !== -1) {
      pending[idx] = notif;
      await this._savePending(pending);
    }
  }

  // 加载每日提醒配置
  async _loadDaily() {
    const raw = await this.fm.readFile(this.dailyKey);
    if (!raw) return [];
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }
}
