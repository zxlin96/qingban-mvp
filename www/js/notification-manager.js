// notification-manager.js
// 通知管理模块 — 大模型可通过 send_notification 工具发送提醒通知
// 支持：立即通知、延迟通知、定时通知
// 存储：IndexedDB（.meta/notifications.json）— 重启后恢复待发通知

export class NotificationManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.storageKey = '.meta/notifications.json';
    this.timers = new Map();       // id -> setTimeout handle
    this.checkInterval = null;
    this.onFire = null;            // 回调：通知触发时调用 (id, notif) => {}
  }

  // 初始化：请求权限、恢复待发通知、启动定期检查
  async init() {
    // 恢复待发通知
    await this._restorePending();

    // 启动定期检查（每 30 秒检查一次是否有到期通知）
    this.checkInterval = setInterval(() => this._checkDue(), 30000);

    // 立即检查一次（可能有错过的通知）
    setTimeout(() => this._checkDue(), 2000);
  }

  // 请求浏览器通知权限
  async requestPermission() {
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

  // 调度一个通知
  // 返回 { id, title, message, type, fireAt, status }
  async schedule({ title, message, delayMinutes = 0, type = 'custom' }) {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const fireAt = now + delayMinutes * 60 * 1000;

    const notif = {
      id,
      title,
      message,
      type,           // water / meal / exercise / weight / sleep / custom
      delayMinutes,
      createdAt: new Date().toISOString(),
      fireAt,         // timestamp
      fired: false,
      acknowledged: false
    };

    // 存储到 IndexedDB
    const pending = await this._loadPending();
    pending.push(notif);
    await this._savePending(pending);

    // 如果是立即通知，马上触发
    if (delayMinutes <= 0) {
      await this._fire(notif);
    } else {
      // 设置 setTimeout
      const delayMs = fireAt - Date.now();
      if (delayMs > 0) {
        const timer = setTimeout(() => this._fire(notif), delayMs);
        this.timers.set(id, timer);
      } else {
        // 已经过期，立即触发
        await this._fire(notif);
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

  // 获取所有待发通知（未触发的）
  async getPending() {
    const pending = await this._loadPending();
    return pending.filter(n => !n.fired);
  }

  // 获取今日通知历史（已触发的）
  async getHistory() {
    const pending = await this._loadPending();
    return pending.filter(n => n.fired);
  }

  // 取消一个待发通知
  async cancel(id) {
    const pending = await this._loadPending();
    const idx = pending.findIndex(n => n.id === id);
    if (idx === -1) return false;

    pending.splice(idx, 1);
    await this._savePending(pending);

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

  // ===== 内部方法 =====

  // 触发通知
  async _fire(notif) {
    notif.fired = true;
    notif.firedAt = new Date().toISOString();

    // 更新存储
    const pending = await this._loadPending();
    const idx = pending.findIndex(n => n.id === notif.id);
    if (idx !== -1) {
      pending[idx] = notif;
      await this._savePending(pending);
    }

    // 清除 timer
    this.timers.delete(notif.id);

    // 回调通知 UI
    if (this.onFire) {
      try {
        this.onFire(notif);
      } catch (e) {
        console.error('[NotificationManager] onFire error:', e);
      }
    }

    // 尝试发送系统通知
    this._sendSystemNotification(notif);
  }

  // 发送系统级通知（浏览器 Notification API）
  _sendSystemNotification(notif) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const icons = {
      water: '💧',
      meal: '🍽️',
      exercise: '🏃',
      weight: '⚖️',
      sleep: '😴',
      custom: '🔔'
    };

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

  // 恢复待发通知（应用重启后）
  async _restorePending() {
    const pending = await this._loadPending();
    const now = Date.now();

    for (const notif of pending) {
      if (notif.fired) continue;

      const fireAt = notif.fireAt;
      if (fireAt <= now) {
        // 已过期未触发 → 立即触发
        await this._fire(notif);
      } else {
        // 还没到期 → 重新设置 timer
        const delayMs = fireAt - now;
        const timer = setTimeout(() => this._fire(notif), delayMs);
        this.timers.set(notif.id, timer);
      }
    }
  }

  // 定期检查是否有到期通知
  async _checkDue() {
    const pending = await this._loadPending();
    const now = Date.now();

    for (const notif of pending) {
      if (notif.fired) continue;
      if (notif.fireAt <= now && !this.timers.has(notif.id)) {
        await this._fire(notif);
      }
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
}
