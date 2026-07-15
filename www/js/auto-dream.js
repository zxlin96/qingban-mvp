// auto-dream.js
// Auto Dream 模块 — 记忆压缩与洞察生成
// Claude Code 四大核心机制之一：后台自动整理记忆、生成周报/月报、识别模式

export class AutoDream {
  constructor(fileManager, mockLLM) {
    this.fm = fileManager;
    this.llm = mockLLM;
  }

  // 判断是否应该触发 Auto Dream
  async shouldTrigger() {
    const files = await this.fm.listFiles();
    const dietFiles = files.filter(f => f.path.startsWith('diet/'));
    const chatFiles = files.filter(f => f.path.startsWith('chat/'));

    // 触发条件：饮食记录 >= 7 天 或 对话摘要 >= 7 天
    const dietCount = dietFiles.length;
    const chatCount = chatFiles.length;

    // 检查是否已有本周周报
    const weekNum = this._getWeekNumber(new Date());
    const year = new Date().getFullYear();
    const weekReportPath = `insights/${year}-W${String(weekNum).padStart(2, '0')}.md`;
    const existingReport = await this.fm.readFile(weekReportPath);

    return {
      shouldRun: (dietCount >= 7 || chatCount >= 7),
      dietCount,
      chatCount,
      weekReportPath,
      hasWeekReport: existingReport !== null
    };
  }

  // 执行 Auto Dream（主入口）
  async run(currentDate) {
    const results = {
      weeklyReport: null,
      monthlyReport: null,
      patterns: null,
      indexMaintained: false,
      archived: []
    };

    // 1. 生成周报
    results.weeklyReport = await this.generateWeeklyReport(currentDate);

    // 2. 生成月报（如果本月有足够数据）
    results.monthlyReport = await this.generateMonthlyReport(currentDate);

    // 3. 分析模式
    results.patterns = await this.analyzePatterns();

    // 4. 更新 INDEX.md
    results.indexMaintained = await this.maintainInsightsIndex();

    return results;
  }

  // 生成周报
  async generateWeeklyReport(currentDate) {
    const endDate = new Date(currentDate);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);

    const startDateStr = startDate.toISOString().substring(0, 10);
    const endDateStr = endDate.toISOString().substring(0, 10);

    // 收集本周饮食记录
    const dietData = await this._collectDietData(startDateStr, endDateStr);
    // 收集本周对话摘要
    const chatData = await this._collectChatData(startDateStr, endDateStr);

    if (dietData.length === 0 && chatData.length === 0) {
      return { path: null, message: '本周无数据，跳过周报生成' };
    }

    // 分析饮食数据
    const analysis = this._analyzeDietData(dietData);

    // 计算周编号
    const weekNum = this._getWeekNumber(endDate);
    const year = endDate.getFullYear();
    const reportPath = `insights/${year}-W${String(weekNum).padStart(2, '0')}.md`;

    // 生成周报内容
    const reportContent = this._buildWeeklyReport(
      startDateStr, endDateStr, dietData, chatData, analysis
    );

    await this.fm.writeFile(reportPath, reportContent);

    return {
      path: reportPath,
      startDate: startDateStr,
      endDate: endDateStr,
      totalCalories: analysis.totalCalories,
      avgCalories: analysis.avgCalories,
      mealCount: dietData.length
    };
  }

  // 生成月报
  async generateMonthlyReport(currentDate) {
    const date = new Date(currentDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    // 收集本月数据
    const monthStart = `${monthStr}-01`;
    const monthEnd = currentDate;

    const dietData = await this._collectDietData(monthStart, monthEnd);

    if (dietData.length < 10) {
      return { path: null, message: `本月仅 ${dietData.length} 条记录，跳过月报` };
    }

    const analysis = this._analyzeDietData(dietData);
    const reportPath = `insights/${monthStr}.md`;
    const reportContent = this._buildMonthlyReport(monthStr, dietData, analysis);

    await this.fm.writeFile(reportPath, reportContent);

    return {
      path: reportPath,
      month: monthStr,
      totalCalories: analysis.totalCalories,
      avgCalories: analysis.avgCalories,
      mealCount: dietData.length
    };
  }

  // 分析长期模式
  async analyzePatterns() {
    const files = await this.fm.listFiles();
    const dietFiles = files.filter(f => f.path.startsWith('diet/'));

    if (dietFiles.length < 5) {
      return { path: null, message: '数据不足，至少需要 5 天记录才能分析模式' };
    }

    const allDietData = [];
    for (const f of dietFiles) {
      const content = await this.fm.readFile(f.path);
      if (content) {
        allDietData.push({ date: f.path.replace('diet/', '').replace('.md', ''), content });
      }
    }

    const patterns = this._detectPatterns(allDietData);
    const patternPath = 'insights/patterns.md';
    const patternContent = this._buildPatternReport(patterns, allDietData.length);

    await this.fm.writeFile(patternPath, patternContent);

    return {
      path: patternPath,
      patternsFound: patterns.length,
      patterns
    };
  }

  // 维护 insights 目录的 INDEX 条目
  async maintainInsightsIndex() {
    const files = await this.fm.listFiles();
    const insightFiles = files.filter(f => f.path.startsWith('insights/'));

    if (insightFiles.length === 0) return false;

    // 读取当前 INDEX.md
    let indexContent = await this.fm.readFile('INDEX.md');
    if (!indexContent) return false;

    // 生成洞察文件摘要
    const insightsEntries = [];
    for (const f of insightFiles) {
      const content = await this.fm.readFile(f.path);
      let summary = f.path.split('/').pop();

      if (content) {
        const typeMatch = content.match(/type:\s*(\w+)/);
        const typeLabel = typeMatch ? {
          weekly_report: '周报',
          monthly_report: '月报',
          pattern_analysis: '模式分析'
        }[typeMatch[1]] || '洞察' : '洞察';

        const dateMatch = content.match(/start_date:\s*(\d{4}-\d{2}-\d{2})/);
        const monthMatch = content.match(/month:\s*(\d{4}-\d{2})/);

        if (dateMatch) {
          summary = `${typeLabel} ${dateMatch[1]}`;
        } else if (monthMatch) {
          summary = `${typeLabel} ${monthMatch[1]}`;
        } else {
          summary = typeLabel;
        }
      }

      insightsEntries.push(`- ${f.path} — ${summary}`);
    }

    // 检查是否有 insights 段落
    if (indexContent.includes('## 洞察与报告')) {
      // 替换 insights 段落内容
      const sections = indexContent.split('## ');
      const newSections = sections.map(section => {
        if (section.startsWith('洞察与报告')) {
          let newSection = '洞察与报告\n';
          for (const entry of insightsEntries) {
            newSection += entry + '\n';
          }
          return newSection;
        }
        return section;
      });
      indexContent = newSections.join('## ');
    } else {
      // 添加 insights 段落
      indexContent += '\n## 洞察与报告\n';
      for (const entry of insightsEntries) {
        indexContent += entry + '\n';
      }
    }

    await this.fm.writeFile('INDEX.md', indexContent);
    return true;
  }

  // ===== 内部方法 =====

  // 收集日期范围内的饮食数据
  async _collectDietData(startDate, endDate) {
    const files = await this.fm.listFiles();
    const dietFiles = files.filter(f => {
      if (!f.path.startsWith('diet/')) return false;
      const date = f.path.replace('diet/', '').replace('.md', '');
      return date >= startDate && date <= endDate;
    });

    const data = [];
    for (const f of dietFiles) {
      const content = await this.fm.readFile(f.path);
      if (content) {
        data.push({
          date: f.path.replace('diet/', '').replace('.md', ''),
          content
        });
      }
    }
    return data;
  }

  // 收集日期范围内的对话数据
  async _collectChatData(startDate, endDate) {
    const files = await this.fm.listFiles();
    const chatFiles = files.filter(f => {
      if (!f.path.startsWith('chat/')) return false;
      const date = f.path.replace('chat/', '').replace('.md', '');
      return date >= startDate && date <= endDate;
    });

    const data = [];
    for (const f of chatFiles) {
      const content = await this.fm.readFile(f.path);
      if (content) {
        data.push({
          date: f.path.replace('chat/', '').replace('.md', ''),
          content
        });
      }
    }
    return data;
  }

  // 分析饮食数据
  _analyzeDietData(dietData) {
    let totalCalories = 0;
    let mealCount = 0;
    const mealsByType = {};
    const dailyCalories = {};

    for (const day of dietData) {
      const dayCalories = 0;
      const lines = day.content.split('\n');
      let currentMeal = '';

      for (const line of lines) {
        const calMatch = line.match(/热量估算:\s*~?(\d+)/);
        if (calMatch) {
          totalCalories += parseInt(calMatch[1]);
        }

        if (line.startsWith('## ') && !line.includes('饮食记录')) {
          currentMeal = line.replace('## ', '').trim().split(' ')[0];
          mealCount++;
          mealsByType[currentMeal] = (mealsByType[currentMeal] || 0) + 1;
        }
      }

      const totalMatch = day.content.match(/total_calories:\s*~?(\d+)/);
      const dayCal = totalMatch ? parseInt(totalMatch[1]) : 0;
      if (dayCal > 0) {
        dailyCalories[day.date] = dayCal;
      }
    }

    const dayCount = Object.keys(dailyCalories).length;
    const avgCalories = dayCount > 0 ? Math.round(totalCalories / dayCount) : totalCalories;

    // 找最高/最低热量日
    let maxCalDay = null, minCalDay = null;
    for (const [date, cal] of Object.entries(dailyCalories)) {
      if (!maxCalDay || cal > maxCalDay.cal) maxCalDay = { date, cal };
      if (!minCalDay || cal < minCalDay.cal) minCalDay = { date, cal };
    }

    return {
      totalCalories,
      avgCalories,
      dayCount,
      mealCount,
      mealsByType,
      dailyCalories,
      maxCalDay,
      minCalDay
    };
  }

  // 检测饮食模式
  _detectPatterns(dietData) {
    const patterns = [];

    // 1. 周末 vs 工作日热量对比
    const weekdayCals = [];
    const weekendCals = [];

    for (const day of dietData) {
      const date = new Date(day.date);
      const dayOfWeek = date.getDay();
      const totalMatch = day.content.match(/total_calories:\s*~?(\d+)/);
      const cal = totalMatch ? parseInt(totalMatch[1]) : 0;

      if (cal > 0) {
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekendCals.push(cal);
        } else {
          weekdayCals.push(cal);
        }
      }
    }

    if (weekendCals.length >= 2 && weekdayCals.length >= 2) {
      const avgWeekend = weekendCals.reduce((a, b) => a + b, 0) / weekendCals.length;
      const avgWeekday = weekdayCals.reduce((a, b) => a + b, 0) / weekdayCals.length;
      const diff = Math.round((avgWeekend - avgWeekday) / avgWeekday * 100);

      if (Math.abs(diff) > 5) {
        patterns.push({
          type: 'weekend_vs_weekday',
          title: diff > 0 ? '周末热量偏高' : '工作日热量偏高',
          detail: `周末平均 ${Math.round(avgWeekend)} kcal vs 工作日 ${Math.round(avgWeekday)} kcal（${diff > 0 ? '+' : ''}${diff}%）`,
          suggestion: diff > 0 ? '周末饮食热量偏高，建议周末也保持工作日的饮食节奏。' : '工作日饮食热量偏高，可能外卖过多，建议自带午餐。'
        });
      }
    }

    // 2. 餐次频率分析
    const mealTypes = {};
    for (const day of dietData) {
      const lines = day.content.split('\n');
      for (const line of lines) {
        if (line.startsWith('## ') && !line.includes('饮食记录')) {
          const meal = line.replace('## ', '').trim().split(' ')[0];
          mealTypes[meal] = (mealTypes[meal] || 0) + 1;
        }
      }
    }

    if (mealTypes['加餐'] && mealTypes['加餐'] > mealTypes['早餐']) {
      patterns.push({
        type: 'snack_heavy',
        title: '加餐频率较高',
        detail: `记录了 ${mealTypes['加餐']} 次加餐，而早餐仅 ${mealTypes['早餐'] || 0} 次`,
        suggestion: '加餐频率高于正餐，可能是饮食不规律导致。建议定时定量吃三餐，减少加餐。'
      });
    }

    // 3. 连续记录天数
    const sortedDates = dietData.map(d => d.date).sort();
    let maxStreak = 1, currentStreak = 1;
    for (let i = 1; i < sortedDates.length; i++) {
      const prev = new Date(sortedDates[i - 1]);
      const curr = new Date(sortedDates[i]);
      const diff = (curr - prev) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }

    if (maxStreak >= 3) {
      patterns.push({
        type: 'streak',
        title: `连续记录 ${maxStreak} 天`,
        detail: `最长连续记录 ${maxStreak} 天，共记录 ${dietData.length} 天`,
        suggestion: '保持记录习惯很重要！坚持记录有助于追踪饮食、发现问题。'
      });
    }

    // 4. 热量趋势
    if (dietData.length >= 4) {
      const firstHalf = dietData.slice(0, Math.floor(dietData.length / 2));
      const secondHalf = dietData.slice(Math.floor(dietData.length / 2));

      const avgFirst = this._avgCalories(firstHalf);
      const avgSecond = this._avgCalories(secondHalf);

      if (avgFirst > 0 && avgSecond > 0) {
        const trend = Math.round((avgSecond - avgFirst) / avgFirst * 100);
        if (Math.abs(trend) > 8) {
          patterns.push({
            type: 'trend',
            title: trend < 0 ? '热量摄入呈下降趋势' : '热量摄入呈上升趋势',
            detail: `前半段平均 ${avgFirst} kcal，后半段 ${avgSecond} kcal（${trend > 0 ? '+' : ''}${trend}%）`,
            suggestion: trend < 0
              ? '热量控制有进步！但要确保不低于基础代谢（~1720 kcal），避免代谢降低。'
              : '热量摄入在上升，注意控制。回顾一下是不是最近加餐变多了？'
          });
        }
      }
    }

    return patterns;
  }

  _avgCalories(dietData) {
    let total = 0, count = 0;
    for (const day of dietData) {
      const match = day.content.match(/total_calories:\s*~?(\d+)/);
      if (match) {
        total += parseInt(match[1]);
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  }

  // 构建周报
  _buildWeeklyReport(startDate, endDate, dietData, chatData, analysis) {
    const days = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;

    let report = `---
type: weekly_report
start_date: ${startDate}
end_date: ${endDate}
generated: ${new Date().toISOString()}
---

# 周报 ${startDate} ~ ${endDate}

## 概览
- 记录天数: ${analysis.dayCount} / ${days}
- 餐次总数: ${analysis.mealCount}
- 总热量: ~${analysis.totalCalories} kcal
- 日均热量: ~${analysis.avgCalories} kcal

## 饮食分析

### 每日热量
`;

    for (const [date, cal] of Object.entries(analysis.dailyCalories).sort()) {
      const bar = this._calBar(cal);
      report += `- ${date}: ~${cal} kcal ${bar}\n`;
    }

    report += `\n### 餐次分布\n`;
    for (const [meal, count] of Object.entries(analysis.mealsByType).sort((a, b) => b[1] - a[1])) {
      report += `- ${meal}: ${count} 次\n`;
    }

    if (analysis.maxCalDay) {
      report += `\n### 热量极值\n`;
      report += `- 最高: ${analysis.maxCalDay.date} (~${analysis.maxCalDay.cal} kcal)\n`;
      report += `- 最低: ${analysis.minCalDay.date} (~${analysis.minCalDay.cal} kcal)\n`;
    }

    // 对话摘要
    if (chatData.length > 0) {
      report += `\n## 对话摘要\n`;
      for (const chat of chatData) {
        const lines = chat.content.split('\n');
        const userLines = lines.filter(l => l.includes('## 用户')).map(l => l.replace('## 用户', '').trim());
        report += `- ${chat.date}: ${userLines.slice(0, 2).join('；') || '简短对话'}\n`;
      }
    }

    report += `\n## AI 建议\n`;
    const targetCal = 1800;
    if (analysis.avgCalories > targetCal * 1.1) {
      report += `- ⚠️ 日均热量 ${analysis.avgCalories} kcal 超出目标 ${targetCal} kcal，建议减少高油食物\n`;
    } else if (analysis.avgCalories < targetCal * 0.7 && analysis.avgCalories > 0) {
      report += `- ⚠️ 日均热量 ${analysis.avgCalories} kcal 低于目标 ${targetCal} kcal，注意保证基础代谢\n`;
    } else {
      report += `- ✅ 热量控制良好，接近目标 ${targetCal} kcal\n`;
    }

    if (analysis.mealsByType['加餐'] > analysis.mealsByType['早餐']) {
      report += `- 📌 加餐次数较多，建议规律三餐\n`;
    }

    report += `\n## 下周建议\n- 继续保持记录习惯\n- 关注蛋白质摄入\n- 保持每周 3 次跑步\n- 注意左膝热身`;

    return report;
  }

  // 构建月报
  _buildMonthlyReport(monthStr, dietData, analysis) {
    let report = `---
type: monthly_report
month: ${monthStr}
generated: ${new Date().toISOString()}
---

# 月报 ${monthStr}

## 概览
- 记录天数: ${analysis.dayCount}
- 餐次总数: ${analysis.mealCount}
- 总热量: ~${analysis.totalCalories} kcal
- 日均热量: ~${analysis.avgCalories} kcal

## 饮食趋势

### 每周对比
`;

    // 按周分组
    const weeklyData = {};
    for (const day of dietData) {
      const weekNum = this._getWeekNumber(new Date(day.date));
      if (!weeklyData[weekNum]) weeklyData[weekNum] = [];
      weeklyData[weekNum].push(day);
    }

    for (const [week, days] of Object.entries(weeklyData).sort()) {
      const weekTotal = days.reduce((sum, d) => {
        const m = d.content.match(/total_calories:\s*~?(\d+)/);
        return sum + (m ? parseInt(m[1]) : 0);
      }, 0);
      const weekAvg = days.length > 0 ? Math.round(weekTotal / days.length) : 0;
      report += `- 第${week}周: ${days.length}天, 日均 ~${weekAvg} kcal\n`;
    }

    report += `\n## 月度总结\n`;
    report += `本月共记录 ${analysis.dayCount} 天饮食，日均 ${analysis.avgCalories} kcal。\n`;

    if (analysis.avgCalories > 0) {
      const target = 1800;
      const ratio = (analysis.avgCalories / target * 100).toFixed(0);
      report += `热量控制达到目标的 ${ratio}%。`;
      if (ratio > 110) {
        report += `略高于目标，下月注意减少外卖和油炸食物。\n`;
      } else if (ratio < 70) {
        report += `低于目标较多，注意保证营养均衡，不要节食过度。\n`;
      } else {
        report += `控制良好，继续保持！\n`;
      }
    }

    report += `\n## 下月建议\n- 保持记录频率\n- 尝试增加蛋白质种类\n- 考虑每周安排一次"放纵餐"平衡心理需求`;

    return report;
  }

  // 构建模式报告
  _buildPatternReport(patterns, totalDays) {
    let report = `---
type: pattern_analysis
analyzed_days: ${totalDays}
generated: ${new Date().toISOString()}
---

# 饮食模式识别

基于 ${totalDays} 天的饮食记录，分析了以下模式：

`;

    if (patterns.length === 0) {
      report += `暂未发现明显模式，继续记录以获得更多洞察。\n`;
    } else {
      for (const p of patterns) {
        report += `## ${p.title}\n`;
        report += `**发现**: ${p.detail}\n\n`;
        report += `**建议**: ${p.suggestion}\n\n`;
      }
    }

    report += `\n---\n*此报告由 Auto Dream 自动生成，会随数据积累持续更新*`;

    return report;
  }

  // 生成热量条形图
  _calBar(calories) {
    const max = 1200;
    const ratio = Math.min(calories / max, 1);
    const bars = Math.round(ratio * 10);
    return '#'.repeat(bars) + '.'.repeat(10 - bars);
  }

  // 获取周编号
  _getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
}
