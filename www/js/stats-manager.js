// stats-manager.js
// 数据统计层 — 把 diet/*.md 与 BODY_METRICS.md 容错解析为结构化每日数据，供趋势面板与周报使用
// v1 策略：Markdown 是数据源（AI 写入），解析结果缓存到 .meta/daily-stats.json 侧车文件，
// 源文件未变化（按 updatedAt 签名）时直接命中缓存。历史数据零迁移，装上即可出图。
// v2 增强（record_metrics 双写）：AI 写 diet/*.md 的同时调用 record_metrics 工具提交结构化
// 数据到 .meta/metrics-manual.json，读数时双写数据优先于 MD 解析（解析保留兜底历史数据）。
// 图表数据只从 IndexedDB 读取，不注入系统提示词（避免破坏 KV Cache 前缀命中）。

const STATS_CACHE_KEY = '.meta/daily-stats.json';
const MANUAL_KEY = '.meta/metrics-manual.json';
const MEAL_NAMES = ['早餐', '午餐', '晚餐', '加餐', '夜宵', '零食'];

export class StatsManager {
  constructor(fileManager) {
    this.fm = fileManager;
  }

  // ===== 解析器（纯函数，可单测）=====

  // 解析 BODY_METRICS.md 的体重趋势表 → [{ date: 'YYYY-MM-DD', weight }]
  // 表格行格式: | 07-06 | 80.5 | -1.5 |（日期为 MM-DD，年份按今天推算：未来的归上一年）
  static parseBodyMetrics(md, todayStr) {
    if (!md) return [];
    const rows = [];
    const re = /^\s*\|\s*(\d{2}-\d{2})\s*\|\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤)?\s*\|/gm;
    let m;
    while ((m = re.exec(md)) !== null) {
      rows.push({ md: m[1], weight: parseFloat(m[2]) });
    }
    const [ty, tm, td] = todayStr.split('-');
    const todayMD = `${tm}-${td}`; // MM-DD
    const year = parseInt(ty);
    const byDate = new Map();
    for (const r of rows) {
      const y = r.md > todayMD ? year - 1 : year;
      byDate.set(`${y}-${r.md}`, r.weight); // 同日多条取最后一次
    }
    return [...byDate.entries()]
      .map(([date, weight]) => ({ date, weight }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // 解析单个 diet/YYYY-MM-DD.md → { total, meals } 或 null（无热量数据时）
  // 模板: 分餐段 "## 早餐" + "- 估算热量: ~450 kcal"；"## 当日汇总" + "- 总估算热量: ~1180 kcal"
  static parseDietMd(md) {
    if (!md) return null;
    const num = (s) => {
      const m = s.match(/估算热量[::]\s*[~≈约]?\s*(\d+(?:\.\d+)?)\s*k?cal/i);
      return m ? parseFloat(m[1]) : null;
    };

    let total = null;
    const meals = [];
    const sections = md.split(/^##\s+/m);
    for (const sec of sections) {
      const title = sec.split('\n')[0].trim();
      if (title.startsWith('当日汇总')) {
        const tm = sec.match(/总估算热量[::]\s*[~≈约]?\s*(\d+(?:\.\d+)?)\s*k?cal/i);
        if (tm) total = parseFloat(tm[1]);
        continue;
      }
      if (MEAL_NAMES.some((n) => title.includes(n))) {
        const v = num(sec);
        if (v !== null && v > 0) meals.push(title);
      }
    }

    if (total === null) {
      if (meals.length === 0) return null;
      // 无汇总段 — 容错：无法从纯文本求和（各餐只有热量数字），至少报告有记录
      total = null;
    }
    return { total, meals };
  }

  // ===== 缓存与数据获取 =====

  async getDailyStats(force = false) {
    const all = await this.fm.listFiles();
    const dietFiles = all.filter((f) => /^diet\/\d{4}-\d{2}-\d{2}\.md$/.test(f.path));
    const metricsFile = all.find((f) => f.path === 'BODY_METRICS.md');
    const manualFile = all.find((f) => f.path === MANUAL_KEY);
    const signature = JSON.stringify({
      diet: dietFiles.map((f) => `${f.path}:${f.updatedAt}`).sort(),
      metrics: metricsFile ? metricsFile.updatedAt : '',
      manual: manualFile ? manualFile.updatedAt : '',
    });

    if (!force) {
      const cached = await this._readCache();
      if (cached && cached.signature === signature) return { weights: cached.weights, calories: cached.calories };
    }

    const weights = StatsManager.parseBodyMetrics(await this.fm.readFile('BODY_METRICS.md'), this._today());
    const manual = await this._loadManual();
    const calories = [];
    const dietDates = new Set();
    for (const f of dietFiles) {
      const date = (f.path.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (date) dietDates.add(date);
      const parsed = StatsManager.parseDietMd(await this.fm.readFile(f.path));
      const merged = StatsManager.mergeCaloriesDay(parsed, manual[date]);
      if (date && merged) calories.push({ date, total: merged.total, meals: merged.meals });
    }
    // 双写数据存在但 diet 文件缺失的日期（AI 漏写 MD 或写失败时仍有结构化数据）
    for (const [date, day] of Object.entries(manual)) {
      if (dietDates.has(date)) continue;
      const mealNames = (day.meals || []).map((m) => m.name);
      if (mealNames.length > 0 || typeof day.total === 'number') {
        calories.push({ date, total: typeof day.total === 'number' ? day.total : null, meals: mealNames });
      }
    }
    calories.sort((a, b) => a.date.localeCompare(b.date));

    // 双写体重：BODY_METRICS 表缺失的日期用 record_metrics 提交的体重补齐
    for (const [date, day] of Object.entries(manual)) {
      if (typeof day.weight === 'number' && !weights.some((w) => w.date === date)) {
        weights.push({ date, weight: day.weight });
      }
    }
    weights.sort((a, b) => a.date.localeCompare(b.date));

    await this.fm.writeFile(STATS_CACHE_KEY, JSON.stringify({
      signature,
      updatedAt: new Date().toISOString(),
      weights,
      calories,
    }));
    return { weights, calories };
  }

  // ===== record_metrics 结构化双写（v2）=====

  // 提交某日的结构化热量/体重数据，写入 .meta/metrics-manual.json（事实数据，不随缓存重建丢失）
  // 同日同餐同名同热量去重；total 缺省按餐次求和；weight 可单独提交
  async recordMetrics({ date, meals, total, weight }, todayStr) {
    const cleanMeals = (Array.isArray(meals) ? meals : [])
      .filter((m) => m && typeof m.name === 'string' && m.name.trim())
      .map((m) => ({ name: m.name.trim(), kcal: Number(m.kcal) }))
      .filter((m) => Number.isFinite(m.kcal) && m.kcal > 0);
    const hasWeight = typeof weight === 'number' && Number.isFinite(weight) && weight > 0;

    if (cleanMeals.length === 0 && !hasWeight) {
      return { success: false, message: '没有有效的餐次热量或体重数据，未记录' };
    }

    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : (todayStr || this._today());
    const data = await this._loadManual();
    const day = data[dateStr] || { meals: [] };

    for (const m of cleanMeals) {
      const dup = day.meals.find((x) => x.name === m.name && Math.abs(x.kcal - m.kcal) < 0.01);
      if (!dup) day.meals.push(m);
    }
    const sum = day.meals.reduce((s, m) => s + m.kcal, 0);
    day.total = (typeof total === 'number' && Number.isFinite(total) && total > 0)
      ? Math.round(total)
      : (sum > 0 ? Math.round(sum) : null);
    if (hasWeight) day.weight = weight;
    day.updatedAt = new Date().toISOString();

    data[dateStr] = day;
    await this.fm.writeFile(MANUAL_KEY, JSON.stringify(data));
    return { success: true, date: dateStr, meals: day.meals, total: day.total, weight: day.weight || null };
  }

  async _loadManual() {
    try {
      const raw = await this.fm.readFile(MANUAL_KEY);
      const d = raw ? JSON.parse(raw) : {};
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : {};
    } catch {
      return {};
    }
  }

  // 合并单日热量：双写数据优先于 MD 解析（餐次名合并去重，total 取双写值）
  // mdDay: { total, meals: [名字...] } | null；manualDay: { meals: [{name, kcal}], total } | undefined
  static mergeCaloriesDay(mdDay, manualDay) {
    if (!manualDay) return mdDay || null;
    const names = new Set(mdDay?.meals || []);
    for (const m of manualDay.meals || []) {
      if (m && m.name) names.add(m.name);
    }
    const meals = [...names];
    let total = null;
    if (typeof manualDay.total === 'number' && manualDay.total > 0) {
      total = manualDay.total;
    } else if (mdDay && typeof mdDay.total === 'number') {
      total = mdDay.total;
    }
    if (meals.length === 0 && total === null) return mdDay || null;
    return { total, meals };
  }

  _readCache() {
    // 读缓存失败/损坏时静默重建
    return this.fm.readFile(STATS_CACHE_KEY).then((raw) => {
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        return Array.isArray(data.weights) && Array.isArray(data.calories) ? data : null;
      } catch (_) {
        return null;
      }
    });
  }

  _today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // ===== 图表生成（纯函数，返回 SVG 字符串，颜色走 CSS 变量跟随主题）=====

  // 体重折线图 — 最近 days 天（有数据的点连线）
  static buildWeightSvg(weights, { days = 30, today = null } = {}) {
    const W = 340, H = 160, L = 40, R = 14, T = 16, B = 24;
    const iw = W - L - R, ih = H - T - B;
    if (!weights || weights.length === 0) {
      return '<div class="trend-empty">暂无体重记录，对话中说「体重XX公斤」即可记录</div>';
    }
    const end = today || weights[weights.length - 1].date;
    const start = this._shiftDate(end, -(days - 1));
    const pts = weights.filter((w) => w.date >= start && w.date <= end);
    if (pts.length === 0) {
      return '<div class="trend-empty">近 30 天暂无体重记录</div>';
    }
    const vals = pts.map((p) => p.weight);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 0.5) { min -= 0.5; max += 0.5; }
    else { min -= 0.2; max += 0.2; }
    const t0 = new Date(`${start}T00:00:00`).getTime();
    const t1 = new Date(`${end}T00:00:00`).getTime();
    const x = (d) => L + ((new Date(`${d}T00:00:00`).getTime() - t0) / (t1 - t0)) * iw;
    const y = (v) => T + (1 - (v - min) / (max - min)) * ih;

    const poly = pts.map((p) => `${x(p.date).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ');
    const dots = pts.map((p) =>
      `<circle cx="${x(p.date).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="2.6" fill="var(--accent3)"><title>${p.date} ${p.weight}kg</title></circle>`
    ).join('');
    const last = pts[pts.length - 1];
    const first = pts[0];
    const pad2 = (s) => s.slice(5); // MM-DD

    return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
  <line x1="${L}" y1="${y(max).toFixed(1)}" x2="${W - R}" y2="${y(max).toFixed(1)}" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <line x1="${L}" y1="${y(min).toFixed(1)}" x2="${W - R}" y2="${y(min).toFixed(1)}" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <text x="4" y="${(y(max) + 4).toFixed(1)}" class="trend-axis">${max.toFixed(1)}</text>
  <text x="4" y="${(y(min) + 4).toFixed(1)}" class="trend-axis">${min.toFixed(1)}</text>
  <polyline points="${poly}" fill="none" stroke="var(--accent3)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${dots}
  <text x="${x(last.date).toFixed(1)}" y="${(y(last.weight) - 8).toFixed(1)}" text-anchor="${pts.length > 1 ? 'end' : 'middle'}" class="trend-val">${last.weight}kg</text>
  <text x="${L}" y="${H - 6}" class="trend-axis">${pad2(first.date)}</text>
  <text x="${W - R}" y="${H - 6}" text-anchor="end" class="trend-axis">${pad2(last.date)}</text>
</svg>
<div class="trend-caption">共 ${pts.length} 次记录${first.date !== last.date ? ` · ${first.date} ~ ${last.date}` : ''}</div>`;
  }

  // 热量柱状图 — 最近 days 天（含无记录的日期占位）
  static buildCaloriesSvg(calories, { days = 7, today = null, goal = 0 } = {}) {
    const W = 340, H = 160, L = 40, R = 14, T = 16, B = 24;
    const iw = W - L - R, ih = H - T - B;
    const end = today || this._todayStatic();
    const dayList = [];
    for (let i = days - 1; i >= 0; i--) dayList.push(this._shiftDate(end, -i));
    const map = new Map((calories || []).map((c) => [c.date, c]));
    const rows = dayList.map((d) => ({ date: d, ...(map.get(d) || { total: null, meals: [] }) }));
    const hasAny = rows.some((r) => r.total !== null && r.total > 0);
    if (!hasAny) {
      return '<div class="trend-empty">近 7 天暂无饮食记录，说「午餐吃了…」即可自动记录</div>';
    }
    const maxVal = Math.max(2000, ...rows.map((r) => r.total || 0)) * 1.1;
    const slot = iw / days;
    const bw = Math.min(34, slot * 0.6);
    const bars = rows.map((r, i) => {
      const cx = L + slot * i + slot / 2;
      if (!r.total) {
        return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(T + ih - 2).toFixed(1)}" width="${bw.toFixed(1)}" height="2" fill="var(--rule)" rx="1"><title>${r.date} 无记录</title></rect>
          <text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="trend-axis">${r.date.slice(5)}</text>`;
      }
      const h = Math.max(2, ((r.total / maxVal) * ih));
      const color = goal > 0 && r.total > goal ? 'var(--accent2)' : 'var(--accent)';
      return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(T + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}"><title>${r.date} 约${r.total} kcal（${r.meals.join('、') || '未分段'}）</title></rect>
        <text x="${cx.toFixed(1)}" y="${(T + ih - h - 4).toFixed(1)}" text-anchor="middle" class="trend-val">${Math.round(r.total)}</text>
        <text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="trend-axis">${r.date.slice(5)}</text>`;
    }).join('');
    const goalLine = goal > 0
      ? `<line x1="${L}" y1="${(T + ih - (goal / maxVal) * ih).toFixed(1)}" x2="${W - R}" y2="${(T + ih - (goal / maxVal) * ih).toFixed(1)}" stroke="var(--accent2)" stroke-dasharray="4 3"/><text x="4" y="${(T + ih - (goal / maxVal) * ih + 4).toFixed(1)}" class="trend-axis">目标</text>`
      : '';
    return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">
  ${goalLine}
  ${bars}
</svg>
<div class="trend-caption">日均约 ${Math.round(rows.reduce((s, r) => s + (r.total || 0), 0) / rows.filter((r) => r.total).length)} kcal</div>`;
  }

  // 打卡热力图 — 最近 days 天（7 列 × N 行，颜色深浅 = 当日打卡条数）
  static buildHabitHeatmap(checkinsByDate, { days = 28, today = null } = {}) {
    const W = 340, H = 92, L = 6, T = 6, CELL = 11, GAP = 4;
    const end = today || this._todayStatic();
    const dayList = [];
    for (let i = days - 1; i >= 0; i--) dayList.push(this._shiftDate(end, -i));
    const countMap = new Map(Object.entries(checkinsByDate || {}));
    const rects = dayList.map((d, i) => {
      const row = Math.floor(i / 7), col = i % 7;
      const x = L + col * (CELL + GAP), y = T + row * (CELL + GAP);
      const n = countMap.get(d) || 0;
      const opacity = n === 0 ? 0 : n === 1 ? 0.35 : n === 2 ? 0.65 : 1;
      const fill = n === 0 ? 'var(--bg3)' : 'var(--accent)';
      return `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${fill}"${n ? ` fill-opacity="${opacity}"` : ''}><title>${d}：${n} 次打卡</title></rect>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="trend-svg" preserveAspectRatio="xMidYMid meet">${rects}</svg>
<div class="trend-caption">最近 ${days} 天 · 颜色越深当日打卡越多</div>`;
  }

  // 汇总某习惯列表 + 打卡记录 → 每日打卡次数 map（热力图输入）
  static aggregateCheckinCounts(checkins) {
    const map = {};
    for (const c of checkins || []) {
      if (!c.date) continue;
      map[c.date] = (map[c.date] || 0) + 1;
    }
    return map;
  }

  // 周报的数据摘要段（供提示词嵌入）
  static buildWeeklyDataSection(weights, calories, habitSummary, endDate) {
    const start = this._shiftDate(endDate, -6);
    const cal = calories.filter((c) => c.date >= start && c.date <= endDate);
    const wt = weights.filter((w) => w.date >= start && w.date <= endDate);
    const calStr = cal.map((c) => `${c.date}：约${c.total !== null ? Math.round(c.total) : '?'}kcal${c.meals.length ? `（${c.meals.join('、')}）` : ''}`).join('\n') || '（无记录）';
    const wtStr = wt.map((w) => `${w.date}：${w.weight}kg`).join('\n') || '（无记录）';
    return `## 近 7 天热量摄入
${calStr}

## 近 7 天体重记录
${wtStr}

## 近 7 天习惯打卡
${habitSummary || '（无记录）'}`;
  }

  // 日期平移（纯函数）
  static _shiftDate(dateStr, deltaDays) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + deltaDays);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  static _todayStatic() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}
