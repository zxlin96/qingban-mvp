// habit-manager.js
// 习惯打卡管理模块 — 习惯定义、打卡记录、统计计算、AI 推荐
// 存储：IndexedDB（.meta/habits.json + .meta/habit-checkins.json）

export class HabitManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.habitsPath = '.meta/habits.json';
    this.checkinsPath = '.meta/habit-checkins.json';
    this.onChangeCallback = null; // 数据变化时通知 UI 刷新
  }

  // ===== 习惯定义 CRUD =====

  // 获取所有 active 习惯
  async getHabits() {
    const habits = await this._loadHabits();
    return habits.filter(h => h.active !== false);
  }

  // 获取单个习惯
  async getHabit(id) {
    const habits = await this._loadHabits();
    return habits.find(h => h.id === id) || null;
  }

  // 新增习惯
  async addHabit({ name, icon, unit, dailyGoal, category, schedule, source }) {
    const habits = await this._loadHabits();
    const habit = {
      id: this._generateId('habit'),
      name,
      icon: icon || '✅',
      unit: unit || '次',
      dailyGoal: dailyGoal || 1,
      category: category || 'custom',
      source: source || 'user_custom',
      schedule: schedule || [],
      createdAt: new Date().toISOString(),
      active: true,
      reminderEnabled: true
    };
    habits.push(habit);
    await this._saveHabits(habits);
    this._notifyChange();
    return habit;
  }

  // 更新习惯属性
  async updateHabit(id, updates) {
    const habits = await this._loadHabits();
    const idx = habits.findIndex(h => h.id === id);
    if (idx === -1) return null;
    habits[idx] = { ...habits[idx], ...updates };
    await this._saveHabits(habits);
    this._notifyChange();
    return habits[idx];
  }

  // 软删除习惯（active=false），保留历史打卡数据
  async deleteHabit(id) {
    const habits = await this._loadHabits();
    const idx = habits.findIndex(h => h.id === id);
    if (idx === -1) return false;
    habits[idx].active = false;
    await this._saveHabits(habits);
    this._notifyChange();
    return true;
  }

  // ===== 打卡操作 =====

  // 打卡（同一天可多次）
  async checkin(habitId, amount, note = '') {
    const checkins = await this._loadCheckins();
    const checkin = {
      id: this._generateId('checkin'),
      habitId,
      date: this._getToday(),
      amount: parseFloat(amount) || 1,
      note,
      timestamp: new Date().toISOString()
    };
    checkins.push(checkin);
    await this._saveCheckins(checkins);
    this._notifyChange();
    return checkin;
  }

  // 撤销单次打卡
  async undoCheckin(checkinId) {
    const checkins = await this._loadCheckins();
    const idx = checkins.findIndex(c => c.id === checkinId);
    if (idx === -1) return false;
    checkins.splice(idx, 1);
    await this._saveCheckins(checkins);
    this._notifyChange();
    return true;
  }

  // 获取某天所有打卡
  async getCheckinsByDate(date) {
    const checkins = await this._loadCheckins();
    return checkins.filter(c => c.date === date);
  }

  // 获取某习惯在日期范围内的打卡
  async getCheckinsByHabit(habitId, startDate, endDate) {
    const checkins = await this._loadCheckins();
    return checkins.filter(c => {
      if (c.habitId !== habitId) return false;
      if (startDate && c.date < startDate) return false;
      if (endDate && c.date > endDate) return false;
      return true;
    });
  }

  // 获取某习惯今日累计量和达标状态
  async getTodayProgress(habitId) {
    const today = this._getToday();
    const checkins = await this.getCheckinsByHabit(habitId, today, today);
    const habit = await this.getHabit(habitId);
    const goal = habit ? habit.dailyGoal : 1;
    const amount = checkins.reduce((sum, c) => sum + c.amount, 0);
    const percentage = goal > 0 ? Math.min(100, (amount / goal) * 100) : 0;
    return {
      amount,
      goal,
      unit: habit ? habit.unit : '',
      percentage: Math.round(percentage),
      isCompleted: amount >= goal,
      checkinCount: checkins.length
    };
  }

  // ===== 统计计算 =====

  // 计算连续打卡天数（允许今天未打卡不中断）
  async calculateStreak(habitId) {
    const checkins = await this._loadCheckins();
    const habitCheckins = checkins.filter(c => c.habitId === habitId);
    if (habitCheckins.length === 0) return 0;

    // 按 date 去重
    const dates = [...new Set(habitCheckins.map(c => c.date))].sort().reverse();

    const today = this._getToday();
    const yesterday = this._addDays(today, -1);

    // 确定起始检查日期
    let checkDate;
    if (dates.includes(today)) {
      checkDate = today;
    } else if (dates.includes(yesterday)) {
      // 今天没打卡但昨天打了，不中断
      checkDate = yesterday;
    } else {
      return 0;
    }

    let streak = 0;
    while (dates.includes(checkDate)) {
      streak++;
      checkDate = this._addDays(checkDate, -1);
    }
    return streak;
  }

  // 计算近 N 天完成率
  async calculateCompletionRate(habitId, days = 7) {
    const habit = await this.getHabit(habitId);
    if (!habit) return { checkedInDays: 0, goalMetDays: 0, completionRate: 0 };

    const checkins = await this._loadCheckins();
    const habitCheckins = checkins.filter(c => c.habitId === habitId);

    const today = this._getToday();
    let checkedInDays = 0;
    let goalMetDays = 0;

    for (let i = 0; i < days; i++) {
      const date = this._addDays(today, -i);
      const dayCheckins = habitCheckins.filter(c => c.date === date);
      if (dayCheckins.length > 0) {
        checkedInDays++;
        const dayAmount = dayCheckins.reduce((sum, c) => sum + c.amount, 0);
        if (dayAmount >= habit.dailyGoal) {
          goalMetDays++;
        }
      }
    }

    return {
      checkedInDays,
      goalMetDays,
      completionRate: Math.round((goalMetDays / days) * 100)
    };
  }

  // 计算最长连续天数
  async calculateMaxStreak(habitId) {
    const checkins = await this._loadCheckins();
    const habitCheckins = checkins.filter(c => c.habitId === habitId);
    if (habitCheckins.length === 0) return 0;

    const dates = [...new Set(habitCheckins.map(c => c.date))].sort();

    let maxStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const prev = this._addDays(dates[i], -1);
      if (prev === dates[i - 1]) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    return maxStreak;
  }

  // 汇总统计
  async getHabitStats(habitId) {
    const [currentStreak, maxStreak, completion, progress] = await Promise.all([
      this.calculateStreak(habitId),
      this.calculateMaxStreak(habitId),
      this.calculateCompletionRate(habitId, 7),
      this.getTodayProgress(habitId)
    ]);

    return {
      currentStreak,
      maxStreak,
      ...completion,
      todayProgress: progress
    };
  }

  // ===== AI 推荐习惯生成 =====

  async suggestHabitsFromProfile(llm) {
    if (!llm || !llm.chat) return this._fallbackSuggestions();

    const profile = await this.fm.readFile('rules/learned-habits.md');
    const existingHabits = await this.getHabits();
    const existingNames = existingHabits.map(h => h.name);

    const sysPrompt = `你是"轻伴"的习惯推荐助手。根据用户的学习习惯档案，推荐 3-5 个适合打卡的健康习惯。

规则：
1. 只推荐与减肥/健康相关的习惯（喝水、运动、饮食控制、作息等）
2. 每个习惯必须有可量化的目标和单位
3. 不要推荐用户已有的习惯
4. 习惯要基于档案中的实际信息（如档案提到用户跑步，推荐"跑步30分钟"）
5. 如果档案信息不足，推荐通用的健康习惯（喝水、步行、早睡等）

输出纯 JSON 数组格式（不要 markdown 代码块），每个元素包含：
{"name": "习惯名", "icon": "emoji", "unit": "单位", "dailyGoal": 数字, "category": "water/meal/exercise/weight/sleep/custom", "reason": "推荐理由"}`;

    const userContent = `## 用户已有习惯
${existingNames.length > 0 ? existingNames.join('、') : '（暂无）'}

## 用户习惯学习档案
${profile || '（暂无档案）'}

请推荐适合的健康打卡习惯：`;

    try {
      const resp = await llm.chat(
        [{ role: 'system', content: sysPrompt }, { role: 'user', content: userContent }],
        null,
        { task: 'habit_suggest' }
      );

      // 尝试从回复中提取 JSON 数组
      const jsonMatch = resp.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return suggestions.filter(s => !existingNames.includes(s.name));
      }
    } catch (e) {
      console.error('[HabitManager] 推荐解析失败:', e.message);
    }
    return this._fallbackSuggestions();
  }

  // 降级推荐（LLM 不可用时）
  _fallbackSuggestions() {
    return [
      { name: '喝水', icon: '💧', unit: 'L', dailyGoal: 2.0, category: 'water', reason: '充足饮水有助新陈代谢' },
      { name: '步行', icon: '🚶', unit: '步', dailyGoal: 8000, category: 'exercise', reason: '日常步行是最简单的运动' },
      { name: '早睡', icon: '😴', unit: '次', dailyGoal: 1, category: 'sleep', reason: '充足睡眠有助代谢调节' }
    ];
  }

  // 用户确认采纳 AI 推荐的习惯
  async adoptSuggestedHabit(suggestion) {
    return await this.addHabit({
      name: suggestion.name,
      icon: suggestion.icon,
      unit: suggestion.unit,
      dailyGoal: suggestion.dailyGoal,
      category: suggestion.category,
      source: 'ai_suggested',
      schedule: []
    });
  }

  // 生成昨日打卡汇总报告
  async generateDailyReport(date) {
    const habits = await this.getHabits();
    const checkins = await this.getCheckinsByDate(date);

    const lines = [`# ${date} 打卡报告\n`];

    for (const habit of habits) {
      const habitCheckins = checkins.filter(c => c.habitId === habit.id);
      const amount = habitCheckins.reduce((sum, c) => sum + c.amount, 0);
      const completed = amount >= habit.dailyGoal;
      const icon = completed ? '✅' : '⬜';

      lines.push(`## ${habit.icon} ${habit.name} ${icon}`);
      lines.push(`- 目标: ${habit.dailyGoal}${habit.unit}`);
      lines.push(`- 完成: ${amount}${habit.unit}（${Math.round(Math.min(100, amount / habit.dailyGoal * 100))}%）`);
      lines.push(`- 打卡次数: ${habitCheckins.length}`);
      if (habitCheckins.length > 0 && habitCheckins.some(c => c.note)) {
        const notes = habitCheckins.filter(c => c.note).map(c => c.note).join('；');
        lines.push(`- 备注: ${notes}`);
      }
      lines.push('');
    }

    const completedCount = habits.filter(h => {
      const hc = checkins.filter(c => c.habitId === h.id);
      const amount = hc.reduce((sum, c) => sum + c.amount, 0);
      return amount >= h.dailyGoal;
    }).length;

    lines.unshift(`# ${date} 打卡报告\n> 完成 ${completedCount}/${habits.length} 个习惯\n`);

    return lines.join('\n');
  }

  // ===== 内部存储方法 =====

  async _loadHabits() {
    const raw = await this.fm.readFile(this.habitsPath);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async _saveHabits(habits) {
    await this.fm.writeFile(this.habitsPath, JSON.stringify(habits));
  }

  async _loadCheckins() {
    const raw = await this.fm.readFile(this.checkinsPath);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async _saveCheckins(checkins) {
    await this.fm.writeFile(this.checkinsPath, JSON.stringify(checkins));
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
        console.error('[HabitManager] onChange error:', e);
      }
    }
  }
}
