// on-demand-loader.js — 长期记忆按需索引加载器
// 职责：读 INDEX.md → routeQuery 路由 → 按清单 readFile → token 预算截断 → 结构化日志
// 依赖：IndexManager（路由）、FileManager（读取）
// 不负责：INDEX.md 重建、文件内容生成、LLM 调用

// Strategy 枚举：exact_date / this_week / last_month / insights / recent_n_days / no_match / no_index / summary_recent_n / fallback_full
// TaskType 枚举：habit_refresh / weekly_report / monthly_report / integrity_check / new_day_welcome

const FILE_PREFIX_WHITELIST = ['diet/', 'chat/', 'insights/', 'archive/'];

export class OnDemandLoader {
  constructor(indexManager, fileManager) {
    this.indexManager = indexManager;
    this.fm = fileManager;
    this._indexCache = null;
    this._indexCacheValid = false;
    this._stats = [];
    this._budgetTokens = window.QINGBAN_SETTINGS?.onDemandTokenBudget ?? 2000;
  }

  // ===== 索引缓存 =====

  async _readIndex() {
    if (this._indexCacheValid && this._indexCache !== null) {
      return this._indexCache;
    }
    try {
      this._indexCache = await this.fm.readFile('INDEX.md');
      this._indexCacheValid = true;
      return this._indexCache;
    } catch (e) {
      console.warn('[OnDemand] 读取 INDEX.md 失败:', e.message);
      return null;
    }
  }

  invalidateIndexCache() {
    this._indexCache = null;
    this._indexCacheValid = false;
  }

  // ===== 索引摘要提取 =====

  async extractIndexSummary(category) {
    const indexContent = await this._readIndex();
    if (!indexContent) return [];

    const prefixMap = { diet: 'diet/', chat: 'chat/', insights: 'insights/' };
    const prefix = prefixMap[category];
    if (!prefix) return [];

    const summaries = [];
    const regex = new RegExp(`- (${prefix}[^\\s]+\\.md) — (.+)`);
    for (const line of indexContent.split('\n')) {
      const match = line.match(regex);
      if (match) {
        summaries.push({
          path: match[1],
          summary: match[2].substring(0, 80)
        });
      }
    }
    return summaries;
  }

  // ===== token 估算与预算截断 =====

  _estimateTokens(content) {
    return Math.ceil(content.length * 1.5);
  }

  applyTokenBudget(files, budgetTokens) {
    const kept = [];
    const omitted = [];
    let actualTokens = 0;

    for (const file of files) {
      const fileTokens = this._estimateTokens(file.content);
      if (actualTokens + fileTokens <= budgetTokens) {
        kept.push(file);
        actualTokens += fileTokens;
      } else {
        omitted.push({ path: file.path, date: file.date });
      }
    }

    if (omitted.length > 0) {
      kept.push({
        path: '_omitted_notice',
        date: null,
        content: `已省略 ${omitted.length} 条历史记录，可使用 read_file 工具按需获取`
      });
    }

    return { kept, omitted, actualTokens };
  }

  // ===== 对话场景按需加载 =====

  async loadForChat(userText, currentDate) {
    const indexContent = await this._readIndex();

    // 无索引：降级为仅加载当日文件
    if (!indexContent) {
      const todayFiles = await this._readFilesWithWhitelist([
        `diet/${currentDate}.md`,
        `chat/${currentDate}.md`
      ]);
      const result = {
        files: todayFiles,
        strategy: 'no_index',
        requestedCount: 2,
        loadedCount: todayFiles.length,
        savedTokens: 0,
        indexSummaryLines: []
      };
      this._logLoad({ ...result, taskType: null, userText });
      return result;
    }

    // 路由查询
    const route = await this.indexManager.routeQuery(userText, currentDate);

    // no_match：不加载文件，只返回索引摘要行
    if (route.strategy === 'no_match') {
      const dietSummaries = await this.extractIndexSummary('diet');
      const chatSummaries = await this.extractIndexSummary('chat');
      const indexSummaryLines = [
        ...dietSummaries.map(s => `- ${s.path} — ${s.summary}`),
        ...chatSummaries.map(s => `- ${s.path} — ${s.summary}`)
      ];
      const result = {
        files: [],
        strategy: 'no_match',
        requestedCount: 0,
        loadedCount: 0,
        savedTokens: 6000 - this._estimateTokens(indexSummaryLines.join('\n')),
        indexSummaryLines
      };
      this._logLoad({ ...result, taskType: null, userText });
      return result;
    }

    // 命中意图：按清单读取
    const files = await this._readFilesWithWhitelist(route.files);
    const budgeted = this.applyTokenBudget(files, this._budgetTokens);
    const result = {
      files: budgeted.kept,
      strategy: route.strategy,
      requestedCount: route.files.length,
      loadedCount: files.length,
      savedTokens: 6000 - budgeted.actualTokens,
      indexSummaryLines: []
    };
    this._logLoad({ ...result, taskType: null, userText });
    return result;
  }

  // ===== 总结场景按需加载 =====

  async loadForSummary(params) {
    const { taskType, currentDate, targetDays, dateRange, exactDate } = params;

    // 入参校验
    this._validateSummaryParams(params);

    const indexContent = await this._readIndex();
    let paths = [];
    let strategy = '';

    if (!indexContent) {
      strategy = 'no_index';
      paths = this._fallbackPathsForSummary(params);
    } else if (taskType === 'habit_refresh') {
      const chatPaths = this._extractPathsFromIndex('chat/', targetDays, currentDate);
      paths = chatPaths;
      strategy = 'summary_recent_n';
    } else if (taskType === 'weekly_report' || taskType === 'monthly_report') {
      const dietPaths = this._extractPathsByDateRange('diet/', dateRange);
      const chatPaths = this._extractPathsByDateRange('chat/', dateRange);
      paths = [...dietPaths, ...chatPaths];
      strategy = taskType === 'weekly_report' ? 'this_week' : 'last_month';
    } else if (taskType === 'integrity_check' || taskType === 'new_day_welcome') {
      paths = [`chat/${exactDate}.md`, `diet/${exactDate}.md`];
      strategy = 'exact_date';
    }

    const files = await this._readFilesWithWhitelist(paths);
    const result = {
      files,
      strategy,
      requestedCount: paths.length,
      loadedCount: files.length,
      savedTokens: 0
    };
    this._logLoad({ ...result, taskType, userText: null });
    return result;
  }

  _validateSummaryParams(params) {
    const { taskType, targetDays, dateRange, exactDate } = params;
    if (taskType === 'habit_refresh' && !targetDays) {
      throw new TypeError('habit_refresh 需要 targetDays 参数');
    }
    if ((taskType === 'weekly_report' || taskType === 'monthly_report') && !dateRange) {
      throw new TypeError(`${taskType} 需要 dateRange 参数`);
    }
    if ((taskType === 'integrity_check' || taskType === 'new_day_welcome') && !exactDate) {
      throw new TypeError(`${taskType} 需要 exactDate 参数`);
    }
  }

  _fallbackPathsForSummary(params) {
    const { taskType, currentDate, targetDays, exactDate } = params;
    if (taskType === 'habit_refresh') {
      const paths = [];
      const base = new Date(currentDate);
      for (let i = 0; i < targetDays; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        paths.push(`chat/${d.toISOString().substring(0, 10)}.md`);
      }
      return paths;
    }
    if (taskType === 'integrity_check' || taskType === 'new_day_welcome') {
      return [`chat/${exactDate}.md`, `diet/${exactDate}.md`];
    }
    return [];
  }

  _extractPathsFromIndex(prefix, days, baseDate) {
    if (!this._indexCache) return [];
    const pad = (n) => String(n).padStart(2, '0');
    const base = new Date(baseDate);
    const dateSet = new Set();
    for (let i = 0; i < days; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      dateSet.add(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    }
    const paths = [];
    const regex = new RegExp(`- (${prefix}(\\d{4}-\\d{2}-\\d{2})\\.md)`);
    for (const line of this._indexCache.split('\n')) {
      const match = line.match(regex);
      if (match && dateSet.has(match[2])) {
        paths.push(match[1]);
      }
    }
    return paths;
  }

  _extractPathsByDateRange(prefix, dateRange) {
    if (!this._indexCache || !dateRange) return [];
    const { start, end } = dateRange;
    const paths = [];
    const regex = new RegExp(`- (${prefix}(\\d{4}-\\d{2}-\\d{2})\\.md)`);
    for (const line of this._indexCache.split('\n')) {
      const match = line.match(regex);
      if (match && match[2] >= start && match[2] <= end) {
        paths.push(match[1]);
      }
    }
    return paths;
  }

  // ===== 文件读取（带白名单校验） =====

  async _readFilesWithWhitelist(paths) {
    const files = [];
    for (const path of paths) {
      if (!FILE_PREFIX_WHITELIST.some(p => path.startsWith(p))) {
        console.error(`[OnDemand] 路径不在白名单内，拒绝加载: ${path}`);
        continue;
      }
      try {
        const content = await this.fm.readFile(path);
        if (content) {
          const dateMatch = path.match(/(\d{4}-\d{2}-\d{2})/);
          files.push({
            path,
            date: dateMatch ? dateMatch[1] : null,
            content
          });
        }
      } catch (e) {
        console.warn(`[OnDemand] 读取文件失败: ${path}`, e.message);
      }
    }
    return files;
  }

  // ===== 日志与统计 =====

  _logLoad(stat) {
    try {
      const logEntry = {
        ...stat,
        timestamp: new Date().toISOString(),
        userTextPreview: stat.userText ? stat.userText.substring(0, 50) : undefined
      };
      delete logEntry.userText;
      console.log('[OnDemand]', logEntry);
      this._stats.push(logEntry);
    } catch (e) {
      // 日志写入失败静默忽略
    }
  }

  getStats(date) {
    const records = date
      ? this._stats.filter(r => r.timestamp.startsWith(date))
      : this._stats;

    const byStrategy = {};
    let totalSavedTokens = 0;
    let totalRequestedFiles = 0;
    let totalLoadedFiles = 0;

    for (const r of records) {
      byStrategy[r.strategy] = (byStrategy[r.strategy] || 0) + 1;
      totalSavedTokens += r.savedTokens || 0;
      totalRequestedFiles += r.requestedCount || 0;
      totalLoadedFiles += r.loadedCount || 0;
    }

    return {
      byStrategy,
      totalSavedTokens,
      totalRequestedFiles,
      totalLoadedFiles,
      avgLoadedFiles: records.length > 0 ? totalLoadedFiles / records.length : 0,
      count: records.length
    };
  }
}