// chat-manager.js
// 对话管理器 — 维护消息历史、上下文压缩、每日摘要

export class ChatManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.history = [];
    this.currentDate = this._getToday();
    this.sessionStart = this.currentDate;
    this.maxHistoryMessages = 12;
    this.compactThreshold = 8;
    this.keepRecentRounds = 4;
    this.compactCount = 0;
    this.historyKey = '.meta/chat-history.json';
    this.usageKey = '.meta/token-usage.json';
    this.tokenUsage = {
      today: { date: '', input: 0, output: 0, calls: 0 },
      total: { input: 0, output: 0, calls: 0, firstDate: '' }
    };
  }

  // 获取今天日期（使用本地时区，不用 UTC）
  _getToday() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 持久化当前对话历史到 IndexedDB
  async saveHistory() {
    const data = {
      date: this.currentDate,
      history: this.history
    };
    await this.fm.writeFile(this.historyKey, JSON.stringify(data));
  }

  // 从 IndexedDB 加载对话历史
  async loadHistory() {
    const raw = await this.fm.readFile(this.historyKey);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      return data;
    } catch (e) {
      return null;
    }
  }

  // 清除持久化的对话历史（跨天时用）
  async clearSavedHistory() {
    await this.fm.writeFile(this.historyKey, '');
  }

  // 加载持久化的 token 用量
  async loadTokenUsage() {
    const raw = await this.fm.readFile(this.usageKey);
    if (!raw) {
      this.tokenUsage.total.firstDate = this.currentDate;
      return;
    }
    try {
      this.tokenUsage = JSON.parse(raw);
      // 检查 today 是否还是今天，不是则重置
      if (this.tokenUsage.today.date !== this.currentDate) {
        this.tokenUsage.today = { date: this.currentDate, input: 0, output: 0, calls: 0 };
      }
    } catch (e) {
      this.tokenUsage.total.firstDate = this.currentDate;
    }
  }

  // 记录一次 API 调用的 token 用量
  async recordTokenUsage(usage) {
    if (!usage) return;
    const today = this._getToday();
    // 新的一天，重置 today
    if (this.tokenUsage.today.date !== today) {
      this.tokenUsage.today = { date: today, input: 0, output: 0, calls: 0 };
    }
    this.tokenUsage.today.input += usage.prompt_tokens || 0;
    this.tokenUsage.today.output += usage.completion_tokens || 0;
    this.tokenUsage.today.calls += 1;
    this.tokenUsage.total.input += usage.prompt_tokens || 0;
    this.tokenUsage.total.output += usage.completion_tokens || 0;
    this.tokenUsage.total.calls += 1;
    if (!this.tokenUsage.total.firstDate) {
      this.tokenUsage.total.firstDate = today;
    }
    // 持久化
    await this.fm.writeFile(this.usageKey, JSON.stringify(this.tokenUsage));
  }

  // 获取 token 用量信息（UI 显示用）
  getTokenUsageInfo() {
    const today = this.tokenUsage.today;
    const total = this.tokenUsage.total;
    const todaySum = today.input + today.output;
    const totalSum = total.input + total.output;
    // 计算使用天数
    let days = 1;
    if (total.firstDate) {
      const d1 = new Date(total.firstDate);
      const d2 = new Date(this._getToday());
      days = Math.max(1, Math.floor((d2 - d1) / 86400000) + 1);
    }
    // 估算费用（讯飞 Coding Plan: 输入 ¥0.001/1K, 输出 ¥0.003/1K）
    const cost = (total.input * 0.001 + total.output * 0.003) / 1000;
    return {
      todayInput: today.input,
      todayOutput: today.output,
      todayTotal: todaySum,
      todayCalls: today.calls,
      totalInput: total.input,
      totalOutput: total.output,
      totalTokens: totalSum,
      totalCalls: total.calls,
      days,
      cost: cost.toFixed(2)
    };
  }

  // 添加用户消息
  addUserMessage(content) {
    this.history.push({ role: 'user', content });
    this.saveHistory();
  }

  // 添加用户消息（含图片，支持单张或多张）
  // content 保持纯文本给 LLM 用，_displayPhotos 存图片给 UI 显示用
  addUserPhotoMessage(text, imageBase64) {
    const imgs = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
    this.history.push({
      role: 'user',
      content: text,
      _displayPhotos: imgs
    });
    this.saveHistory();
  }

  // 添加助手消息
  addAssistantMessage(content) {
    this.history.push({ role: 'assistant', content });
    this.saveHistory();
  }

  // 兼容旧格式：将历史中旧的 image_url 格式消息转为新格式
  // 新格式: content 为纯文本, _displayPhotos 存图片(给UI用)
  replaceLastPhotoMessage(aiResponse) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const msg = this.history[i];
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const hasImage = msg.content.some(c => c.type === 'image_url');
        if (hasImage) {
          const textPart = msg.content.find(c => c.type === 'text');
          const originalText = textPart ? textPart.text : '';
          const imgs = msg.content.filter(c => c.type === 'image_url').map(c => c.image_url.url);
          const summary = (aiResponse || '').slice(0, 300);
          // 转为新格式：纯文本 content + _displayPhotos
          this.history[i] = {
            role: 'user',
            content: `${originalText}\n[图片已识别，AI分析: ${summary}]`,
            _displayPhotos: imgs
          };
          this.saveHistory();
          console.log('[ChatManager] 旧图片消息已转换为新格式');
          return true;
        }
      }
    }
    return false;
  }

  // 获取对话历史（用于 LLM 上下文）
  // 清理掉 _displayPhotos 等下划线字段，只保留 LLM 需要的 role 和 content
  getHistory() {
    return this.history.map(msg => {
      const clean = { role: msg.role, content: msg.content };
      // 如果 content 是数组（旧格式含 image_url），原样保留
      // 如果 content 是字符串（新格式纯文本），直接返回
      return clean;
    });
  }

  // 检查是否需要压缩（自动触发用）
  needsCompact() {
    return this.history.length >= this.compactThreshold;
  }

  // 上下文压缩（/compact 机制）
  // 当历史超过阈值时，将旧消息用 LLM 压缩为摘要
  async compactHistory(llmService) {
    if (this.history.length < this.compactThreshold) {
      return { compacted: false, reason: 'below_threshold' };
    }

    const oldMessages = this.history.slice(0, -this.keepRecentRounds);
    const recentMessages = this.history.slice(-this.keepRecentRounds);

    // 使用 LLM 生成摘要
    let summaryText = '';
    try {
      if (llmService && llmService.llm && llmService.llm.generateSummary) {
        summaryText = await llmService.llm.generateSummary(oldMessages);
      } else {
        // 降级：文本拼接
        summaryText = this._fallbackSummary(oldMessages);
      }
    } catch (err) {
      summaryText = this._fallbackSummary(oldMessages);
    }

    const compactedHistory = [
      {
        role: 'system',
        content: `[之前的对话已压缩]\n${summaryText}`
      },
      ...recentMessages
    ];

    const oldTokenEst = this._estimateMessages(oldMessages);
    const newTokenEst = this._estimateMessages(compactedHistory);
    const savedTokens = oldTokenEst + this._estimateMessages(recentMessages) - newTokenEst;

    this.history = compactedHistory;
    this.compactCount++;

    return {
      compacted: true,
      oldMessageCount: oldMessages.length,
      keptMessageCount: recentMessages.length,
      summary: summaryText,
      savedTokens,
      compactCount: this.compactCount
    };
  }

  // 降级摘要方法（LLM 不可用时）
  _fallbackSummary(messages) {
    let summary = '【对话摘要（降级模式）】\n';
    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string' ? msg.content : '[图片消息]';
        summary += `用户: ${text.substring(0, 60)}\n`;
      } else if (msg.role === 'assistant' && msg.content) {
        summary += `助手: ${msg.content.substring(0, 60)}\n`;
      }
    }
    return summary;
  }

  // 估算消息列表的 token 数
  _estimateMessages(messages) {
    let chars = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.text) chars += part.text.length;
        }
      }
    }
    return Math.round(chars * 1.5);
  }

  // 模拟次日（推进虚拟日期）
  // profileLearner 可选:传入则在保存摘要后刷新习惯档案
  // llmService 可选:传入则生成真摘要，不传则降级全文拼接
  async advanceDay(profileLearner, llmService) {
    // 先保存当前日期的对话摘要
    await this.saveDailySummary(llmService);

    // 保存完摘要后，刷新习惯档案（基于近 21 天对话摘要全量分析）
    if (profileLearner) {
      try {
        const result = await profileLearner.refreshHabits(21);
        this._lastLearnResult = result;
        console.log('[advanceDay] 习惯刷新:', result.summary);
      } catch (err) {
        console.error('[ProfileLearner] 习惯刷新失败:', err.message);
        this._lastLearnResult = { learned: false, summary: '习惯刷新失败: ' + err.message };
      }
    }

    // 推进日期
    const d = new Date(this.currentDate);
    d.setDate(d.getDate() + 1);
    this.currentDate = d.toISOString().substring(0, 10);

    // 清空对话历史（新的一天，新对话）
    this.history = [];
    await this.clearSavedHistory();

    return this.currentDate;
  }

  // 摘要字数截断工具方法 — 在句子边界截断，追加省略号
  _truncateSummary(text, maxChars) {
    if (text.length <= maxChars) return text;
    const boundaryChars = '。！？\n';
    for (let i = maxChars; i > maxChars - 50 && i > 0; i--) {
      if (boundaryChars.includes(text[i])) {
        return text.substring(0, i + 1) + '…';
      }
    }
    return text.substring(0, maxChars) + '…';
  }

  // 降级全文拼接方法 — 提取现有 saveDailySummary 的全文拼接逻辑，不截断任何消息
  _buildFullTextFallback(messages, date) {
    let summary = `---\ndate: ${date}\n---\n\n# ${date} 对话摘要\n\n`;

    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string'
          ? msg.content
          : (Array.isArray(msg.content) ? msg.content.find(c => c.type === 'text')?.text || '[图片]' : '');
        summary += `## 用户\n${text}\n\n`;
      } else if (msg.role === 'assistant' && msg.content) {
        summary += `## 轻伴\n${msg.content}\n\n`;
      }
    }

    return summary;
  }

  // 真摘要生成方法 — 调用 LLM 生成 300-500 字摘要，失败返回 null（由调用方降级）
  async _generateTrueSummary(messages, date, llmService) {
    if (!llmService || !llmService.llm || !llmService.llm.generateDailySummary) {
      return null;
    }

    try {
      const summaryText = await llmService.llm.generateDailySummary(messages, date);

      // 判定有效性：空字符串、null、undefined 或占位符均视为失败
      if (!summaryText || !summaryText.trim() ||
          summaryText.includes('【摘要生成失败】') || summaryText.includes('【摘要为空】')) {
        return null;
      }

      // 字数后处理：超过 500 字截断
      let finalText = summaryText;
      if (finalText.length > 500) {
        finalText = this._truncateSummary(finalText, 500);
      }

      // 组装完整文件内容
      return `---\ndate: ${date}\n---\n\n# ${date} 对话摘要\n\n${finalText}`;
    } catch (e) {
      console.error('[ChatManager] 真摘要生成异常:', e.message);
      return null;
    }
  }

  // 保存当日对话摘要到 chat/YYYY-MM-DD.md
  // llmService 可选:传入且 LLM 成功时生成 300-500 字真摘要，否则降级全文拼接
  async saveDailySummary(llmService) {
    if (this.history.length === 0) return;

    const chatPath = `chat/${this.currentDate}.md`;
    let content;
    let mode;

    // 优先尝试真摘要
    const trueSummary = await this._generateTrueSummary(this.history, this.currentDate, llmService);

    if (trueSummary) {
      content = trueSummary;
      mode = 'true_summary';
      console.log('[ChatManager] 摘要生成:', {
        date: this.currentDate,
        mode,
        inputMessageCount: this.history.length,
        outputChars: trueSummary.length
      });
    } else {
      // 降级：全文拼接
      content = this._buildFullTextFallback(this.history, this.currentDate);
      mode = 'fallback';
      console.log('[ChatManager] 摘要生成:', {
        date: this.currentDate,
        mode,
        reason: 'llm_unavailable_or_failed',
        inputMessageCount: this.history.length,
        outputChars: content.length
      });
    }

    await this.fm.writeFile(chatPath, content);

    // 更新 INDEX.md
    await this.fm.appendFile('INDEX.md',
      `- chat/${this.currentDate}.md — ${this.history.length}条对话`
    );
  }

  // 获取上下文信息（用于 UI 显示）
  getContextInfo() {
    const userMsgCount = this.history.filter(m => m.role === 'user').length;
    const assistantMsgCount = this.history.filter(m => m.role === 'assistant').length;
    const estimatedTokens = this._estimateTokens();
    const needsCompact = this.needsCompact();

    return {
      currentDate: this.currentDate,
      sessionStart: this.sessionStart,
      messageCount: this.history.length,
      userMsgCount,
      assistantMsgCount,
      estimatedTokens,
      needsCompact,
      compactCount: this.compactCount,
      compactThreshold: this.compactThreshold
    };
  }

  // 估算 token 数（粗略：1 中文字 ≈ 1.5 tokens）
  _estimateTokens() {
    let chars = 0;
    for (const msg of this.history) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.text) chars += part.text.length;
        }
      }
    }
    return Math.round(chars * 1.5);
  }

  // 清空历史
  clearHistory() {
    this.history = [];
    this.clearSavedHistory();
  }
}
