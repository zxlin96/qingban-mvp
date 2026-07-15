// index-manager.js
// INDEX.md 维护模块 — 200行上限管理、文件归档、L3索引路由
// 保持 INDEX.md 作为轻伴文件系统的"目录页"

export class IndexManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.maxLines = 200;
    this.archiveAfterDays = 30;
  }

  // 重建 INDEX.md（全量扫描所有文件，生成一行摘要）
  async rebuildIndex() {
    const files = await this.fm.listFiles();
    const categories = {
      injected: [],
      rules: [],
      diet: [],
      chat: [],
      insights: [],
      archive: [],
      other: []
    };

    for (const file of files) {
      const summary = await this._generateFileSummary(file);
      const entry = { path: file.path, summary, updatedAt: file.updatedAt };

      if (['CLAUDE.md', 'PROFILE.md', 'BODY_METRICS.md', 'INDEX.md'].includes(file.path)) {
        if (file.path !== 'INDEX.md') categories.injected.push(entry);
      } else if (file.path.startsWith('rules/')) {
        categories.rules.push(entry);
      } else if (file.path.startsWith('diet/')) {
        categories.diet.push(entry);
      } else if (file.path.startsWith('chat/')) {
        categories.chat.push(entry);
      } else if (file.path.startsWith('insights/')) {
        categories.insights.push(entry);
      } else if (file.path.startsWith('archive/')) {
        categories.archive.push(entry);
      } else {
        categories.other.push(entry);
      }
    }

    // 排序：饮食和对话按日期倒序
    categories.diet.sort((a, b) => b.path.localeCompare(a.path));
    categories.chat.sort((a, b) => b.path.localeCompare(a.path));
    categories.insights.sort((a, b) => b.path.localeCompare(a.path));

    let content = `# 轻伴文件索引

> 自动维护 — 上次更新: ${new Date().toISOString().substring(0, 19)}

## 固定注入（每次对话自动加载）
`;

    for (const e of categories.injected) {
      content += `- ${e.path} — ${e.summary}\n`;
    }

    content += `\n## 规则文件\n`;
    for (const e of categories.rules) {
      content += `- ${e.path} — ${e.summary}\n`;
    }

    content += `\n## 饮食记录（${categories.diet.length}）\n`;
    if (categories.diet.length === 0) {
      content += `（暂无）\n`;
    } else {
      for (const e of categories.diet) {
        content += `- ${e.path} — ${e.summary}\n`;
      }
    }

    content += `\n## 对话摘要（${categories.chat.length}）\n`;
    if (categories.chat.length === 0) {
      content += `（暂无）\n`;
    } else {
      for (const e of categories.chat) {
        content += `- ${e.path} — ${e.summary}\n`;
      }
    }

    content += `\n## 洞察与报告（${categories.insights.length}）\n`;
    if (categories.insights.length === 0) {
      content += `（暂无）\n`;
    } else {
      for (const e of categories.insights) {
        content += `- ${e.path} — ${e.summary}\n`;
      }
    }

    if (categories.archive.length > 0) {
      content += `\n## 归档（${categories.archive.length}）\n`;
      for (const e of categories.archive) {
        content += `- ${e.path} — ${e.summary}\n`;
      }
    }

    if (categories.other.length > 0) {
      content += `\n## 其他\n`;
      for (const e of categories.other) {
        content += `- ${e.path} — ${e.summary}\n`;
      }
    }

    // 统计
    content += `\n---\n总计: ${files.length} 个文件 | 饮食: ${categories.diet.length} | 对话: ${categories.chat.length} | 洞察: ${categories.insights.length}`;

    await this.fm.writeFile('INDEX.md', content);

    return {
      totalFiles: files.length,
      dietCount: categories.diet.length,
      chatCount: categories.chat.length,
      insightsCount: categories.insights.length,
      archiveCount: categories.archive.length,
      lineCount: content.split('\n').length
    };
  }

  // 归档旧文件（超过 archiveAfterDays 天的 diet/chat 文件）
  async archiveOldFiles(currentDate) {
    const files = await this.fm.listFiles();
    const archived = [];
    const cutoffDate = new Date(currentDate);
    cutoffDate.setDate(cutoffDate.getDate() - this.archiveAfterDays);
    const cutoffStr = cutoffDate.toISOString().substring(0, 10);

    for (const file of files) {
      if (!file.path.startsWith('diet/') && !file.path.startsWith('chat/')) continue;

      const dateStr = file.path.split('/')[1]?.replace('.md', '');
      if (!dateStr) continue;

      // 日期早于 cutoff 的归档
      if (dateStr < cutoffStr) {
        const archivePath = `archive/${file.path}`;
        const content = await this.fm.readFile(file.path);

        if (content) {
          await this.fm.writeFile(archivePath, content);
          await this.fm.deleteFile(file.path);
          archived.push({ from: file.path, to: archivePath });
        }
      }
    }

    return archived;
  }

  // 检查 INDEX.md 行数是否超限
  async checkLineLimit() {
    const content = await this.fm.readFile('INDEX.md');
    if (!content) return { exceeded: false, lineCount: 0 };

    const lineCount = content.split('\n').length;
    return {
      exceeded: lineCount > this.maxLines,
      lineCount,
      maxLines: this.maxLines
    };
  }

  // L3 索引路由 — 根据查询意图，先读 INDEX.md 再决定加载哪些文件
  async routeQuery(userText, currentDate) {
    const indexContent = await this.fm.readFile('INDEX.md');
    if (!indexContent) return { files: [], strategy: 'no_index' };

    const t = userText.toLowerCase();
    const filesToRead = [];

    // 策略1：精确日期查询
    const dateMatch = userText.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      filesToRead.push(`diet/${dateMatch[1]}.md`);
      filesToRead.push(`chat/${dateMatch[1]}.md`);
      return { files: filesToRead, strategy: 'exact_date' };
    }

    // 策略2：本周/这周
    if (/本周|这周|这星期/.test(t)) {
      const end = new Date(currentDate);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);

      const lines = indexContent.split('\n');
      for (const line of lines) {
        const match = line.match(/- (diet\/\d{4}-\d{2}-\d{2}\.md)/);
        if (match) {
          const date = match[1].replace('diet/', '').replace('.md', '');
          if (date >= start.toISOString().substring(0, 10) && date <= end.toISOString().substring(0, 10)) {
            filesToRead.push(match[1]);
          }
        }
      }
      return { files: filesToRead, strategy: 'this_week' };
    }

    // 策略3：上月/上个月
    if (/上月|上个月|前一个月/.test(t)) {
      const date = new Date(currentDate);
      date.setMonth(date.getMonth() - 1);
      const monthStr = date.toISOString().substring(0, 7);

      const lines = indexContent.split('\n');
      for (const line of lines) {
        const match = line.match(/- (diet\/(\d{4}-\d{2})-\d{2}\.md)/);
        if (match && match[2] === monthStr) {
          filesToRead.push(match[1]);
        }
      }
      return { files: filesToRead, strategy: 'last_month' };
    }

    // 策略4：周报/月报查询
    if (/周报|月报|报告|总结|洞察|insight/.test(t)) {
      const lines = indexContent.split('\n');
      for (const line of lines) {
        const match = line.match(/- (insights\/[^\s]+\.md)/);
        if (match) filesToRead.push(match[1]);
      }
      return { files: filesToRead, strategy: 'insights' };
    }

    // 策略5：最近 N 天
    const recentMatch = userText.match(/最近(\d+)/);
    if (recentMatch) {
      const days = parseInt(recentMatch[1]);
      const end = new Date(currentDate);
      const start = new Date(end);
      start.setDate(start.getDate() - days + 1);

      const lines = indexContent.split('\n');
      for (const line of lines) {
        const match = line.match(/- (diet\/\d{4}-\d{2}-\d{2}\.md)/);
        if (match) {
          const date = match[1].replace('diet/', '').replace('.md', '');
          if (date >= start.toISOString().substring(0, 10) && date <= end.toISOString().substring(0, 10)) {
            filesToRead.push(match[1]);
          }
        }
      }
      return { files: filesToRead, strategy: 'recent_n_days' };
    }

    return { files: [], strategy: 'no_match' };
  }

  // ===== 内部方法 =====

  // 为文件生成一行摘要
  async _generateFileSummary(file) {
    const content = await this.fm.readFile(file.path);
    if (!content) return '空文件';

    const path = file.path;

    if (path === 'CLAUDE.md') return 'AI 角色与行为规范';
    if (path === 'PROFILE.md') {
      const weightMatch = content.match(/初始体重:\s*(\d+)/);
      const goalMatch = content.match(/目标体重:\s*(\d+)/);
      return `用户档案 ${weightMatch ? weightMatch[1] + 'kg' : ''}→${goalMatch ? goalMatch[1] + 'kg' : ''}`;
    }
    if (path === 'BODY_METRICS.md') {
      const weightMatch = content.match(/体重:\s*([\d.]+)kg/);
      return `当前体重 ${weightMatch ? weightMatch[1] + 'kg' : '未知'}`;
    }

    if (path.startsWith('rules/')) {
      const firstLine = content.split('\n').find(l => l.startsWith('#'));
      return firstLine ? firstLine.replace('# ', '') : '规则文件';
    }

    if (path.startsWith('diet/')) {
      const dateStr = path.replace('diet/', '').replace('.md', '');
      const calMatch = content.match(/total_calories:\s*~?(\d+)/);
      const meals = content.match(/## (\S+)/g) || [];
      const mealList = meals.map(m => m.replace('## ', '')).join(', ');
      return `${dateStr} | ~${calMatch ? calMatch[1] : '?'} kcal | ${mealList}`;
    }

    if (path.startsWith('chat/')) {
      const dateStr = path.replace('chat/', '').replace('.md', '');
      const userCount = (content.match(/## 用户/g) || []).length;
      return `${dateStr} | ${userCount} 轮对话`;
    }

    if (path.startsWith('insights/')) {
      const typeMatch = content.match(/type:\s*(\w+)/);
      const titleMatch = content.match(/# (.+)/);
      const typeLabel = typeMatch ? {
        weekly_report: '周报',
        monthly_report: '月报',
        pattern_analysis: '模式分析'
      }[typeMatch[1]] || '洞察' : '洞察';
      return `${typeLabel} ${titleMatch ? titleMatch[1].replace(/[#📊🔍]/g, '').trim() : ''}`;
    }

    if (path.startsWith('archive/')) {
      return `归档: ${path.split('/').pop()}`;
    }

    return path.split('/').pop();
  }
}
