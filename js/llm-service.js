// llm-service.js
// LLM 服务层 — 管理 LLM 通信、Function Calling 循环、工具执行

export class LLMService {
  constructor(fileManager, mockLLM) {
    this.fm = fileManager;
    this.llm = mockLLM;
    this.maxToolRounds = 5;
    this.toolCallLog = [];
  }

  // 读取近 N 天的日期文件（diet/ 或 chat/）
  async _readRecentFiles(prefix, days, baseDate) {
    const pad = (n) => String(n).padStart(2, '0');
    const base = baseDate ? new Date(baseDate) : new Date();
    const results = [];

    for (let i = 0; i < days; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const path = `${prefix}${dateStr}.md`;
      const content = await this.fm.readFile(path);
      if (content) {
        // 每个文件最多保留 800 字，避免 token 爆炸
        const trimmed = content.length > 800
          ? content.substring(0, 800) + '\n...(内容过长已截断)'
          : content;
        results.push({ date: dateStr, content: trimmed });
      }
    }
    return results;
  }

  // 构建系统提示词（固定注入 + 近 7 天动态注入）
  async buildSystemPrompt(context) {
    const claudeMd = await this.fm.readFile('CLAUDE.md');
    const profile = await this.fm.readFile('PROFILE.md');
    const metrics = await this.fm.readFile('BODY_METRICS.md');
    const learned = await this.fm.readFile('rules/learned-habits.md');
    const allergies = await this.fm.readFile('rules/allergies.md');
    const preferences = await this.fm.readFile('rules/preferences.md');
    const exercise = await this.fm.readFile('rules/exercise.md');

    // 构建详细时间信息
    const now = new Date();
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const timeStr = `${dateStr} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const weekDay = weekdays[now.getDay()];

    // 计算明天、昨天
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    const yesterdayStr = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    const tomorrowWeek = weekdays[tomorrow.getDay()];
    const yesterdayWeek = weekdays[yesterday.getDay()];

    // 周末判断
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    const isTomorrowWeekend = tomorrow.getDay() === 0 || tomorrow.getDay() === 6;

    // 时段判断
    const hour = now.getHours();
    let period, periodHint;
    if (hour < 6) { period = '深夜'; periodHint = '用户还没睡，提醒熬夜对代谢和食欲的影响'; }
    else if (hour < 9) { period = '早晨'; periodHint = '可以问早餐情况，提醒喝水启动代谢'; }
    else if (hour < 11) { period = '上午'; periodHint = '工作时段，可提醒适当补水'; }
    else if (hour < 13) { period = '中午'; periodHint = '午餐时间，可关注用户午餐记录'; }
    else if (hour < 14) { period = '午休'; periodHint = '建议短暂休息或散步'; }
    else if (hour < 18) { period = '下午'; periodHint = '工作时段，可提醒起身活动'; }
    else if (hour < 22) { period = '晚上'; periodHint = '晚餐时段，可关注晚餐和运动情况'; }
    else { period = '夜间'; periodHint = '提醒避免夜宵，准备休息'; }

    // 模拟日期
    const simDate = context?.currentDate || dateStr;

    // 读取近 7 天的饮食记录和对话摘要
    const recentDiet = await this._readRecentFiles('diet/', 7, simDate);
    const recentChat = await this._readRecentFiles('chat/', 7, simDate);

    // 格式化近 7 天饮食记录
    let dietSection = '';
    if (recentDiet.length > 0) {
      dietSection = recentDiet.map(d => `### ${d.date}\n${d.content}`).join('\n\n');
    } else {
      dietSection = '（近 7 天无饮食记录）';
    }

    // 格式化近 7 天对话摘要
    let chatSection = '';
    if (recentChat.length > 0) {
      chatSection = recentChat.map(d => `### ${d.date}\n${d.content}`).join('\n\n');
    } else {
      chatSection = '（近 7 天无对话摘要）';
    }

    return `${claudeMd}

---
# 当前时间（请严格以此为准，不要自行推算）
- 真实时间: ${timeStr}
- 今天: ${dateStr} 星期${weekDay} ${isWeekend ? '（周末）' : '（工作日）'}
- 昨天: ${yesterdayStr} 星期${yesterdayWeek}
- 明天: ${tomorrowStr} 星期${tomorrowWeek} ${isTomorrowWeekend ? '（周末）' : '（工作日）'}
- 当前时段: ${period} — ${periodHint}
- 模拟日期: ${simDate}（用于饮食记录、对话摘要等文件命名）

**时间判断规则**：
- 提到"今天"指 ${dateStr} 星期${weekDay}
- 提到"明天"指 ${tomorrowStr} 星期${tomorrowWeek}${isTomorrowWeekend ? '（是周末）' : '（是工作日）'}
- 提到"昨天"指 ${yesterdayStr} 星期${yesterdayWeek}
- 提到"周末"时，判断当前是否已经是周末（${isWeekend ? '今天是周末' : '今天不是周末'}）
- 不要凭印象判断工作日/周末，严格按上面的信息回答

---
# 用户档案（固定注入）
${profile}

---
# 身体指标（固定注入）
${metrics}

---
# 过敏与忌口（固定注入）
${allergies || '（暂无记录）'}

---
# 饮食偏好（固定注入）
${preferences || '（暂无记录）'}

---
# 运动情况（固定注入）
${exercise || '（暂无记录）'}

---
# AI 学习到的用户习惯（固定注入）
${learned || '（暂无学习记录）'}

---
# 近 7 天饮食记录（动态注入）
${dietSection}

---
# 近 7 天对话摘要（动态注入）
${chatSection}`;
  }

  // 定义可用工具
  getToolDefinitions() {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取本地 MD 文件内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径，如 diet/2026-07-05.md' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: '写入或更新本地 MD 文件',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_files',
          description: '按文件名模式搜索文件',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: '文件名模式，如 diet/2026-07-*' }
            },
            required: ['pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'append_file',
          description: '追加内容到文件末尾',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '要追加的内容' }
            },
            required: ['path', 'content']
          }
        }
      }
    ];
  }

  // 执行单个工具调用
  async executeTool(toolCall) {
    const name = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    let result = '';
    let displayName = name;

    try {
      switch (name) {
        case 'read_file':
          result = await this.fm.readFile(args.path);
          if (result === null) {
            result = `Error: file not found: ${args.path}`;
          }
          displayName = `read_file("${args.path}")`;
          break;

        case 'write_file':
          result = await this.fm.writeFile(args.path, args.content);
          displayName = `write_file("${args.path}", ${args.content.length} chars)`;
          break;

        case 'search_files':
          result = await this.fm.searchFiles(args.pattern);
          displayName = `search_files("${args.pattern}")`;
          break;

        case 'append_file':
          result = await this.fm.appendFile(args.path, args.content);
          displayName = `append_file("${args.path}", ${args.content.length} chars)`;
          break;

        default:
          result = `Error: unknown tool: ${name}`;
      }
    } catch (err) {
      result = `Error: ${err.message}`;
    }

    // 记录工具调用日志
    const logEntry = {
      tool: name,
      displayName,
      args,
      result: result,
      resultPreview: result.substring(0, 200),
      timestamp: new Date().toISOString()
    };
    this.toolCallLog.push(logEntry);

    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      name: name,
      content: result
    };
  }

  // 主对话方法 — 包含 Function Calling 循环
  async chat(userMessage, conversationHistory, context) {
    this.toolCallLog = [];
    this._lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this._lastModel = 'unknown';

    const systemPrompt = await this.buildSystemPrompt(context);

    let messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    const tools = this.getToolDefinitions();

    for (let round = 0; round < this.maxToolRounds; round++) {
      const response = await this.llm.chat(messages, tools, context);

      // 累加 token 用量
      if (response.usage) {
        this._lastUsage.prompt_tokens += response.usage.prompt_tokens || 0;
        this._lastUsage.completion_tokens += response.usage.completion_tokens || 0;
        this._lastUsage.total_tokens += response.usage.total_tokens || 0;
      }
      // 记录使用的模型
      if (response.model) {
        this._lastModel = response.model;
      }

      // 如果没有工具调用，返回最终回复
      if (!response.tool_calls || response.tool_calls.length === 0) {
        return {
          content: response.content,
          toolCalls: this.toolCallLog,
          model: response.model || this._lastModel || 'unknown',
          usage: this._lastUsage
        };
      }

      // 添加助手消息（包含工具调用）到消息列表
      messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls,
        _pendingAction: response._pendingAction
      });

      // 执行每个工具调用
      for (const toolCall of response.tool_calls) {
        const toolResult = await this.executeTool(toolCall);
        messages.push(toolResult);
      }
    }

    // 超过最大轮次，返回默认回复
    return {
      content: '抱歉，处理超时了，请重试。',
      toolCalls: this.toolCallLog
    };
  }

  // 获取工具调用日志
  getToolCallLog() {
    return this.toolCallLog;
  }
}
