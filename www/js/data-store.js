// data-store.js
// 结构化数据存储 — JSON 为真实数据源，MD 为展示层自动生成
// LLM 调用专用工具传数据，代码负责精确计算和格式化

export class DataStore {
  constructor(fm) {
    this.fm = fm;
    this.bodyDataKey = '.meta/body-data.json';
    this.dietDataKey = '.meta/diet-data.json';
    this._migrated = false;
  }

  // 迁移旧数据 — 从 BODY_METRICS.md 提取历史记录到 JSON
  // 在 APP 启动时调用，如果 JSON 已有数据则跳过
  async migrateIfNeeded() {
    if (this._migrated) return;
    this._migrated = true;

    const data = await this._loadBodyData();

    // 读取旧的 BODY_METRICS.md
    const oldMd = await this.fm.readFile('BODY_METRICS.md');
    if (!oldMd) {
      // 没有 MD 文件，也没有 JSON → 全新用户，什么都不做
      return;
    }

    // 解析旧 Markdown 中的体重记录
    const parsedRecords = this._parseOldBodyMetricsMd(oldMd);

    // 合并模式：把旧 MD 里的记录合并到 JSON，不覆盖已有的
    let newCount = 0;
    for (const record of parsedRecords) {
      const existing = data.records.find(r => r.date === record.date);
      if (!existing) {
        // JSON 里没有这天 → 新增
        data.records.push(record);
        newCount++;
      } else {
        // JSON 里已有这天 → 补充缺失的字段
        for (const key of Object.keys(record)) {
          if (existing[key] == null && record[key] != null) {
            existing[key] = record[key];
            newCount++;
          }
        }
      }
    }

    // 从 PROFILE.md 读取初始体重（如果 JSON 里没有）
    if (!data.profile.initialWeight) {
      const profile = await this.fm.readFile('PROFILE.md');
      if (profile) {
        const m = profile.match(/初始体重[::]\s*(\d+(?:\.\d+)?)/);
        if (m) data.profile.initialWeight = parseFloat(m[1]);
      }
    }

    // 如果有新数据或没有生成过 JSON，保存并重新生成 MD
    if (newCount > 0 || data.records.length === 0) {
      await this._saveBodyData(data);
      const height = await this._getHeight();
      await this._generateBodyMetricsMd(data, height, {});
      console.log(`[迁移] 合并了 ${newCount} 条新记录到 body-data.json（总计 ${data.records.length} 条）`);
    } else {
      // JSON 已有完整数据，但旧 MD 可能格式不统一 → 重新生成一次
      const height = await this._getHeight();
      await this._generateBodyMetricsMd(data, height, {});
      console.log(`[迁移] body-data.json 已有 ${data.records.length} 条记录，已重新生成 MD`);
    }
  }

  // 解析旧 BODY_METRICS.md — 同时处理表格和散乱行
  _parseOldBodyMetricsMd(md) {
    const records = new Map(); // date → record

    // 方案1: 解析标准表格行
    // | 2026-07-05 | 82.0kg | -1.5 | 22.3% | 26.8 |
    // | 07-05 | 82.0 | - | - | - |
    const lines = md.split('\n');
    for (const line of lines) {
      const m = line.match(/^\|\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\s*\|\s*(\d+(?:\.\d+)?)\s*kg?\s*\|/);
      if (!m) continue;

      let dateStr = m[1];
      if (dateStr.length === 5) dateStr = `2026-${dateStr}`;

      const record = records.get(dateStr) || { date: dateStr };
      record.weight = parseFloat(m[2]);

      // 尝试提取体脂率（第 4 列）
      const fatMatch = line.match(/^\|[^|]+\|[^|]+\|[^|]+\|\s*(\d+(?:\.\d+)?)\s*%?\s*\|/);
      if (fatMatch && !isNaN(parseFloat(fatMatch[1]))) record.body_fat = parseFloat(fatMatch[1]);

      // 尝试提取 BMI（第 5 列）
      const bmiMatch = line.match(/^\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|\s*(\d+(?:\.\d+)?)\s*\|/);
      if (bmiMatch && !isNaN(parseFloat(bmiMatch[1]))) record.bmi = parseFloat(bmiMatch[1]);

      records.set(dateStr, record);
    }

    // 方案2: 解析散乱的非表格行
    // 例如: "- 07-10: 体重 80.0kg" 或 "2026-07-10 80.0kg" 或 "- 体重: 80.0"
    for (const line of lines) {
      if (line.startsWith('|')) continue; // 跳过表格行

      // 尝试匹配日期 + 体重
      const patterns = [
        // - 07-10: 体重 80.0kg / - 7月10日: 80.0kg
        /(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)[^\d]*体重[::]?\s*(\d+(?:\.\d+)?)\s*kg?/i,
        // - 体重: 80.0kg（无日期，用文件里的日期或跳过）
        /体重[::]?\s*(\d+(?:\.\d+)?)\s*kg?/i,
        // 80.0kg（单独一行只有体重数字+kg）
        /^[-*]?\s*(\d+(?:\.\d+)?)\s*kg\s*$/i,
      ];

      for (const pattern of patterns) {
        const m = line.match(pattern);
        if (!m) continue;

        // 尝试从同一行提取日期
        let dateStr = null;
        let weight = null;

        if (pattern === patterns[0]) {
          dateStr = m[1];
          weight = parseFloat(m[2]);
        } else if (pattern === patterns[1]) {
          weight = parseFloat(m[1]);
          // 尝试从行中找日期
          const dm = line.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)/);
          if (dm) dateStr = dm[1];
        } else if (pattern === patterns[2]) {
          weight = parseFloat(m[1]);
        }

        if (weight == null) continue;

        // 规范化日期
        if (dateStr) {
          if (dateStr.includes('月')) {
            const dm = dateStr.match(/(\d{1,2})月(\d{1,2})日/);
            if (dm) dateStr = `2026-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;
          } else if (dateStr.length === 5) {
            dateStr = `2026-${dateStr}`;
          }
        }

        if (dateStr) {
          const record = records.get(dateStr) || { date: dateStr };
          if (record.weight == null) record.weight = weight;
          records.set(dateStr, record);
        }
      }
    }

    // 按日期排序去重
    const result = Array.from(records.values());
    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  // ===== 身体数据 =====

  async _loadBodyData() {
    const raw = await this.fm.readFile(this.bodyDataKey);
    if (!raw) return { records: [], profile: { height: null, initialWeight: null } };
    try { return JSON.parse(raw); } catch (_) { return { records: [], profile: { height: null, initialWeight: null } }; }
  }

  async _saveBodyData(data) {
    await this.fm.writeFile(this.bodyDataKey, JSON.stringify(data, null, 2));
  }

  // 从 PROFILE.md 读取身高（计算 BMI 用）
  async _getHeight() {
    const profile = await this.fm.readFile('PROFILE.md');
    if (!profile) return null;
    const m = profile.match(/身高[::]\s*(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  }

  // 更新身体数据 — 核心方法
  // 接受任意字段，只更新提供的字段
  async updateBodyMetrics(params) {
    const data = await this._loadBodyData();
    const height = await this._getHeight();

    const today = this._getToday();
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 找今天是否已有记录
    let record = data.records.find(r => r.date === today);
    if (!record) {
      record = { date: today, time: timeStr };
      data.records.push(record);
    }

    // 更新提供的字段
    if (params.weight != null) record.weight = parseFloat(params.weight);
    if (params.body_fat != null) record.body_fat = parseFloat(params.body_fat);
    if (params.muscle_mass != null) record.muscle_mass = parseFloat(params.muscle_mass);
    if (params.bmi != null) record.bmi = parseFloat(params.bmi);
    if (params.bone_mass != null) record.bone_mass = parseFloat(params.bone_mass);
    if (params.water != null) record.water = parseFloat(params.water);
    if (params.visceral_fat != null) record.visceral_fat = parseFloat(params.visceral_fat);
    if (params.basal_metabolism != null) record.basal_metabolism = parseFloat(params.basal_metabolism);
    record.time = timeStr;

    // 自动计算 BMI（如果没提供但有身高和体重）
    if (record.bmi == null && height && record.weight != null) {
      record.bmi = Math.round(record.weight / Math.pow(height / 100, 2) * 10) / 10;
    }

    // 自动计算变化值
    const sortedRecords = [...data.records].sort((a, b) => a.date.localeCompare(b.date));
    const currentIdx = sortedRecords.findIndex(r => r.date === today);
    const prevRecord = currentIdx > 0 ? sortedRecords[currentIdx - 1] : null;

    const changes = {};
    if (prevRecord) {
      if (record.weight != null && prevRecord.weight != null) {
        changes.weight = Math.round((record.weight - prevRecord.weight) * 10) / 10;
      }
      if (record.body_fat != null && prevRecord.body_fat != null) {
        changes.body_fat = Math.round((record.body_fat - prevRecord.body_fat) * 10) / 10;
      }
    }

    await this._saveBodyData(data);

    // 自动生成 MD 展示文件
    await this._generateBodyMetricsMd(data, height, changes);

    return {
      success: true,
      date: today,
      record,
      changes,
      message: this._formatBodyMetricsResponse(record, changes, prevRecord)
    };
  }

  // 生成 BODY_METRICS.md
  async _generateBodyMetricsMd(data, height, latestChanges) {
    const sorted = [...data.records].sort((a, b) => b.date.localeCompare(a.date));
    const latest = sorted[0];

    let md = `---
updated: ${this._getToday()}
version: 2
---

# 身体指标追踪

## 最新数据
- 日期: ${latest?.date || '待填写'}
- 体重: ${latest?.weight ?? '待填写'}${latest?.weight ? 'kg' : ''}
- BMI: ${latest?.bmi ?? '待计算'}${latest?.bmi ? '' : ''}
- 体脂率: ${latest?.body_fat ?? '待测量'}${latest?.body_fat ? '%' : ''}
- 肌肉量: ${latest?.muscle_mass ?? '待测量'}${latest?.muscle_mass ? 'kg' : ''}
- 骨量: ${latest?.bone_mass ?? '待测量'}${latest?.bone_mass ? 'kg' : ''}
- 水分率: ${latest?.water ?? '待测量'}${latest?.water ? '%' : ''}
- 内脏脂肪: ${latest?.visceral_fat ?? '待测量'}
- 基础代谢: ${latest?.basal_metabolism ?? '待计算'}${latest?.basal_metabolism ? 'kcal' : ''}

## 体重趋势
| 日期 | 体重 | 变化 | 体脂率 | BMI |
|------|------|------|--------|-----|
`;

    for (const r of sorted) {
      const w = r.weight ?? '-';
      const prev = sorted[sorted.indexOf(r) + 1];
      let change = '-';
      if (prev && prev.weight != null && r.weight != null) {
        const diff = Math.round((r.weight - prev.weight) * 10) / 10;
        change = diff > 0 ? `+${diff}` : `${diff}`;
      }
      const bf = r.body_fat != null ? `${r.body_fat}%` : '-';
      const bmi = r.bmi ?? '-';
      md += `| ${r.date} | ${w}${r.weight ? 'kg' : ''} | ${change} | ${bf} | ${bmi} |\n`;
    }

    // 阶段判断
    if (latest?.weight && data.profile?.initialWeight) {
      const totalChange = Math.round((latest.weight - data.profile.initialWeight) * 10) / 10;
      md += `\n## 阶段判断\n- 初始体重: ${data.profile.initialWeight}kg\n- 当前体重: ${latest.weight}kg\n- 总变化: ${totalChange > 0 ? '+' : ''}${totalChange}kg\n`;
    }

    await this.fm.writeFile('BODY_METRICS.md', md);
  }

  // 格式化返回给 LLM 的确认信息
  _formatBodyMetricsResponse(record, changes, prevRecord) {
    let msg = `已更新 ${record.date} 的身体数据：\n`;
    if (record.weight != null) {
      msg += `- 体重: ${record.weight}kg`;
      if (changes.weight != null) {
        msg += `（${changes.weight > 0 ? '+' : ''}${changes.weight}kg）`;
      }
      msg += '\n';
    }
    if (record.body_fat != null) msg += `- 体脂率: ${record.body_fat}%\n`;
    if (record.muscle_mass != null) msg += `- 肌肉量: ${record.muscle_mass}kg\n`;
    if (record.bmi != null) msg += `- BMI: ${record.bmi}\n`;
    if (record.basal_metabolism != null) msg += `- 基础代谢: ${record.basal_metabolism}kcal\n`;
    if (record.visceral_fat != null) msg += `- 内脏脂肪: ${record.visceral_fat}\n`;
    return msg;
  }

  // ===== 饮食数据 =====

  async _loadDietData() {
    const raw = await this.fm.readFile(this.dietDataKey);
    if (!raw) return { days: {} }; // { days: { "2026-07-11": { meals: [] } } }
    try { return JSON.parse(raw); } catch (_) { return { days: {} }; }
  }

  async _saveDietData(data) {
    await this.fm.writeFile(this.dietDataKey, JSON.stringify(data, null, 2));
  }

  // 添加饮食记录 — 核心方法
  // LLM 只传餐次/食物列表/热量，代码负责追加和生成 MD
  async addDietRecord(params) {
    const data = await this._loadDietData();
    const today = params.date || this._getToday();
    const now = new Date();
    const timeStr = params.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // 初始化当天数据
    if (!data.days[today]) {
      data.days[today] = { meals: [] };
    }

    // 构建 meal 记录
    const meal = {
      type: params.meal || '加餐', // 早餐/午餐/晚餐/加餐/夜宵
      time: timeStr,
      items: params.items || [],
      calories: params.calories || null,
      note: params.note || null,
      created_at: now.toISOString()
    };

    // 追加到当天的 meals 数组
    data.days[today].meals.push(meal);

    await this._saveDietData(data);

    // 生成/更新 diet/日期.md
    await this._generateDietMd(data, today);

    // 计算当日汇总
    const dayData = data.days[today];
    const totalCalories = dayData.meals.reduce((sum, m) => sum + (m.calories || 0), 0);
    const mealCount = dayData.meals.length;

    return {
      success: true,
      date: today,
      meal,
      totalCalories,
      mealCount,
      message: this._formatDietResponse(meal, today, totalCalories, mealCount)
    };
  }

  // 生成 diet/YYYY-MM-DD.md
  async _generateDietMd(data, date) {
    const dayData = data.days[date];
    if (!dayData || !dayData.meals.length) return;

    // 按餐次分组
    const mealOrder = ['早餐', '午餐', '晚餐', '加餐', '夜宵'];
    const grouped = {};
    for (const meal of dayData.meals) {
      const key = meal.type || '加餐';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(meal);
    }

    // 排序
    const sortedTypes = Object.keys(grouped).sort((a, b) => {
      const ia = mealOrder.indexOf(a);
      const ib = mealOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    let md = `---
date: ${date}
---

`;

    let totalCalories = 0;
    let mealCount = 0;

    for (const type of sortedTypes) {
      const meals = grouped[type];
      md += `## ${type}\n`;
      for (const meal of meals) {
        const itemsStr = meal.items.length > 0 ? meal.items.join('、') : '未知';
        md += `- 食物: ${itemsStr}\n`;
        if (meal.portion) md += `- 分量: ${meal.portion}\n`;
        if (meal.calories != null) {
          md += `- 估算热量: ~${meal.calories} kcal\n`;
          totalCalories += meal.calories;
        }
        if (meal.time) md += `- 时间: ${meal.time}\n`;
        if (meal.note) md += `- 备注: ${meal.note}\n`;
        md += '\n';
        mealCount++;
      }
    }

    md += `## 当日汇总\n`;
    md += `- 总估算热量: ~${totalCalories} kcal\n`;
    md += `- 记录餐次: ${mealCount} 次\n`;

    await this.fm.writeFile(`diet/${date}.md`, md);
  }

  // 格式化返回给 LLM 的确认信息
  _formatDietResponse(meal, date, totalCalories, mealCount) {
    let msg = `已记录 ${date} 的${meal.type}：\n`;
    msg += `- 食物: ${meal.items.length > 0 ? meal.items.join('、') : '未知'}\n`;
    if (meal.calories != null) msg += `- 估算热量: ~${meal.calories} kcal\n`;
    msg += `\n今日累计: ${mealCount} 餐, ~${totalCalories} kcal\n`;
    return msg;
  }

  // 迁移旧饮食数据 — 从 diet/*.md 提取到 JSON（合并模式）
  async migrateDietIfNeeded() {
    const data = await this._loadDietData();

    const allFiles = await this.fm.listFiles();
    const dietFiles = allFiles.filter(f => f.path.startsWith('diet/') && f.path.endsWith('.md'));

    let newCount = 0;

    for (const file of dietFiles) {
      const content = await this.fm.readFile(file.path);
      if (!content) continue;

      const dateMatch = file.path.match(/diet\/(\d{4}-\d{2}-\d{2})\.md/);
      if (!dateMatch) continue;
      const date = dateMatch[1];

      const parsedMeals = this._parseOldDietMd(content, date);
      if (parsedMeals.length === 0) continue;

      // JSON 里已有这天 → 合并（补充缺失的 meal）
      if (data.days[date]) {
        const existingMeals = data.days[date].meals;
        for (const meal of parsedMeals) {
          // 简单去重：同餐次+同食物列表视为重复
          const isDup = existingMeals.some(em =>
            em.type === meal.type &&
            JSON.stringify(em.items) === JSON.stringify(meal.items)
          );
          if (!isDup) {
            existingMeals.push(meal);
            newCount++;
          }
        }
      } else {
        data.days[date] = { meals: parsedMeals };
        newCount += parsedMeals.length;
      }
    }

    // 不管有没有新数据，都重新生成所有 MD（确保格式统一）
    if (Object.keys(data.days).length > 0) {
      await this._saveDietData(data);
      for (const date of Object.keys(data.days)) {
        await this._generateDietMd(data, date);
      }
      console.log(`[迁移] 饮食数据合并完成，新增 ${newCount} 条记录（总计 ${Object.keys(data.days).length} 天）`);
    }
  }

  // 解析旧 diet MD 文件
  _parseOldDietMd(md, date) {
    const meals = [];
    const lines = md.split('\n');
    let currentMeal = null;
    let currentType = null;

    for (const line of lines) {
      // 匹配餐次标题: ## 早餐 / ## 午餐 / ## 晚餐 / ## 加餐 / ## 夜宵
      const mealMatch = line.match(/^##\s*(早餐|午餐|晚餐|加餐|夜宵|零食)/);
      if (mealMatch) {
        if (currentMeal) meals.push(currentMeal);
        currentType = mealMatch[1];
        currentMeal = { type: currentType, time: null, items: [], calories: null, note: null, created_at: date };
        continue;
      }

      // 匹配食物行: - 食物: XXX、XXX
      const foodMatch = line.match(/^-\s*食物[::]\s*(.+)/);
      if (foodMatch && currentMeal) {
        const items = foodMatch[1].split(/[、,，]/).map(s => s.trim()).filter(s => s);
        currentMeal.items.push(...items);
        continue;
      }

      // 匹配热量行: - 估算热量: ~650 kcal / - 热量: 650
      const calMatch = line.match(/^-\s*(?:估算)?热量[::]\s*~?(\d+(?:\.\d+)?)\s*k?cal?/i);
      if (calMatch && currentMeal) {
        currentMeal.calories = parseInt(calMatch[1]);
        continue;
      }

      // 匹配时间行: - 时间: 08:30
      const timeMatch = line.match(/^-\s*时间[::]\s*(\d{1,2}:\d{2})/);
      if (timeMatch && currentMeal) {
        currentMeal.time = timeMatch[1];
        continue;
      }

      // 匹配备注行
      const noteMatch = line.match(/^-\s*备注[::]\s*(.+)/);
      if (noteMatch && currentMeal) {
        currentMeal.note = noteMatch[1];
        continue;
      }
    }
    if (currentMeal) meals.push(currentMeal);

    return meals;
  }

  _getToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
