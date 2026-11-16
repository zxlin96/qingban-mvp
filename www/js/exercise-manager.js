// exercise-manager.js
// 运动记录管理模块 — 常用预设、运动记录、MET/配速消耗估算、按日 MD 日志
// 存储：IndexedDB（.meta/exercise-records.json + .meta/exercise-presets.json），
//       AI 可读日志 exercise/YYYY-MM-DD.md 由系统自动生成（不依赖 AI write_file）
// 消耗估算口径（Compendium of Physical Activities 常用档 MET 值）：
//   强度档：低/中/高 对应同类型三个 MET；有实测距离（≥5min）时按「速度 → SPEED_MET」查表更准
//   kcal = MET × 体重kg × 时长h；体重快照由调用方从趋势数据最新体重传入，缺失按 60kg 兜底

// 体重缺失兜底值（onboarding 会填体重，正常不触发）
const DEFAULT_WEIGHT_KG = 60;
// 距离少于此值视为 GPS 漂移噪声，不按配速估算（也不写入记录）
const MIN_DISTANCE_KM = 0.05;
// 时长少于此分钟数不启用配速估算（时间太短配速不稳定）
const MIN_SPEED_DURATION_MIN = 5;

export class ExerciseManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.recordsPath = '.meta/exercise-records.json';
    this.presetsPath = '.meta/exercise-presets.json';
    this.onChangeCallback = null; // 数据变化时通知 UI 刷新
  }

  // ===== 静态估算（纯函数，可单测）=====

  // 运动类型表：met = [低, 中, 高] 强度档；outdoor = 距离/配速有意义；maxKmh 供 GPS 段超速过滤
  static MET_TABLE = [
    { typeKey: 'walk', label: '快走', icon: '🚶', met: [2.8, 4.3, 5.0], outdoor: true, maxKmh: 20, keywords: ['快走', '散步', '走路', '步行', '遛弯', '走了走'] },
    { typeKey: 'run', label: '跑步', icon: '🏃', met: [6.0, 8.3, 11.5], outdoor: true, maxKmh: 30, keywords: ['跑步', '慢跑', '夜跑', '晨跑', '五公里', '5公里', '十公里', '10公里'] },
    { typeKey: 'cycle', label: '骑行', icon: '🚴', met: [4.0, 6.8, 10.0], outdoor: true, maxKmh: 60, keywords: ['骑行', '骑车', '单车', '山地车', '动感单车'] },
    { typeKey: 'basketball', label: '篮球', icon: '🏀', met: [4.5, 6.5, 8.0], outdoor: false, maxKmh: 30, keywords: ['篮球', '投篮', '半场', '全场', '打野球'] },
    { typeKey: 'gym', label: '健身房', icon: '🏋️', met: [3.0, 5.0, 6.0], outdoor: false, maxKmh: 30, keywords: ['健身', '健身房', '撸铁', '力量', '器械', '哑铃', '杠铃', '卧推', '深蹲', '硬拉', '练腿', '练胸', '练背', '练肩'] },
    { typeKey: 'swim', label: '游泳', icon: '🏊', met: [4.5, 6.0, 8.3], outdoor: false, maxKmh: 30, keywords: ['游泳', '蛙泳', '自由泳', '泳池'] },
    { typeKey: 'rope', label: '跳绳', icon: '🪢', met: [7.0, 11.0, 12.3], outdoor: false, maxKmh: 30, keywords: ['跳绳'] },
    { typeKey: 'yoga', label: '瑜伽拉伸', icon: '🧘', met: [2.5, 3.0, 4.0], outdoor: false, maxKmh: 30, keywords: ['瑜伽', '拉伸', '普拉提', '冥想'] },
    { typeKey: 'badminton', label: '羽毛球等球类', icon: '🏸', met: [3.5, 5.5, 7.0], outdoor: false, maxKmh: 30, keywords: ['羽毛球', '网球', '乒乓球', '排球', '足球', '高尔夫'] },
    { typeKey: 'hike', label: '爬山徒步', icon: '⛰️', met: [3.5, 5.3, 7.0], outdoor: true, maxKmh: 30, keywords: ['爬山', '徒步', '登山', '远足', '爬楼'] },
    { typeKey: 'other', label: '其他运动', icon: '💪', met: [3.0, 4.5, 6.0], outdoor: false, maxKmh: 30, keywords: [] }
  ];

  // 速度 → MET 查表（kmh 升序，命中第一个 speed < cap 的档；仅户外类型有表）
  static SPEED_MET = {
    walk: [[3.5, 2.8], [4.5, 3.5], [5.5, 4.3], [6.5, 5.0], [Infinity, 7.0]],
    run: [[7, 6.0], [9, 8.3], [11, 9.8], [13, 11.0], [Infinity, 12.8]],
    cycle: [[15, 5.8], [19, 6.8], [22.5, 8.0], [26, 10.0], [Infinity, 12.0]]
  };

  // 强度 → MET 表下标
  static intensityIndex(intensity) {
    return intensity === 'low' ? 0 : intensity === 'high' ? 2 : 1;
  }

  // 运动名称/描述 → 类型匹配（关键词包含即命中，按表序优先）
  static matchType(text) {
    if (!text) return ExerciseManager.MET_TABLE[ExerciseManager.MET_TABLE.length - 1];
    const t = String(text);
    const hit = ExerciseManager.MET_TABLE.find(e => e.keywords.some(k => t.includes(k)));
    return hit || ExerciseManager.MET_TABLE[ExerciseManager.MET_TABLE.length - 1]; // 无命中 → other
  }

  static getDef(typeKey) {
    return ExerciseManager.MET_TABLE.find(e => e.typeKey === typeKey)
      || ExerciseManager.MET_TABLE[ExerciseManager.MET_TABLE.length - 1];
  }

  // 速度 → MET（非户外类型或无表返回 null，调用方回退强度档）
  static metFromSpeed(typeKey, kmh) {
    const tiers = ExerciseManager.SPEED_MET[typeKey];
    if (!tiers || !(kmh > 0)) return null;
    for (const [cap, met] of tiers) {
      if (kmh < cap) return met;
    }
    return tiers[tiers.length - 1][1];
  }

  // 消耗估算：{ kcal, met, metSource }；metSource = 'speed'（配速，更准）| 'intensity'（强度档）
  static estimateKcal({ typeKey, durationMin, distanceKm, intensity, weightKg }) {
    const def = ExerciseManager.getDef(typeKey);
    const weight = (Number.isFinite(weightKg) && weightKg > 0) ? weightKg : DEFAULT_WEIGHT_KG;
    const minutes = Math.max(1, Number(durationMin) || 1);
    const hours = minutes / 60;

    let met = null;
    let metSource = 'intensity';
    const km = Number(distanceKm);
    if (def.outdoor && km > MIN_DISTANCE_KM && minutes >= MIN_SPEED_DURATION_MIN) {
      const speedKmh = km / hours;
      const speedMet = ExerciseManager.metFromSpeed(def.typeKey, speedKmh);
      if (speedMet !== null) {
        met = speedMet;
        metSource = 'speed';
      }
    }
    if (met === null) {
      met = def.met[ExerciseManager.intensityIndex(intensity)];
      metSource = 'intensity';
    }
    return { kcal: Math.round(met * weight * hours), met, metSource, weightKg: weight, speedKmh: (km > MIN_DISTANCE_KM ? Math.round(km / hours * 10) / 10 : null) };
  }

  // ===== 常用预设 CRUD =====

  // 预设（无文件时写入种子：对应用户真实运动习惯 — 饭后快走/篮球/健身房）
  static DEFAULT_PRESETS = [
    { name: '饭后快走', icon: '🚶', typeKey: 'walk', defaultMin: 30, quickMins: [15, 30, 45, 60] },
    { name: '篮球', icon: '🏀', typeKey: 'basketball', defaultMin: 60, quickMins: [30, 60, 90, 120] },
    { name: '健身房', icon: '🏋️', typeKey: 'gym', defaultMin: 60, quickMins: [30, 60, 90, 120] }
  ];

  // 全量读取（含软删除项）；文件不存在返回 null（未初始化）
  async _loadAllPresets() {
    const raw = await this.fm.readFile(this.presetsPath);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d) ? d : null;
    } catch {
      return null;
    }
  }

  // 读取并按需写入种子预设（getPresets/addPreset 共用，保证任何入口先有种子）
  async _ensurePresets() {
    let all = await this._loadAllPresets();
    if (all === null) {
      all = ExerciseManager.DEFAULT_PRESETS.map((p, i) => ({
        id: this._generateId('preset'),
        sort: i,
        createdAt: new Date().toISOString(),
        active: true,
        ...p
      }));
      await this.fm.writeFile(this.presetsPath, JSON.stringify(all));
    }
    return all;
  }

  async getPresets() {
    const all = await this._ensurePresets();
    return all.filter(p => p.active !== false);
  }

  async addPreset({ name, icon, typeKey, defaultMin, quickMins }) {
    const all = await this._ensurePresets();
    const preset = {
      id: this._generateId('preset'),
      name,
      icon: icon || '💪',
      typeKey: ExerciseManager.getDef(typeKey).typeKey,
      defaultMin: Number(defaultMin) > 0 ? Number(defaultMin) : 30,
      quickMins: Array.isArray(quickMins) && quickMins.length > 0 ? quickMins.map(Number).filter(n => n > 0) : [15, 30, 45, 60],
      sort: all.length,
      createdAt: new Date().toISOString(),
      active: true
    };
    all.push(preset);
    await this.fm.writeFile(this.presetsPath, JSON.stringify(all));
    this._notifyChange();
    return preset;
  }

  // 软删除预设（保留历史记录中的名称展示）
  async deletePreset(id) {
    const all = await this._loadAllPresets();
    if (!all) return false;
    const idx = all.findIndex(p => p.id === id);
    if (idx === -1) return false;
    all[idx].active = false;
    await this.fm.writeFile(this.presetsPath, JSON.stringify(all));
    this._notifyChange();
    return true;
  }

  // ===== 运动记录 =====

  // 记录一次运动（同一天可多次）。weightKg 由调用方从趋势数据解析传入（缺失走兜底）
  async addRecord({ name, icon, typeKey, durationMin, distanceKm, intensity, time, note, source, date, weightKg }) {
    const def = ExerciseManager.getDef(typeKey);
    const est = ExerciseManager.estimateKcal({
      typeKey: def.typeKey,
      durationMin,
      distanceKm,
      intensity,
      weightKg
    });
    const km = (Number.isFinite(Number(distanceKm)) && Number(distanceKm) > MIN_DISTANCE_KM)
      ? Math.round(Number(distanceKm) * 10) / 10 : null;
    const record = {
      id: this._generateId('ex'),
      name: (name || def.label).trim() || def.label,
      icon: icon || def.icon,
      typeKey: def.typeKey,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : this._getToday(),
      time: /^\d{1,2}:\d{2}$/.test(time || '') ? time : this._nowHHMM(),
      durationMin: Math.max(1, Math.round(Number(durationMin) || 1)),
      distanceKm: km,
      intensity: ['low', 'medium', 'high'].includes(intensity) ? intensity : 'medium',
      note: note || '',
      met: Math.round(est.met * 10) / 10,
      metSource: est.metSource,
      weightKg: est.weightKg,
      kcal: est.kcal,
      source: ['quick', 'panel', 'timer', 'ai'].includes(source) ? source : 'panel',
      timestamp: new Date().toISOString()
    };
    const records = await this._loadRecords();
    records.push(record);
    await this._saveRecords(records);
    await this._writeDayMd(record.date);
    this._notifyChange();
    return { record, kcal: record.kcal, met: record.met, metSource: record.metSource, weightKg: record.weightKg };
  }

  async deleteRecord(id) {
    const records = await this._loadRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return false;
    const date = records[idx].date;
    records.splice(idx, 1);
    await this._saveRecords(records);
    await this._writeDayMd(date);
    this._notifyChange();
    return true;
  }

  async getRecordsByDate(date) {
    const records = await this._loadRecords();
    return records.filter(r => r.date === date);
  }

  // 近 N 天记录（按日期倒序分组的原始数组，日期升序）
  async getRecentRecords(days = 7) {
    const records = await this._loadRecords();
    const start = this._addDays(this._getToday(), -(days - 1));
    return records.filter(r => r.date >= start && r.date <= this._getToday());
  }

  // 单日汇总
  async getDaySummary(date) {
    const records = await this.getRecordsByDate(date);
    return {
      count: records.length,
      totalMin: records.reduce((s, r) => s + r.durationMin, 0),
      totalKm: Math.round(records.reduce((s, r) => s + (r.distanceKm || 0), 0) * 10) / 10,
      totalKcal: records.reduce((s, r) => s + r.kcal, 0),
      records
    };
  }

  // 近 N 天周汇总（趋势面板与周报共用）
  async getWeekSummary(days = 7) {
    const records = await this.getRecentRecords(days);
    const today = this._getToday();
    const daysList = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = this._addDays(today, -i);
      const dayRecords = records.filter(r => r.date === date);
      daysList.push({
        date,
        count: dayRecords.length,
        min: dayRecords.reduce((s, r) => s + r.durationMin, 0),
        km: Math.round(dayRecords.reduce((s, r) => s + (r.distanceKm || 0), 0) * 10) / 10,
        kcal: dayRecords.reduce((s, r) => s + r.kcal, 0)
      });
    }
    const byType = {};
    for (const r of records) {
      const t = byType[r.typeKey] || (byType[r.typeKey] = { label: ExerciseManager.getDef(r.typeKey).label, count: 0, min: 0, kcal: 0 });
      t.count++;
      t.min += r.durationMin;
      t.kcal += r.kcal;
    }
    return {
      days: daysList,
      activeDays: daysList.filter(d => d.count > 0).length,
      totalMin: daysList.reduce((s, d) => s + d.min, 0),
      totalKm: Math.round(daysList.reduce((s, d) => s + d.km, 0) * 10) / 10,
      totalKcal: daysList.reduce((s, d) => s + d.kcal, 0),
      count: records.length,
      byType
    };
  }

  // ===== 按日 MD 日志（AI 可读，系统自动写；从记录 JSON 全量重建避免漂移）=====

  // 强度档中文标签
  static intensityLabel(intensity) {
    return { low: '低', medium: '中', high: '高' }[intensity] || '中';
  }

  // 生成单日 MD（纯函数，可单测）。records: 当日运动记录数组（时间正序）
  static buildDayMd(date, records) {
    const lines = [`---`, `date: ${date}`, `---`, ``];
    if (!records || records.length === 0) {
      lines.push(`（今日暂无运动记录）`, ``);
      return lines.join('\n');
    }
    for (const r of records) {
      lines.push(`## ${r.time ? r.time + ' ' : ''}${r.icon} ${r.name}`);
      lines.push(`- 类型: ${ExerciseManager.getDef(r.typeKey).label}`);
      lines.push(`- 时长: ${r.durationMin} 分钟`);
      if (r.distanceKm) {
        const hours = r.durationMin / 60;
        lines.push(`- 距离: ${r.distanceKm} km（配速 ${Math.round(r.distanceKm / hours * 10) / 10} km/h）`);
      }
      lines.push(`- 强度: ${ExerciseManager.intensityLabel(r.intensity)}`);
      const basis = r.metSource === 'speed' ? '按配速' : '按强度档';
      lines.push(`- 估算消耗: ~${r.kcal} kcal（MET ${r.met} · ${r.weightKg}kg · ${basis}）`);
      if (r.note) lines.push(`- 备注: ${r.note}`);
      lines.push('');
    }
    const totalMin = records.reduce((s, r) => s + r.durationMin, 0);
    const totalKm = Math.round(records.reduce((s, r) => s + (r.distanceKm || 0), 0) * 10) / 10;
    const totalKcal = records.reduce((s, r) => s + r.kcal, 0);
    lines.push(`## 当日汇总`);
    lines.push(`- 总估算消耗: ~${totalKcal} kcal`);
    lines.push(`- 总时长: ${totalMin} 分钟`);
    if (totalKm > 0) lines.push(`- 总距离: ${totalKm} km`);
    lines.push(`- 记录次数: ${records.length} 次`);
    lines.push('');
    return lines.join('\n');
  }

  // ===== 周报数据段（纯函数，供 buildWeeklyDataSection 嵌入）=====

  // 输入 getWeekSummary(days) + records 原始数组，生成近 7 天运动文本
  static buildWeeklySummaryText(week, records) {
    if (!records || records.length === 0) return '（本周无运动记录）';
    const byDate = new Map();
    for (const r of records) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date).push(r);
    }
    const dayLines = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, list]) => {
        const items = list.map(r => `${r.name} ${r.durationMin}min${r.distanceKm ? `·${r.distanceKm}km` : ''} ~${r.kcal}kcal`);
        return `- ${date.slice(5)}：${items.join('、')}`;
      });
    dayLines.push(`- 本周合计：${week.count} 次 · ${week.totalMin} 分钟${week.totalKm > 0 ? ` · ${week.totalKm} km` : ''} · ~${week.totalKcal} kcal，活跃 ${week.activeDays}/7 天`);
    return dayLines.join('\n');
  }

  // ===== 内部存储方法 =====

  async _loadRecords() {
    const raw = await this.fm.readFile(this.recordsPath);
    if (!raw) return [];
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }

  async _saveRecords(records) {
    await this.fm.writeFile(this.recordsPath, JSON.stringify(records));
  }

  // 单日 MD 重建：有记录写文件，无记录（全部撤销）删文件
  async _writeDayMd(date) {
    const path = `exercise/${date}.md`;
    const records = (await this.getRecordsByDate(date)).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (records.length === 0) {
      await this.fm.deleteFile(path).catch(() => {});
      return;
    }
    await this.fm.writeFile(path, ExerciseManager.buildDayMd(date, records));
  }

  // ===== 工具方法 =====

  _generateId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  _getToday() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  _nowHHMM() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  _addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  _notifyChange() {
    if (this.onChangeCallback) {
      try {
        this.onChangeCallback();
      } catch (e) {
        console.error('[ExerciseManager] onChange error:', e);
      }
    }
  }
}
