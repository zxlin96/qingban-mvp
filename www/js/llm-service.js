// llm-service.js
// LLM 服务层 — 管理 LLM 通信、Function Calling 循环、工具执行

export class LLMService {
  constructor(fileManager, mockLLM, onDemandLoader) {
    this.fm = fileManager;
    this.llm = mockLLM;
    this.onDemandLoader = onDemandLoader;
    this.maxToolRounds = (window.QINGBAN_SETTINGS?.maxToolRounds) || 5;
    this.toolCallLog = [];
    // ask_user 回调 — 由 App 层注入，返回 Promise<string>
    this.onAskUser = null;

    // ===== KV Cache 优化：三层缓存 =====
    // 第一层：System Prompt 固定前缀缓存
    // 固定文件列表 — 这些文件内容不常变化，缓存后避免每次从 IndexedDB 读取
    this._fixedFiles = [
      'CLAUDE.md', 'PROFILE.md', 'BODY_METRICS.md',
      'rules/learned-habits.md', 'rules/allergies.md',
      'rules/preferences.md', 'rules/exercise.md'
    ];
    this._cachedPrefix = null;      // 缓存的固定前缀字符串
    this._prefixCacheValid = false;  // 缓存是否有效

    // 第三层：客户端响应缓存（LRU + TTL）
    this._responseCache = new Map();
    this._responseCacheMaxSize = 10;
    this._responseCacheTTL = 30000; // 30 秒
  }

  // ===== 第一层：固定前缀缓存方法 =====

  // 构建固定前缀（从 IndexedDB 读取固定文件并拼接）
  async _buildFixedPrefix() {
    const claudeMd = await this.fm.readFile('CLAUDE.md');
    const profile = await this.fm.readFile('PROFILE.md');
    const metrics = await this.fm.readFile('BODY_METRICS.md');
    const learned = await this.fm.readFile('rules/learned-habits.md');
    const allergies = await this.fm.readFile('rules/allergies.md');
    const preferences = await this.fm.readFile('rules/preferences.md');
    const exercise = await this.fm.readFile('rules/exercise.md');

    return `${claudeMd || ''}

---
# 用户档案（固定注入）
${profile || '（暂无记录）'}

---
# 身体指标（固定注入）
${metrics || '（暂无记录）'}

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
${learned || '（暂无学习记录）'}`;
  }

  // 获取固定前缀（带缓存）
  async _getFixedPrefix() {
    if (this._prefixCacheValid && this._cachedPrefix !== null) {
      console.log('[LLMService] 固定前缀缓存命中，跳过 IndexedDB 读取');
      return this._cachedPrefix;
    }
    console.log('[LLMService] 固定前缀缓存未命中，从 IndexedDB 读取');
    this._cachedPrefix = await this._buildFixedPrefix();
    this._prefixCacheValid = true;
    return this._cachedPrefix;
  }

  // 失效固定前缀缓存（当固定文件被修改时调用）
  _invalidatePrefixCache(filePath) {
    if (this._fixedFiles.includes(filePath)) {
      console.log(`[LLMService] 固定文件 ${filePath} 被修改，失效前缀缓存`);
      this._cachedPrefix = null;
      this._prefixCacheValid = false;
    }
  }

  // ===== 第三层：响应缓存方法 =====

  // 计算响应缓存 key（基于对话历史 + 用户消息）
  _computeResponseCacheKey(userMessage, conversationHistory) {
    // 只使用最近 4 轮对话 + 用户消息作为 key，避免 key 过长
    const recentHistory = conversationHistory.slice(-8);
    const historyStr = recentHistory.map(m =>
      `${m.role}:${typeof m.content === 'string' ? m.content.substring(0, 200) : ''}`
    ).join('|');
    return `${historyStr}||${typeof userMessage === 'string' ? userMessage.substring(0, 500) : ''}`;
  }

  // 查询响应缓存
  _getResponseFromCache(key) {
    const cached = this._responseCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this._responseCacheTTL) {
      this._responseCache.delete(key);
      return null;
    }
    // LRU: 移到末尾（最近使用）
    this._responseCache.delete(key);
    this._responseCache.set(key, cached);
    console.log('[LLMService] 响应缓存命中，跳过 API 调用');
    return cached.response;
  }

  // 写入响应缓存
  _setResponseCache(key, response) {
    if (this._responseCache.size >= this._responseCacheMaxSize) {
      // LRU 淘汰：删除最早的一条
      const firstKey = this._responseCache.keys().next().value;
      this._responseCache.delete(firstKey);
    }
    this._responseCache.set(key, { response, timestamp: Date.now() });
  }

  // 读取近 N 天的日期文件（diet/ 或 chat/）
  async _readRecentFiles(prefix, days, baseDate) {
    const pad = (n) => String(n).padStart(2, '0');
    const base = baseDate ? new Date(baseDate) : new Date();
    const results = [];
    const truncate = window.QINGBAN_SETTINGS?.fileTruncate || 800;

    for (let i = 0; i < days; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const path = `${prefix}${dateStr}.md`;
      const content = await this.fm.readFile(path);
      if (content) {
        // 每个文件最多保留 truncate 字，避免 token 爆炸
        const trimmed = content.length > truncate
          ? content.substring(0, truncate) + '\n...(内容过长已截断)'
          : content;
        results.push({ date: dateStr, content: trimmed });
      }
    }
    return results;
  }

  // 构建系统提示词 — 优化版：固定前缀在前，动态内容在后
  // 结构重排目的：让 Kimi 服务端 KV Cache 的前缀部分保持稳定，提升缓存命中率
  async buildSystemPrompt(context) {
    // ===== 第一部分：固定前缀（从缓存获取，避免每次读 IndexedDB）=====
    const fixedPrefix = await this._getFixedPrefix();

    // ===== 第二部分：动态内容（每次请求都变化，放在后面）=====

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

    // 读取近 N 天的饮食记录和对话摘要 — 按需加载或全量注入
    const histDays = window.QINGBAN_SETTINGS?.historyDays ?? 7;
    let dietSection = '';
    let chatSection = '';

    if (window.QINGBAN_SETTINGS?.onDemandLoad !== false && this.onDemandLoader) {
      // 按需加载分支
      const result = await this.onDemandLoader.loadForChat(context?.userText || '', simDate);
      if (result.strategy === 'no_match') {
        // 未命中历史查询：只注入索引摘要行
        dietSection = result.indexSummaryLines
          .filter(l => l.startsWith('- diet/'))
          .join('\n') || '（近 7 天无饮食记录）';
        chatSection = result.indexSummaryLines
          .filter(l => l.startsWith('- chat/'))
          .join('\n') || '（近 7 天无对话摘要）';
        if (result.indexSummaryLines.length > 0) {
          chatSection += '\n（如需历史详情，可使用 read_file 工具按需读取）';
        }
      } else {
        // 命中意图或无索引：按返回文件分流
        const dietFiles = result.files.filter(f => f.path.startsWith('diet/'));
        const chatFiles = result.files.filter(f => f.path.startsWith('chat/'));
        dietSection = dietFiles.length > 0
          ? dietFiles.map(d => `### ${d.date}\n${d.content}`).join('\n\n')
          : '（无饮食记录）';
        chatSection = chatFiles.length > 0
          ? chatFiles.map(d => `### ${d.date}\n${d.content}`).join('\n\n')
          : '（无对话摘要）';
      }
    } else {
      // 回退分支：原全量注入
      const recentDiet = await this._readRecentFiles('diet/', histDays, simDate);
      const recentChat = await this._readRecentFiles('chat/', histDays, simDate);
      dietSection = recentDiet.length > 0
        ? recentDiet.map(d => `### ${d.date}\n${d.content}`).join('\n\n')
        : '（近 7 天无饮食记录）';
      chatSection = recentChat.length > 0
        ? recentChat.map(d => `### ${d.date}\n${d.content}`).join('\n\n')
        : '（近 7 天无对话摘要）';
    }

    // 读取今日打卡状态
    let habitSection = '（暂无打卡习惯，可使用 suggest_habit 工具推荐）';
    if (this.onGetHabitStatus) {
      try {
        const habitStatus = await this.onGetHabitStatus(null);
        if (habitStatus.habits && habitStatus.habits.length > 0) {
          const lines = habitStatus.habits.map(h =>
            `- ${h.name}: ${h.todayAmount}/${h.goal}${h.unit} (${h.percentage}%) ${h.completed ? '✓' : ''} | 连续${h.streak}天`
          );
          habitSection = lines.join('\n');
        }
      } catch (e) {
        // 静默失败，不影响主流程
      }
    }

    // ===== 组装最终提示词：固定前缀 → 对话摘要 → 动态时间 → 饮食记录 → 打卡状态 =====
    // 固定前缀在最前面，服务端 KV Cache 可以复用这部分
    // 动态内容放在后面，变化不会影响前缀的缓存
    return `${fixedPrefix}

---
# 近 7 天对话摘要（动态注入）
${chatSection}

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
# 近 7 天饮食记录（动态注入）
${dietSection}

---
# 今日打卡状态（动态注入）
${habitSection}`;
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
      },
      {
        type: 'function',
        function: {
          name: 'ask_user',
          description: '向用户提出问题并提供可选选项。当需要用户确认、选择或补充信息时使用。会在底部弹出选择面板，用户可以点击预设选项或自行输入。适用于：需要确认饮食细节、询问运动情况、让用户选择建议方案等场景。',
          parameters: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '要问用户的问题文本' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: '可选项列表，如 ["选项A", "选项B", "选项C"]'
              },
              allowCustom: { type: 'boolean', description: '是否允许用户自行输入答案，默认 true' }
            },
            required: ['question', 'options']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_notification',
          description: '向用户发送提醒通知。支持立即发送和延迟发送。通知会以顶部横幅形式弹出，同时尝试发送系统级通知。适用于：喝水提醒、吃饭提醒、运动提醒、称重提醒、睡眠提醒、自定义提醒等。',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '通知标题，简短醒目，如"喝水提醒"、"该吃午饭啦"' },
              message: { type: 'string', description: '通知内容，具体且温暖，如"记得喝一杯水，今天目标2L哦~"' },
              delay_minutes: { type: 'number', description: '延迟分钟数。0=立即发送，30=30分钟后发送，120=2小时后发送。默认0。' },
              type: { type: 'string', enum: ['water', 'meal', 'exercise', 'weight', 'sleep', 'custom'], description: '通知类型，决定通知图标和颜色。water=喝水, meal=吃饭, exercise=运动, weight=称重, sleep=睡眠, custom=自定义。默认custom。' }
            },
            required: ['title', 'message']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'checkin_habit',
          description: '为用户完成习惯打卡。支持按习惯名称打卡，可记录数量。同一天可多次打卡，数量会累加。用户提到喝水、运动等习惯行为时调用。',
          parameters: {
            type: 'object',
            properties: {
              habit_name: { type: 'string', description: '习惯名称，如"喝水""跑步"' },
              amount: { type: 'number', description: '本次打卡数量，如喝水0.5L、跑步30分钟。如不指定则默认1。' },
              note: { type: 'string', description: '备注信息（可选）' }
            },
            required: ['habit_name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_habit_status',
          description: '查询用户今日或指定日期的打卡状态，包括各习惯的完成进度、连续天数。用户询问打卡进度时调用。',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: '查询日期 YYYY-MM-DD，不传则默认今天' }
            }
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'suggest_habit',
          description: '基于用户的学习习惯档案，推荐适合打卡的健康习惯。用户要求推荐习惯或首次使用打卡功能时调用。',
          parameters: {
            type: 'object',
            properties: {}
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'add_habit',
          description: '添加一个新的打卡习惯。当用户在对话中要求添加习惯时调用。',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '习惯名称，如"冥想""阅读"' },
              unit: { type: 'string', description: '计量单位，如"分钟""次""页"' },
              daily_goal: { type: 'number', description: '每日目标量' },
              icon: { type: 'string', description: '习惯图标 emoji（可选），默认为 ✅' }
            },
            required: ['name', 'unit', 'daily_goal']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'record_metrics',
          description: '记录当日结构化热量与体重数据（趋势统计专用）。在把饮食记录写入 diet/YYYY-MM-DD.md 之后必须调用本工具双写结构化数据；单独称重时也可直接调用并只传 weight。同一餐重复调用会自动去重。',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: '记录日期 YYYY-MM-DD，不传默认今天' },
              meals: {
                type: 'array',
                description: '餐次热量列表，如 [{"name":"午餐","kcal":650}]',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: '餐次名：早餐/午餐/晚餐/加餐/夜宵/零食' },
                    kcal: { type: 'number', description: '该餐估算热量 kcal' }
                  },
                  required: ['name', 'kcal']
                }
              },
              total: { type: 'number', description: '当日总热量 kcal，可省略（省略时按餐次自动求和）' },
              weight: { type: 'number', description: '体重 kg（称重时传入，可单独使用）' }
            },
            required: ['meals']
          }
        }
      }
    ];
  }

  // 执行单个工具调用
  async executeTool(toolCall) {
    const name = toolCall.function.name;
    let args;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch (parseErr) {
      // 工具调用参数 JSON 解析失败（可能因 max_tokens 截断）
      console.error('[LLMService] 工具参数 JSON 解析失败:', parseErr.message);
      console.error('[LLMService] 参数前 200 字符:', toolCall.function.arguments?.substring(0, 200));
      this.toolCallLog.push({
        tool: name,
        displayName: `${name}(JSON解析失败)`,
        args: { raw: toolCall.function.arguments?.substring(0, 500) },
        result: `Error: 参数 JSON 解析失败: ${parseErr.message}`,
        resultPreview: `参数 JSON 解析失败`,
        timestamp: new Date().toISOString()
      });
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        name: name,
        content: `Error: 参数 JSON 解析失败: ${parseErr.message}。请重试，回答尽量简洁。`
      };
    }

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
          // KV Cache 优化：如果修改的是固定文件，失效前缀缓存
          this._invalidatePrefixCache(args.path);
          break;

        case 'search_files':
          result = await this.fm.searchFiles(args.pattern);
          displayName = `search_files("${args.pattern}")`;
          break;

        case 'append_file':
          result = await this.fm.appendFile(args.path, args.content);
          displayName = `append_file("${args.path}", ${args.content.length} chars)`;
          // KV Cache 优化：如果修改的是固定文件，失效前缀缓存
          this._invalidatePrefixCache(args.path);
          break;

        case 'ask_user':
          // 通过回调向用户提问，等待用户选择或输入
          if (this.onAskUser) {
            result = await this.onAskUser(args.question, args.options || [], args.allowCustom !== false);
          } else {
            result = '用户交互回调未注册';
          }
          displayName = `ask_user("${args.question.substring(0, 30)}...")`;
          break;

        case 'send_notification':
          // 通过回调发送通知
          if (this.onSendNotification) {
            const notifResult = await this.onSendNotification(
              args.title,
              args.message,
              args.delay_minutes || 0,
              args.type || 'custom'
            );
            result = JSON.stringify(notifResult);
          } else {
            result = '通知回调未注册';
          }
          displayName = `send_notification("${args.title}", delay=${args.delay_minutes || 0}min)`;
          break;

        case 'checkin_habit':
          if (this.onCheckinHabit) {
            const checkinResult = await this.onCheckinHabit(args.habit_name, args.amount || 1, args.note || '');
            result = JSON.stringify(checkinResult);
          } else {
            result = '打卡回调未注册';
          }
          displayName = `checkin_habit("${args.habit_name}", ${args.amount || 1})`;
          break;

        case 'get_habit_status':
          if (this.onGetHabitStatus) {
            const statusResult = await this.onGetHabitStatus(args.date || null);
            result = JSON.stringify(statusResult);
          } else {
            result = '打卡状态查询回调未注册';
          }
          displayName = `get_habit_status("${args.date || 'today'}")`;
          break;

        case 'suggest_habit':
          if (this.onSuggestHabit) {
            const suggestResult = await this.onSuggestHabit();
            result = JSON.stringify(suggestResult);
          } else {
            result = '习惯推荐回调未注册';
          }
          displayName = `suggest_habit()`;
          break;

        case 'add_habit':
          if (this.onAddHabit) {
            const addResult = await this.onAddHabit(args.name, args.unit, args.daily_goal, args.icon);
            result = JSON.stringify(addResult);
          } else {
            result = '添加习惯回调未注册';
          }
          displayName = `add_habit("${args.name}")`;
          break;

        case 'record_metrics':
          if (this.onRecordMetrics) {
            const metricsResult = await this.onRecordMetrics(args);
            result = JSON.stringify(metricsResult);
          } else {
            result = 'record_metrics 回调未注册';
          }
          displayName = `record_metrics(${args.date || 'today'}, ${Array.isArray(args.meals) ? args.meals.length : 0}餐${args.weight ? ', ' + args.weight + 'kg' : ''})`;
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

  // 优化：剥离历史消息中的图片，仅保留最近一条用户消息的图片
  // 避免每轮请求都把历史图片重新用 base64 发给模型做视觉编码（缓慢且浪费 token）
  // 历史图片的关键信息已写入长期记忆文件，模型可通过 read_file 获取
  _stripHistoryImages(messages) {
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastUserIdx = i; break; }
    }
    return messages.map((m, idx) => {
      if (m.role === 'user' && idx !== lastUserIdx && Array.isArray(m.content)) {
        const newContent = m.content.map(c =>
          (c.type === 'image_url' || c.type === 'image')
            ? { type: 'text', text: '[历史图片已省略，其内容已写入长期记忆文件]' }
            : c
        );
        return { ...m, content: newContent };
      }
      return m;
    });
  }

  // 主对话方法 — 包含 Function Calling 循环
  async chat(userMessage, conversationHistory, context) {
    this.toolCallLog = [];
    this._lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this._lastModel = 'unknown';

    // ===== 第三层：响应缓存检查 =====
    // 对短时间内相同（对话历史 + 用户消息）的请求直接返回缓存结果
    // 跳过带图片的请求（图片内容难以作为缓存 key）
    const hasImages = conversationHistory.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' || c.type === 'image')
    ) || (typeof userMessage !== 'string');

    if (!hasImages) {
      const cacheKey = this._computeResponseCacheKey(userMessage, conversationHistory);
      const cached = this._getResponseFromCache(cacheKey);
      if (cached) {
        return cached;
      }
      // 记住 cacheKey，API 返回后写入缓存
      this._pendingCacheKey = cacheKey;
    } else {
      this._pendingCacheKey = null;
    }

    context = context || {};
    context.userText = typeof userMessage === 'string' ? userMessage
      : (Array.isArray(userMessage) ? userMessage.filter(p => p.type === 'text').map(p => p.text).join(' ') : '');
    const systemPrompt = await this.buildSystemPrompt(context);

    let messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];
    // 优化：历史轮次的图片只做视觉编码一次，后续请求省略，避免每轮重复编码历史图片
    messages = this._stripHistoryImages(messages);

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
        const result = {
          content: response.content,
          toolCalls: this.toolCallLog,
          model: response.model || this._lastModel || 'unknown',
          usage: this._lastUsage
        };

        // ===== 第三层：写入响应缓存 =====
        // 只缓存无工具调用的最终回复（带工具调用的回复依赖上下文，不适合缓存）
        if (this._pendingCacheKey && this.toolCallLog.length === 0) {
          this._setResponseCache(this._pendingCacheKey, result);
        }
        this._pendingCacheKey = null;

        return result;
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
    // 有工具调用的回复不写入缓存
    this._pendingCacheKey = null;
    return {
      content: '抱歉，处理超时了，请重试。',
      toolCalls: this.toolCallLog
    };
  }

  // 流式版 chat — 支持 onTextChunk 回调实时输出文本
  // onTextChunk(chunk, fullText) 在每个文本增量时调用
  // onToolStart(toolName) 在工具执行前调用（可选）
  // onThinkingChunk(chunk, fullText) 在思考增量时调用（可选）
  async chatStream(userMessage, conversationHistory, context, onTextChunk, onToolStart, onThinkingChunk) {
    this.toolCallLog = [];
    this._lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    this._lastModel = 'unknown';
    // 流式模式不使用响应缓存
    this._pendingCacheKey = null;

    context = context || {};
    context.userText = typeof userMessage === 'string' ? userMessage
      : (Array.isArray(userMessage) ? userMessage.filter(p => p.type === 'text').map(p => p.text).join(' ') : '');
    const systemPrompt = await this.buildSystemPrompt(context);

    let messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];
    // 优化：历史轮次的图片只做视觉编码一次，后续请求省略，避免每轮重复编码历史图片
    messages = this._stripHistoryImages(messages);

    const tools = this.getToolDefinitions();
    let finalContent = '';
    let finalThinking = '';

    for (let round = 0; round < this.maxToolRounds; round++) {
      // 调用流式接口（带 try-catch 防止网络错误直接中断）
      let response;
      try {
        response = await this.llm.chatStream(messages, tools, context, (chunk) => {
          finalContent += chunk;
          if (onTextChunk) onTextChunk(chunk, finalContent);
        }, (thinkingChunk) => {
          finalThinking += thinkingChunk;
          if (onThinkingChunk) onThinkingChunk(thinkingChunk, finalThinking);
        });
      } catch (llmErr) {
        // LLM 调用失败 — 如果已有部分内容，返回部分内容
        if (finalContent) {
          return {
            content: finalContent + '\n\n⚠️ （网络中断，回复可能不完整，可点击重试）',
            toolCalls: this.toolCallLog,
            model: this._lastModel || 'unknown',
            usage: this._lastUsage
          };
        }
        throw llmErr;
      }

      // 累加 token 用量
      if (response.usage) {
        this._lastUsage.prompt_tokens += response.usage.prompt_tokens || 0;
        this._lastUsage.completion_tokens += response.usage.completion_tokens || 0;
        this._lastUsage.total_tokens += response.usage.total_tokens || 0;
      }
      if (response.model) {
        this._lastModel = response.model;
      }

      // 检测流式中断（spark-llm 返回 stop_reason: 'error'）— 不执行可能不完整的工具调用
      if (response.stop_reason === 'error') {
        console.warn('[LLMService] 检测到流式中断，返回部分内容');
        return {
          content: response.content || finalContent,
          toolCalls: this.toolCallLog,
          model: response.model || this._lastModel || 'unknown',
          usage: this._lastUsage
        };
      }

      // 检测 max_tokens 截断：如果有工具调用但 stop_reason 为 max_tokens，
      // 说明工具参数被截断，不执行工具，直接提示用户重试
      if (response.stop_reason === 'max_tokens' && response.tool_calls && response.tool_calls.length > 0) {
        const _hasImg = messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url' || c.type === 'image'));
        console.warn('[LLMService] 检测到 max_tokens 截断，工具调用可能不完整，跳过执行。诊断:', {
          hasImages: _hasImg,
          thinkingLen: finalThinking.length,
          contentLen: finalContent.length,
          toolCount: response.tool_calls.length,
          tools: response.tool_calls.map(t => ({ name: t.function.name, argsLen: t.function.arguments.length, argsHead: t.function.arguments.slice(0, 120) })),
          usage: response.usage,
          model: response.model
        });
        if (onTextChunk) onTextChunk('', finalContent + '\n\n⚠️ 回复因 token 上限被截断，请重新发送消息。');
        return {
          content: finalContent + '\n\n⚠️ 回复因 token 上限被截断，工具调用未完成。请重新发送消息。',
          toolCalls: this.toolCallLog,
          model: response.model || this._lastModel || 'unknown',
          usage: this._lastUsage
        };
      }

      // 如果没有工具调用，返回最终回复
      if (!response.tool_calls || response.tool_calls.length === 0) {
        return {
          content: finalContent || response.content,
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
        if (onToolStart) onToolStart(toolCall.function.name);
        const toolResult = await this.executeTool(toolCall);
        messages.push(toolResult);
      }

      // 工具调用后保留 finalContent / finalThinking 的累积（不重置），
      // 使多轮工具调用产生的文本能完整拼接显示
    }

    // 超过最大轮次
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
