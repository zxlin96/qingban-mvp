// exercise-tracker.js — 运动秒表 + GPS 测距（无 DOM，UI 由 app.js 驱动）
// 秒表：时间一律 Date.now() - startTs 实时计算（面板关闭/进程被杀重开后无漂移），
//       活动状态持久化到 .meta/exercise-timer.json（只存累计距离与锚点，不存原始轨迹点）
// GPS：APK 走 @capacitor/geolocation 原生插件（window.Capacitor.Plugins.Geolocation，
//       接入模式与蓝牙秤 scale-manager 同款：先探测插件，原生不可用降级浏览器 API）；
//       浏览器/PWA 直接 navigator.geolocation（HTTPS/localhost 安全上下文）
// 限制：熄屏后 Android Doze 停 GPS 更新，测距适用于亮屏运动场景；距离可在结束后手动修改。
//       不做前台服务（v1 范围外）。

const TIMER_PATH = '.meta/exercise-timer.json';
// 距离累计低于此米数视为室内/漂移噪声，不作为实测距离返回
const MIN_REPORT_METERS = 50;

export class ExerciseTracker {
  constructor(fileManager) {
    this.fm = fileManager;
    this._watchId = null;      // 平台返回的 watch id（原生字符串/浏览器数字）
    this._anchor = null;       // 最近一个被接受的定位点（增量累计）
    this._distanceM = 0;       // 内存累计距离（持久化节流到 state 文件）
    this._fixes = 0;           // 被接受的定位点数
    this._lastPersistTs = 0;
    this.onTick = null;        // (snapshot) => {} — 定位点更新时回调（非秒表秒级 tick，秒级 tick 由 UI 自驱动）
  }

  // ===== 静态纯函数（可单测）=====

  // 球面两点距离（米），Haversine 公式
  static haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const rad = (d) => d * Math.PI / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // 单段判定：返回接受的距离（米）或 null（拒收）
  // 过滤规则：段距 < minSegment 视为 GPS 抖动；隐含速度 > maxKmh 视为漂移/瞬移
  static acceptSegment(prev, cur, { minSegment = 5, maxKmh = 20 } = {}) {
    const meters = ExerciseTracker.haversineMeters(prev.lat, prev.lng, cur.lat, cur.lng);
    if (meters < minSegment) return null;
    const dtSec = Math.max(1, (cur.ts - prev.ts) / 1000);
    const kmh = (meters / dtSec) * 3.6;
    if (kmh > maxKmh) return null;
    return meters;
  }

  // 批量轨迹累计（纯函数，供测试与状态校验）。fixes: [{lat, lng, accuracy, ts}] 时间升序
  static accumulatePath(fixes, { maxAccuracy = 30, minSegment = 5, maxKmh = 20 } = {}) {
    let distanceM = 0;
    let usedFixes = 0;
    let droppedFixes = 0;
    let anchor = null;
    for (const f of fixes || []) {
      const fix = { lat: f.lat, lng: f.lng, accuracy: f.accuracy ?? 999, ts: f.ts || 0 };
      if (fix.accuracy > maxAccuracy) { droppedFixes++; continue; }
      if (anchor === null) { anchor = fix; usedFixes++; continue; }
      const meters = ExerciseTracker.acceptSegment(anchor, fix, { minSegment, maxKmh });
      if (meters === null) { anchor = fix; droppedFixes++; continue; } // 拒收段也更新锚点（跳变点作为新起点）
      distanceM += meters;
      anchor = fix;
      usedFixes++;
    }
    return { distanceM: Math.round(distanceM), usedFixes, droppedFixes };
  }

  // 秒表格式化：≥1h → h:mm:ss，否则 mm:ss
  static formatElapsed(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // ===== 秒表 =====

  // 开始计时。gps=true 且定位可用时同步开始测距；返回 { started, gpsActive, reason? }
  async start({ name, icon, typeKey, presetId, gps }) {
    if (await this.getRunning()) await this.cancel(); // 已有活动计时 → 先取消旧的（面板只允许一个）
    this._distanceM = 0;
    this._fixes = 0;
    this._anchor = null;
    const state = {
      active: true,
      startTs: Date.now(),
      name: name || '运动',
      icon: icon || '💪',
      typeKey: typeKey || 'other',
      presetId: presetId || null,
      gpsEnabled: false,
      distanceM: 0,
      fixes: 0,
      updatedAt: new Date().toISOString()
    };
    if (gps) {
      const gpsState = await this._startGps(typeKey);
      state.gpsEnabled = gpsState.active;
      if (!gpsState.active) state.gpsReason = gpsState.reason;
    }
    await this._saveState(state);
    return { started: true, gpsActive: state.gpsEnabled, gpsReason: state.gpsReason || null, state };
  }

  // 结束并返回计时结果（不写运动记录 — 落盘由 UI 经 exerciseManager.addRecord 完成）
  async stop() {
    const state = await this._loadState();
    await this._stopGps();
    if (!state || !state.active) return null;
    const elapsedMs = Date.now() - state.startTs;
    // 距离取内存与持久化的较大值（持久化有 15s 节流，内存为最新）
    const distanceM = Math.max(state.distanceM || 0, this._distanceM);
    await this.fm.deleteFile(TIMER_PATH).catch(() => {});
    return {
      name: state.name,
      icon: state.icon,
      typeKey: state.typeKey,
      presetId: state.presetId,
      durationMin: Math.max(1, Math.round(elapsedMs / 60000)),
      durationMs: elapsedMs,
      distanceKm: distanceM >= MIN_REPORT_METERS ? Math.round(distanceM / 100) / 10 : null,
      gpsWasActive: state.gpsEnabled,
      fixes: Math.max(state.fixes || 0, this._fixes)
    };
  }

  // 取消计时（不产生记录）
  async cancel() {
    await this._stopGps();
    await this.fm.deleteFile(TIMER_PATH).catch(() => {});
  }

  // 当前活动计时（无活动返回 null；elapsedMs 每次实时计算）
  async getRunning() {
    const state = await this._loadState();
    if (!state || !state.active) return null;
    return { ...state, elapsedMs: Date.now() - state.startTs };
  }

  // 内存中的实时累计距离（米）— 持久化有 15s 节流，实时显示用内存值兜新
  getLiveDistanceM() {
    return Math.round(this._distanceM);
  }

  // ===== GPS（增量累计，原生插件与浏览器双轨）=====

  // 探测可用的定位提供方：APK → Capacitor 插件；浏览器 → navigator.geolocation；都无 → null
  _getGeoProvider() {
    const cap = typeof window !== 'undefined' ? window.Capacitor : undefined;
    if (cap?.isNativePlatform?.() && cap.Plugins?.Geolocation) {
      return { kind: 'native', api: cap.Plugins.Geolocation };
    }
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return { kind: 'web', api: navigator.geolocation };
    }
    return null;
  }

  async _startGps(typeKey) {
    const provider = this._getGeoProvider();
    if (!provider) return { active: false, reason: 'no_provider' };
    try {
      // APK：显式请求定位权限（触发系统授权框）；浏览器授权框由 watchPosition 自带
      if (provider.kind === 'native' && provider.api.requestPermissions) {
        await provider.api.requestPermissions({ permissions: ['location', 'coarseLocation'] });
      }
    } catch (e) {
      return { active: false, reason: 'permission_denied' };
    }
    const maxKmh = (this._maxKmhByType(typeKey));
    this._onFix = (fix) => this._ingestFix(fix, maxKmh);
    try {
      if (provider.kind === 'native') {
        this._watchId = await provider.api.watchPosition(
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 },
          (position, err) => {
            if (err || !position?.coords) return;
            this._onFix({ lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy ?? 999, ts: position.timestamp || Date.now() });
          }
        );
      } else {
        this._watchId = provider.api.watchPosition(
          (pos) => this._onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 999, ts: pos.timestamp || Date.now() }),
          () => { /* 定位失败静默：单次丢点不影响后续 */ },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 }
        );
      }
      return { active: true };
    } catch (e) {
      this._watchId = null;
      return { active: false, reason: 'watch_failed' };
    }
  }

  _maxKmhByType(typeKey) {
    // 超速过滤阈值随运动类型：骑行允许到 60，其他按 30 兜底
    return typeKey === 'cycle' ? 60 : 30;
  }

  // 单点增量判定（与 accumulatePath 同一套 acceptSegment 规则）
  _ingestFix(fix, maxKmh) {
    if (fix.accuracy > 30) return;
    if (this._anchor === null) {
      this._anchor = fix;
      this._fixes = 1;
      return;
    }
    const meters = ExerciseTracker.acceptSegment(this._anchor, fix, { maxKmh });
    this._anchor = fix; // 拒收段也更新锚点，与批量口径一致
    if (meters === null) return;
    this._distanceM += meters;
    this._fixes++;
    if (this.onTick) {
      try {
        this.onTick({ distanceM: Math.round(this._distanceM), fixes: this._fixes, elapsedMs: this._runningElapsedMs() });
      } catch (_) { /* 回调异常不影响测距 */ }
    }
    this._persistThrottled();
  }

  _runningElapsedMs() {
    // getRunning 为异步读文件，这里仅回调展示用；无 state 时返回 0（不影响距离）
    return this._lastKnownStartTs ? Math.max(0, Date.now() - this._lastKnownStartTs) : 0;
  }

  async _persistThrottled() {
    const now = Date.now();
    if (now - this._lastPersistTs < 15000) return;
    this._lastPersistTs = now;
    const state = await this._loadState();
    if (!state || !state.active) return;
    state.distanceM = Math.round(this._distanceM);
    state.fixes = this._fixes;
    state.updatedAt = new Date().toISOString();
    await this._saveState(state);
  }

  async _stopGps() {
    if (this._watchId !== null && this._watchId !== undefined) {
      try {
        const provider = this._getGeoProvider();
        if (provider?.kind === 'native' && provider.api.clearWatch) {
          await provider.api.clearWatch({ id: this._watchId });
        } else if (provider?.kind === 'web') {
          provider.api.clearWatch(this._watchId);
        }
      } catch (_) { /* 清理失败忽略 */ }
    }
    this._watchId = null;
    this._anchor = null;
    this.onTick = null;
  }

  // ===== 状态持久化 =====

  async _loadState() {
    const raw = await this.fm.readFile(TIMER_PATH);
    if (!raw) return null;
    try {
      const state = JSON.parse(raw);
      if (!state || typeof state.startTs !== 'number') return null;
      this._lastKnownStartTs = state.startTs;
      return state;
    } catch {
      return null;
    }
  }

  async _saveState(state) {
    this._lastKnownStartTs = state.startTs;
    await this.fm.writeFile(TIMER_PATH, JSON.stringify(state));
  }
}
