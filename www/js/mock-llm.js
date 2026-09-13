// mock-llm.js
// 模拟大模型 API — 支持 Function Calling
// 模拟通义千问 Plus 的对话能力 + 工具调用行为

export class MockLLM {
  constructor() {
    this.callCount = 0;
    this.foodDatabase = [
      { name: '辣椒炒肉 + 米饭(1碗)', calories: 680, type: '湘菜', note: '用油较多，建议下次少油', tags: ['辣','高蛋白'] },
      { name: '清炒西兰花 + 煎鸡胸肉 + 半碗米饭', calories: 520, type: '家常菜', note: '搭配合理，蛋白质充足', tags: ['健康','高蛋白'] },
      { name: '包子(2个) + 无糖豆浆', calories: 450, type: '早餐', note: '经典早餐搭配', tags: ['碳水'] },
      { name: '牛肉面', calories: 750, type: '面食', note: '面量较大，建议少吃面多喝汤', tags: ['高碳水'] },
      { name: '番茄炒蛋 + 米饭 + 紫菜蛋花汤', calories: 550, type: '家常菜', note: '营养均衡', tags: ['均衡'] },
      { name: '沙拉 + 烤鸡胸肉', calories: 380, type: '轻食', note: '低卡健康选择', tags: ['低卡','健康'] },
      { name: '麻婆豆腐 + 米饭', calories: 620, type: '川菜', note: '豆腐好蛋白，但油偏多', tags: ['辣','高蛋白'] },
      { name: '红烧排骨 + 米饭 + 炒青菜', calories: 820, type: '家常菜', note: '排骨热量偏高，注意控制量', tags: ['高脂'] },
      { name: '蒸蛋羹 + 杂粮馒头 + 凉拌黄瓜', calories: 420, type: '早餐', note: '优质蛋白+粗粮', tags: ['健康'] },
      { name: '宫保鸡丁 + 米饭', calories: 650, type: '川菜', note: '注意：宫保鸡丁通常含花生！', tags: ['辣','警告花生'] },
    ];
  }

  // 主入口 — 模拟 LLM API 调用
  async chat(messages, tools, context) {
    await this._delay(600 + Math.random() * 800);

    const lastMsg = messages[messages.length - 1];

    if (lastMsg.role === 'user') {
      return this._handleUserMessage(lastMsg, messages, context);
    }

    if (lastMsg.role === 'tool') {
      return this._handleToolResult(messages, context);
    }

    return { role: 'assistant', content: '好的，还有什么想聊的吗？' };
  }

  // 处理用户消息
  _handleUserMessage(userMsg, messages, context) {
    const text = this._extractText(userMsg);
    const hasImage = this._hasImage(userMsg);
    const intent = this._detectIntent(text, hasImage);

    switch (intent) {
      case 'photo_diet': return this._startPhotoDiet(userMsg, context);
      case 'diet_record': return this._startDietRecord(text, context);
      case 'weight_update': return this._startWeightUpdate(text, context);
      case 'history_query': return this._startHistoryQuery(text, context);
      case 'food_safety': return this._startFoodSafety(text, context);
      case 'exercise': return this._startExercise(text, context);
      case 'profile_update': return this._startProfileUpdate(text, context);
      case 'insight_query': return this._startInsightQuery(text, context);
      default: return this._handleGeneral(text, context);
    }
  }

  // 处理工具返回结果
  _handleToolResult(messages, context) {
    const userMsg = messages.filter(m => m.role === 'user').pop();
    const text = this._extractText(userMsg);
    const hasImage = this._hasImage(userMsg);
    const intent = this._detectIntent(text, hasImage);

    const toolResults = messages.filter(m => m.role === 'tool');
    const lastResult = toolResults[toolResults.length - 1];
    const lastToolCall = this._findLastToolCall(messages);

    switch (intent) {
      case 'photo_diet': return this._continuePhotoDiet(toolResults, messages, context, text);
      case 'diet_record': return this._continueDietRecord(toolResults, messages, context, text);
      case 'weight_update': return this._continueWeightUpdate(toolResults, messages, context, text);
      case 'history_query': return this._continueHistoryQuery(toolResults, messages, context, text);
      case 'food_safety': return this._continueFoodSafety(toolResults, messages, context, text);
      case 'exercise': return this._continueExercise(toolResults, messages, context, text);
      case 'profile_update': return this._continueProfileUpdate(toolResults, messages, context, text);
      case 'insight_query': return this._continueInsightQuery(toolResults, messages, context, text);
      default: return this._handleGeneral(text, context);
    }
  }

  // ===== 意图检测 =====
  _detectIntent(text, hasImage = false) {
    const t = text.toLowerCase();

    if (hasImage || t.includes('拍照') || t.includes('照片')) return 'photo_diet';

    if (/吃了|吃个|吃了点|今天的|午餐|早餐|晚餐|加餐|吃了啥|饮食记录/.test(t) &&
        !/能吃|可以吃|能不能|该不该|昨天|前天|上次|历史|之前|前几天|过去|回忆|什么|啥$/.test(t)) {
      return 'diet_record';
    }

    if (/体重|称了|秤|重了|轻了|公斤|kg\b/.test(t)) return 'weight_update';

    if (/昨天|上次|前天|历史|之前|前几天|过去|回忆/.test(t)) return 'history_query';

    if (/能吃|可以吃|能不能|该不该|能不能吃|可不可以/.test(t)) return 'food_safety';

    if (/运动|跑步|锻炼|健身|跑|深蹲|俯卧撑|核心|拉伸/.test(t)) return 'exercise';

    if (/过敏|忌口|偏好|口味|不吃|喜欢.*吃/.test(t)) return 'profile_update';

    if (/周报|月报|总结|洞察|报告|减肥效果|效果|趋势|模式|本周|这周|上个月|上月|最近.*天|insight/.test(t)) return 'insight_query';

    return 'general';
  }

  // ===== 拍照饮食记录 =====
  _startPhotoDiet(userMsg, context) {
    const text = this._extractText(userMsg);
    const meal = this._detectMeal(text);
    const food = this._pickFood(userMsg);

    // 检查花生过敏
    const hasPeanutWarning = food.tags.includes('警告花生');

    if (hasPeanutWarning) {
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'read_file',
            arguments: JSON.stringify({ path: 'rules/allergies.md' })
          }
        }],
        _pendingAction: { type: 'photo_diet', food, meal, context }
      };
    }

    // 直接写入饮食记录
    const date = context.currentDate;
    const dietPath = `diet/${date}.md`;
    const dietContent = this._buildDietEntry(date, meal, food, context);

    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: dietPath, content: dietContent })
          }
        },
        {
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'append_file',
            arguments: JSON.stringify({
              path: 'INDEX.md',
              content: `- diet/${date}.md — 总热量 ~${food.calories}kcal，${meal}：${food.name}`
            })
          }
        }
      ],
      _pendingAction: { type: 'photo_diet', food, meal, context }
    };
  }

  _continuePhotoDiet(toolResults, messages, context, userText) {
    const pending = this._findPendingAction(messages);
    const food = pending?.food || this.foodDatabase[0];
    const meal = pending?.meal || '午餐';

    // 检查是否有过敏文件读取结果
    const allergyResult = toolResults.find(r =>
      r.content && r.content.includes('花生')
    );

    if (allergyResult && food.tags.includes('警告花生')) {
      return {
        role: 'assistant',
        content: `我识别到这是「${food.name}」。\n\n**花生过敏警告**：你的档案中记录了花生严重过敏，而宫保鸡丁通常含有花生！建议不要食用，或者确认菜品中不含花生后再吃。\n\n如果你已经吃了且没有不适，建议以后点这道菜时提前告知店家不要放花生。\n\n要不要换一道菜？我可以帮你推荐。`
      };
    }

    // 检查写入结果
    const writeResult = toolResults.find(r =>
      r.name === 'write_file' || (r.content && r.content.includes('Written'))
    );

    if (writeResult) {
      return {
        role: 'assistant',
        content: `已经帮你记录了今天的${meal}\n\n**识别结果**：${food.name}\n**热量估算**：~${food.calories} kcal\n**建议**：${food.note}\n\n记录已保存到 \`diet/${context.currentDate}.md\`，下次问我"昨天吃了什么"就能回忆起来啦！`
      };
    }

    return { role: 'assistant', content: '记录已保存！' };
  }

  // ===== 文本饮食记录 =====
  _startDietRecord(text, context) {
    const meal = this._detectMeal(text);
    const food = this._parseFoodFromText(text);
    const date = context.currentDate;
    const dietPath = `diet/${date}.md`;
    const dietContent = this._buildDietEntry(date, meal, food, context);

    return {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'write_file',
            arguments: JSON.stringify({ path: dietPath, content: dietContent })
          }
        },
        {
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'append_file',
            arguments: JSON.stringify({
              path: 'INDEX.md',
              content: `- diet/${date}.md — 总热量 ~${food.calories}kcal，${meal}：${food.name}`
            })
          }
        }
      ],
      _pendingAction: { type: 'diet_record', food, meal, context }
    };
  }

  _continueDietRecord(toolResults, messages, context, userText) {
    const pending = this._findPendingAction(messages);
    const food = pending?.food || this.foodDatabase[0];
    const meal = pending?.meal || '加餐';

    return {
      role: 'assistant',
      content: `记好啦！\n\n**${meal}记录**：${food.name}\n**热量估算**：~${food.calories} kcal\n${food.note}\n\n已保存到 \`diet/${context.currentDate}.md\`。`
    };
  }

  // ===== 体重更新 =====
  _startWeightUpdate(text, context) {
    const weight = this._extractWeight(text);
    if (!weight) {
      return {
        role: 'assistant',
        content: '你是想记录体重吗？告诉我具体的数字就好，比如"今天81.5kg"。'
      };
    }

    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'BODY_METRICS.md' })
        }
      }],
      _pendingAction: { type: 'weight_update', weight, context }
    };
  }

  _continueWeightUpdate(toolResults, messages, context, userText) {
    const pending = this._findPendingAction(messages);
    const newWeight = pending?.weight || 82.0;

    // 检查是否已经完成了 write_file
    const writeResult = toolResults.find(r =>
      r.content && r.content.includes('Written') && r.content.includes('BODY_METRICS')
    );

    if (writeResult) {
      const prevWeight = pending?.prevWeight || 82.0;
      const diff = (newWeight - prevWeight).toFixed(1);
      const diffStr = diff > 0 ? `增加了${diff}kg` : diff < 0 ? `减轻了${Math.abs(diff)}kg` : '没有变化';

      return {
        role: 'assistant',
        content: `已更新你的体重记录\n\n**最新体重**：${newWeight}kg（${diffStr}）\nBMI: ${(newWeight / (1.75 * 1.75)).toFixed(1)}\n\n${diff < 0 ? '继续加油，减重趋势很好！' : diff > 0 ? '别灰心，体重波动是正常的，注意控制饮食就好。' : '体重稳定，保持住现在的节奏。'}\n\n记录已保存到 BODY_METRICS.md。`
      };
    }

    // 还没有 write，先读取现有数据再写入
    const metricsResult = toolResults.find(r =>
      r.content && r.content.includes('身体指标')
    );

    let prevWeight = 82.0;
    let history = '| 07-05 | 82.0 | - |';

    if (metricsResult) {
      const weightMatch = metricsResult.content.match(/体重:\s*([\d.]+)kg/);
      if (weightMatch) prevWeight = parseFloat(weightMatch[1]);

      const historyMatch = metricsResult.content.match(/\| \d{2}-\d{2} \| [\d.]+ \| [^|]+\|/g);
      if (historyMatch) history = historyMatch.join('\n');
    }

    const diff = (newWeight - prevWeight).toFixed(1);
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
    const date = context.currentDate;
    const dateShort = date.substring(5);
    const bmi = (newWeight / (1.75 * 1.75)).toFixed(1);

    const newMetrics = `---
updated: ${date}
---

# 身体指标追踪

## 最新数据
- 日期: ${date}
- 体重: ${newWeight}kg
- BMI: ${bmi}
- 体脂率: ~${(25 - (82 - newWeight) * 0.3).toFixed(1)}%
- 基础代谢: ~${Math.round(1720 + (82 - newWeight) * 10)} kcal

## 体重趋势
${history}
| ${dateShort} | ${newWeight} | ${diffStr} |

## 阶段判断
${diff < 0 ? '体重下降中，继续保持！' : diff > 0 ? '体重略有上升，注意饮食控制。' : '体重持平，保持稳定。'}`;

    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'write_file',
          arguments: JSON.stringify({ path: 'BODY_METRICS.md', content: newMetrics })
        }
      }],
      _pendingAction: { type: 'weight_update', weight: newWeight, prevWeight, context }
    };
  }

  // ===== 历史查询 =====
  _startHistoryQuery(text, context) {
    const date = this._extractDate(text, context);
    const dietPath = `diet/${date}.md`;
    const chatPath = `chat/${date}.md`;

    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: dietPath })
        }
      }],
      _pendingAction: { type: 'history_query', date, dietPath, chatPath, context }
    };
  }

  _continueHistoryQuery(toolResults, messages, context, userText) {
    const pending = this._findPendingAction(messages);
    const queryDate = pending?.date || context.currentDate;

    // 找到饮食记录结果
    const dietResult = toolResults.find(r =>
      r.name === 'read_file' &&
      r.content && r.content.includes('饮食记录')
    );

    // 找到写入结果
    const writeResult = toolResults.find(r =>
      r.name === 'write_file' &&
      r.content && r.content.includes('Written')
    );

    // 如果有饮食记录结果，生成回复
    if (dietResult) {
      if (dietResult.content.includes('Error') || dietResult.content.includes('null')) {
        return {
          role: 'assistant',
          content: `那天（${queryDate}）没有饮食记录哦。可能那天没有记录饮食，要不要从今天开始记录？`
        };
      }

      const summary = this._parseDietSummary(dietResult.content);
      return {
        role: 'assistant',
        content: `我查了一下你的记录\n\n**${queryDate}** 的饮食记录：\n${summary}\n\n需要调整饮食计划吗？`
      };
    }

    // 如果有写入结果（体重更新），生成回复
    if (writeResult) {
      const weight = pending?.weight;
      const prevWeight = pending?.prevWeight;
      const diff = (weight - prevWeight).toFixed(1);
      const diffStr = diff > 0 ? `增加了${diff}kg` : diff < 0 ? `减轻了${Math.abs(diff)}kg` : '没有变化';

      return {
        role: 'assistant',
        content: `已更新你的体重记录\n\n**最新体重**：${weight}kg（${diffStr}）\nBMI: ${(weight / (1.75 * 1.75)).toFixed(1)}\n\n${diff < 0 ? '继续加油，减重趋势很好！' : diff > 0 ? '别灰心，体重波动是正常的，注意控制饮食就好。' : '体重稳定，保持住现在的节奏。'}\n\n记录已保存到 BODY_METRICS.md。`
      };
    }

    return { role: 'assistant', content: '让我看看记录...' };
  }

  // ===== 食物安全查询 =====
  _startFoodSafety(text, context) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'rules/allergies.md' })
        }
      }],
      _pendingAction: { type: 'food_safety', text, context }
    };
  }

  _continueFoodSafety(toolResults, messages, context, userText) {
    const allergyResult = toolResults.find(r =>
      r.content && r.content.includes('过敏')
    );

    const food = this._extractFoodFromQuestion(userText);
    let safe = true;
    let warning = '';

    if (allergyResult) {
      if (food.includes('花生') || food.includes('宫保') || food.includes('花生酱')) {
        safe = false;
        warning = '你有**花生严重过敏**的记录！花生可能引起过敏性休克，建议绝对避免。';
      } else if (food.includes('内脏') || food.includes('猪肝') || food.includes('鸡心')) {
        safe = false;
        warning = '你的档案中记录了不吃内脏，虽然不是过敏，但还是尊重你的偏好吧。';
      } else if (food.includes('香菜')) {
        safe = false;
        warning = '你之前说不吃香菜，所以建议跳过。';
      }
    }

    let calories = '';
    const foodInfo = this.foodDatabase.find(f => f.name.includes(food));
    if (foodInfo) {
      calories = `热量大约 ~${foodInfo.calories} kcal。${foodInfo.note}`;
    }

    if (!safe) {
      return {
        role: 'assistant',
        content: `${warning}\n\n建议换一道菜，我可以帮你推荐替代方案。`
      };
    }

    return {
      role: 'assistant',
      content: `可以吃！${food} 不在你的过敏和忌口列表里。${calories}\n\n放心享用吧~`
    };
  }

  // ===== 运动相关 =====
  _startExercise(text, context) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'rules/exercise.md' })
        }
      }],
      _pendingAction: { type: 'exercise', text, context }
    };
  }

  _continueExercise(toolResults, messages, context, userText) {
    // 检查是否已经完成了 append_file（运动记录写入）
    const appendResult = toolResults.find(r =>
      r.content && (r.content.includes('Appended') || r.content.includes('Written'))
    );

    if (appendResult) {
      return {
        role: 'assistant',
        content: '运动已记录到今日饮食文件！保持下去，每周3次跑步是很棒的习惯。注意左膝热身哦！'
      };
    }

    const exerciseResult = toolResults.find(r =>
      r.content && r.content.includes('运动')
    );

    let advice = '';
    if (exerciseResult) {
      if (userText.includes('跑') || userText.includes('跑步')) {
        advice = '根据你的运动档案，你每周跑3次5km，配速6\'30"。记得跑前充分热身，特别是左膝旧伤要注意。';
      } else if (userText.includes('深蹲')) {
        advice = '你的档案记录了左膝旧伤，建议避免深蹲。可以换成靠墙静蹲或臀桥来替代。';
      } else {
        advice = '你的运动档案显示每周跑步3次。左膝有旧伤，避免高冲击运动。';
      }
    }

    // 如果用户报告了运动，记录到当日文件
    if (userText.includes('跑了') || userText.includes('锻炼了') || userText.includes('跑了5km')) {
      const date = context.currentDate;
      return {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: `call_${++this.callCount}`,
          type: 'function',
          function: {
            name: 'append_file',
            arguments: JSON.stringify({
              path: `diet/${date}.md`,
              content: `\n## 运动\n${userText}\n消耗估算: ~300 kcal`
            })
          }
        }],
        _pendingAction: { type: 'exercise', advice, context }
      };
    }

    return {
      role: 'assistant',
      content: `${advice}\n\n有什么运动相关的问题可以随时问我！`
    };
  }

  // ===== 档案更新 =====
  _startProfileUpdate(text, context) {
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'PROFILE.md' })
        }
      }],
      _pendingAction: { type: 'profile_update', text, context }
    };
  }

  _continueProfileUpdate(toolResults, messages, context, userText) {
    return {
      role: 'assistant',
      content: '了解了！我会记住这个信息。如果你有新的过敏源或偏好变化，随时告诉我，我会更新到你的档案里。'
    };
  }

  // ===== 洞察查询 =====
  _startInsightQuery(text, context) {
    // 先读取 INDEX.md 了解有哪些洞察文件
    return {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path: 'INDEX.md' })
        }
      }],
      _pendingAction: { type: 'insight_query', text, context, step: 'read_index' }
    };
  }

  _continueInsightQuery(toolResults, messages, context, userText) {
    const pending = this._findPendingAction(messages);
    const step = pending?.step || 'read_index';

    // 第一步：读取了 INDEX.md，决定接下来读什么
    if (step === 'read_index') {
      const indexResult = toolResults.find(r => r.name === 'read_file' && r.content && r.content.includes('索引'));
      const insightFiles = [];

      if (indexResult) {
        const lines = indexResult.content.split('\n');
        for (const line of lines) {
          const match = line.match(/- (insights\/[^\s]+\.md)/);
          if (match) insightFiles.push(match[1]);
        }
      }

      // 根据用户查询决定读哪些文件
      const t = userText.toLowerCase();
      let filesToRead = [];

      if (/周报|本周|这周/.test(t) && insightFiles.some(f => f.includes('W'))) {
        filesToRead = insightFiles.filter(f => f.match(/W\d+\.md/)).slice(0, 2);
      } else if (/月报|上月|上个月/.test(t) && insightFiles.some(f => f.match(/\d{4}-\d{2}\.md/))) {
        filesToRead = insightFiles.filter(f => f.match(/\d{4}-\d{2}\.md/) && !f.includes('W')).slice(0, 2);
      } else if (/模式|趋势|洞察|pattern/.test(t) && insightFiles.some(f => f.includes('patterns'))) {
        filesToRead = insightFiles.filter(f => f.includes('patterns'));
      } else if (/效果|总结|报告/.test(t)) {
        // 读取所有洞察文件
        filesToRead = insightFiles.slice(0, 3);
      }

      // 如果没有洞察文件，尝试读取最近的饮食记录
      if (filesToRead.length === 0) {
        // 读取最近的饮食记录来生成即席总结
        return {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: `call_${++this.callCount}`,
            type: 'function',
            function: {
              name: 'search_files',
              arguments: JSON.stringify({ pattern: 'diet/*' })
            }
          }],
          _pendingAction: { type: 'insight_query', text: userText, context, step: 'search_diet' }
        };
      }

      // 读取洞察文件
      const toolCalls = filesToRead.map(path => ({
        id: `call_${++this.callCount}`,
        type: 'function',
        function: {
          name: 'read_file',
          arguments: JSON.stringify({ path })
        }
      }));

      return {
        role: 'assistant',
        content: null,
        tool_calls: toolCalls,
        _pendingAction: { type: 'insight_query', text: userText, context, step: 'read_insights', insightFiles: filesToRead }
      };
    }

    // 第二步（搜索饮食文件后）：读取找到的饮食文件
    if (step === 'search_diet') {
      const searchResult = toolResults.find(r => r.name === 'search_files');

      if (searchResult && searchResult.content && !searchResult.content.includes('Error')) {
        const dietFiles = searchResult.content.split('\n').filter(f => f.trim());
        const recentFiles = dietFiles.sort().slice(-7); // 最近7天

        if (recentFiles.length > 0) {
          const toolCalls = recentFiles.slice(0, 5).map(path => ({
            id: `call_${++this.callCount}`,
            type: 'function',
            function: {
              name: 'read_file',
              arguments: JSON.stringify({ path: path.trim() })
            }
          }));

          return {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls,
            _pendingAction: { type: 'insight_query', text: userText, context, step: 'read_diet' }
          };
        }
      }

      return {
        role: 'assistant',
        content: '目前还没有足够的记录来生成洞察报告。\n\n点击顶部的 **Auto Dream** 按钮可以手动生成周报和模式分析，或者多记录几天饮食后再试试！'
      };
    }

    // 第三步：已读取洞察文件或饮食文件，生成回复
    if (step === 'read_insights') {
      const insightResults = toolResults.filter(r => r.name === 'read_file' && r.content);

      if (insightResults.length === 0) {
        return {
          role: 'assistant',
          content: '暂无洞察报告。点击顶部的 **Auto Dream** 按钮可以生成周报和模式分析！'
        };
      }

      // 汇总洞察报告内容
      let summary = '';
      for (const result of insightResults) {
        const content = result.content;
        if (content.includes('type: weekly_report')) {
          const calMatch = content.match(/日均热量:\s*~?(\d+)/);
          const dayMatch = content.match(/记录天数:\s*(\d+)/);
          summary += `**周报摘要**\n- 记录天数: ${dayMatch ? dayMatch[1] : '?'}\n- 日均热量: ~${calMatch ? calMatch[1] : '?'} kcal\n\n`;
          // 提取 AI 建议
          const adviceMatch = content.match(/## AI 建议\n([\s\S]*?)(?=\n##|$)/);
          if (adviceMatch) summary += `建议:\n${adviceMatch[1].trim()}\n\n`;
        } else if (content.includes('type: monthly_report')) {
          const calMatch = content.match(/日均热量:\s*~?(\d+)/);
          summary += `**月报摘要**\n- 日均热量: ~${calMatch ? calMatch[1] : '?'} kcal\n\n`;
        } else if (content.includes('type: pattern_analysis')) {
          const patterns = content.match(/## (.+)/g) || [];
          if (patterns.length > 0) {
            summary += `**发现的模式**\n`;
            for (const p of patterns.slice(0, 4)) {
              summary += `- ${p.replace('## ', '')}\n`;
            }
            summary += '\n';
          }
        }
      }

      if (summary) {
        return {
          role: 'assistant',
          content: `这是你的减肥数据洞察\n\n${summary}需要更详细的某项分析吗？`
        };
      }

      return {
        role: 'assistant',
        content: '已找到洞察报告，但内容似乎为空。试试点击 **Auto Dream** 按钮重新生成？'
      };
    }

    // 读取了饮食文件后生成即席总结
    if (step === 'read_diet') {
      const dietResults = toolResults.filter(r => r.name === 'read_file' && r.content && r.content.includes('饮食记录'));

      if (dietResults.length === 0) {
        return {
          role: 'assistant',
          content: '最近没有饮食记录，无法生成总结。先记录几天的饮食吧！'
        };
      }

      let totalCal = 0;
      let dayCount = 0;
      const dayDetails = [];

      for (const result of dietResults) {
        const calMatch = result.content.match(/total_calories:\s*~?(\d+)/);
        const dateMatch = result.content.match(/date:\s*(\d{4}-\d{2}-\d{2})/);
        const mealMatch = result.content.match(/## (\S+)/g) || [];

        if (calMatch) {
          totalCal += parseInt(calMatch[1]);
          dayCount++;
          dayDetails.push({
            date: dateMatch ? dateMatch[1] : '?',
            cal: parseInt(calMatch[1]),
            meals: mealMatch.map(m => m.replace('## ', '')).join(', ')
          });
        }
      }

      const avgCal = dayCount > 0 ? Math.round(totalCal / dayCount) : 0;

      let response = `我分析了你最近的 **${dayCount} 天** 饮食记录\n\n`;
      response += `**日均热量**: ~${avgCal} kcal\n`;
      response += `**目标热量**: ~1800 kcal\n`;
      response += `**差距**: ${avgCal > 1800 ? '⚠️ 超出' : '✅ 低于'}目标 ${Math.abs(avgCal - 1800)} kcal\n\n`;

      response += `**每日明细**:\n`;
      for (const d of dayDetails) {
        response += `- ${d.date}: ~${d.cal} kcal (${d.meals})\n`;
      }

      response += `\n**建议**: `;
      if (avgCal > 2000) {
        response += '热量偏高，注意减少外卖和油炸食物，增加蔬菜比例。';
      } else if (avgCal < 1200) {
        response += '热量偏低，注意保证基础代谢，不要过度节食。';
      } else {
        response += '热量控制不错！继续保持，配合每周3次跑步效果会更好。';
      }

      response += '\n\n点击顶部 **Auto Dream** 按钮可以生成完整的周报和模式分析！';

      return {
        role: 'assistant',
        content: response
      };
    }

    return { role: 'assistant', content: '让我看看数据...' };
  }

  // ===== 每日真摘要生成（300-500字）=====
  // 供 ChatManager.saveDailySummary() 调用，保留关键事实数据原值
  async generateDailySummary(messages, date) {
    await this._delay(400 + Math.random() * 400);

    const dietEntries = [];
    const weightEntries = [];
    const checkinEntries = [];
    const allergyEntries = [];
    const preferenceEntries = [];
    const exerciseEntries = [];
    const otherEntries = [];

    for (const msg of messages) {
      const text = typeof msg.content === 'string'
        ? msg.content
        : (Array.isArray(msg.content) ? msg.content.map(c => c.type === 'text' ? c.text : '[图片]').join(' ') : '');

      if (msg.role === 'user') {
        if (/吃了|午餐|早餐|晚餐|加餐|喝了|kcal|千卡|卡路里/.test(text)) {
          dietEntries.push(text.substring(0, 80));
        }
        if (/体重|kg|公斤|斤/.test(text)) {
          weightEntries.push(text.substring(0, 80));
        }
        if (/打卡|喝水|跑步|运动|冥想|阅读/.test(text)) {
          checkinEntries.push(text.substring(0, 80));
        }
        if (/过敏|忌口|不能吃/.test(text)) {
          allergyEntries.push(text.substring(0, 80));
        }
        if (/喜欢|不喜欢|爱吃|不爱吃|口味|偏好/.test(text)) {
          preferenceEntries.push(text.substring(0, 80));
        }
        if (/锻炼|健身|瑜伽|游泳|跳|跑/.test(text)) {
          exerciseEntries.push(text.substring(0, 80));
        }
        if (!/吃了|午餐|早餐|晚餐|加餐|喝了|体重|kg|公斤|斤|打卡|喝水|跑步|运动|过敏|忌口|喜欢|锻炼/.test(text)) {
          otherEntries.push(text.substring(0, 60));
        }
      } else if (msg.role === 'assistant' && msg.content) {
        const calMatch = msg.content.match(/~?(\d+)\s*(?:kcal|千卡|卡路里)/);
        if (calMatch) dietEntries.push(`AI识别: ~${calMatch[1]}千卡`);
        const foodMatch = msg.content.match(/识别(?:到|为)[:：]?\s*(.+)/);
        if (foodMatch) dietEntries.push(`图片识别: ${foodMatch[1].substring(0, 60)}`);
      }
    }

    let summary = `# ${date} 对话摘要\n\n`;

    if (dietEntries.length > 0) {
      summary += `## 饮食记录\n`;
      dietEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (weightEntries.length > 0) {
      summary += `## 体重数据\n`;
      weightEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (checkinEntries.length > 0) {
      summary += `## 打卡记录\n`;
      checkinEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (allergyEntries.length > 0) {
      summary += `## 过敏忌口\n`;
      allergyEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (preferenceEntries.length > 0) {
      summary += `## 饮食偏好\n`;
      preferenceEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (exerciseEntries.length > 0) {
      summary += `## 运动情况\n`;
      exerciseEntries.forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }
    if (otherEntries.length > 0) {
      summary += `## 其他\n`;
      otherEntries.slice(0, 3).forEach(e => summary += `- ${e}\n`);
      summary += '\n';
    }

    if (summary.length < 300) {
      summary += `## 对话概要\n当日共 ${messages.length} 条消息，用户讨论了 ${dietEntries.length + weightEntries.length + checkinEntries.length} 个健康相关话题。\n`;
    }
    if (summary.length > 500) {
      summary = summary.substring(0, 497) + '…';
    }

    return summary;
  }

  // ===== 上下文压缩摘要生成 =====
  // 供 ChatManager.compactHistory() 调用
  async generateSummary(messages) {
    await this._delay(400 + Math.random() * 400);

    let userPoints = [];
    let assistantPoints = [];
    let dietMentions = [];
    let weightMentions = [];

    for (const msg of messages) {
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string' ? msg.content : '[图片消息]';
        userPoints.push(text);

        if (/吃了|午餐|早餐|晚餐|加餐/.test(text)) {
          dietMentions.push(text.substring(0, 30));
        }
        if (/体重|kg|公斤/.test(text)) {
          weightMentions.push(text.substring(0, 30));
        }
      } else if (msg.role === 'assistant' && msg.content) {
        // 提取关键信息
        const calMatch = msg.content.match(/~?(\d+)\s*kcal/);
        if (calMatch) dietMentions.push(`记录 ~${calMatch[1]}kcal`);
        assistantPoints.push(msg.content.substring(0, 50));
      }
    }

    let summary = '【对话摘要】\n';

    if (dietMentions.length > 0) {
      summary += `饮食记录: ${dietMentions.slice(0, 3).join('; ')}`;
      if (dietMentions.length > 3) summary += ` 等${dietMentions.length}条`;
      summary += '\n';
    }

    if (weightMentions.length > 0) {
      summary += `体重更新: ${weightMentions.join('; ')}\n`;
    }

    summary += `用户主要讨论了 ${userPoints.length} 个话题，助手回复了 ${assistantPoints.length} 次。`;

    return summary;
  }

  // ===== 通用对话 =====
  _handleGeneral(text, context) {
    const responses = {
      greeting: '你好呀！我是轻伴，你的 AI 减肥陪伴助手 😊\n\n你可以：\n- 📸 拍照记录饮食\n- ⚖️ 告诉我你的体重\n- 🤔 问我什么能吃、什么不能吃\n- 📖 问我之前吃了什么\n- 🏃 聊聊运动\n\n今天想聊什么呢？',
      help: '我能帮你做这些事：\n\n📸 **拍照记录饮食** — 拍食物照片，我帮你识别并记录\n⚖️ **体重追踪** — 告诉我体重，我帮你更新趋势\n🤔 **食物安全** — 问我能不能吃某个东西\n📖 **历史回忆** — 问我昨天/上次吃了什么\n🏃 **运动建议** — 聊聊运动计划\n\n试试看吧！',
      diet_advice: '根据你的档案，你的每日目标摄入约 1800 kcal。建议：\n- 蛋白质优先：鸡胸肉、鸡蛋、牛肉\n- 减少精制碳水：白米饭减半\n- 多吃蔬菜增加饱腹感\n\n想了解具体某道菜的热量，可以拍照给我看！',
      weight_loss: '减肥最重要的是坚持！你的目标是 82kg → 72kg，也就是减 10kg。建议每周减 0.5-1kg，这样大约需要 10-15 周。\n\n关键是：热量缺口 + 持续运动。你已经每周跑步3次了，基础很好！\n\n有什么具体的饮食或运动问题都可以问我。',
      default: '嗯嗯，我理解了。有什么饮食或运动相关的问题，随时可以问我哦！\n\n💡 你可以试试：\n- 拍张午餐照片给我看\n- 告诉我今天的体重\n- 问我"昨天吃了什么"'
    };

    const t = text.toLowerCase();
    if (/你好|hi|hello|嗨|hey/.test(t)) return { role: 'assistant', content: responses.greeting };
    if (/帮助|help|能做什么|功能|怎么用/.test(t)) return { role: 'assistant', content: responses.help };
    if (/怎么减|减肥建议|饮食建议|怎么吃/.test(t)) return { role: 'assistant', content: responses.diet_advice };
    if (/目标|多久|减多少|计划/.test(t)) return { role: 'assistant', content: responses.weight_loss };

    return { role: 'assistant', content: responses.default };
  }

  // ===== 辅助方法 =====
  _extractText(msg) {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      const textPart = msg.content.find(c => c.type === 'text');
      return textPart ? textPart.text : '';
    }
    return '';
  }

  _hasImage(msg) {
    if (Array.isArray(msg.content)) {
      return msg.content.some(c => c.type === 'image_url');
    }
    return false;
  }

  _detectMeal(text) {
    if (/早餐|早上|早饭|早晨/.test(text)) return '早餐';
    if (/午餐|中午|午饭/.test(text)) return '午餐';
    if (/晚餐|晚上|晚饭|夜宵/.test(text)) return '晚餐';
    if (/加餐|零食|下午茶/.test(text)) return '加餐';
    return '加餐';
  }

  _pickFood(userMsg) {
    // 基于消息内容确定性选择食物
    const text = this._extractText(userMsg);
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }
    const index = Math.abs(hash) % this.foodDatabase.length;
    return this.foodDatabase[index];
  }

  _parseFoodFromText(text) {
    // 尝试从文本中提取食物信息
    for (const food of this.foodDatabase) {
      if (text.includes(food.name.split(' +')[0]) || text.includes(food.name)) {
        return food;
      }
    }
    // 如果没匹配到，根据关键词推断
    if (/面|粉/.test(text)) return this.foodDatabase[3]; // 牛肉面
    if (/鸡|胸肉/.test(text)) return this.foodDatabase[5]; // 沙拉+鸡胸肉
    if (/包|豆浆/.test(text)) return this.foodDatabase[2]; // 包子+豆浆
    if (/辣|湘|炒肉/.test(text)) return this.foodDatabase[0]; // 辣椒炒肉
    return this.foodDatabase[4]; // 默认番茄炒蛋
  }

  _buildDietEntry(date, meal, food, context) {
    const time = this._getCurrentTime();
    return `---
date: ${date}
total_calories: ~${food.calories}
---

# ${date} 饮食记录

## ${meal} (${time})
- ${food.name}
- 热量估算: ~${food.calories} kcal
- 类型: ${food.type}
- AI分析: ${food.note}`;
  }

  _extractWeight(text) {
    const match = text.match(/([\d.]+)\s*(?:kg|公斤|斤)/);
    if (match) {
      let weight = parseFloat(match[1]);
      if (text.includes('斤') && !text.includes('kg')) {
        weight = weight / 2; // 斤转kg
      }
      return weight;
    }
    const match2 = text.match(/(?:体重|称了|秤)\s*[:：]?\s*([\d.]+)/);
    if (match2) return parseFloat(match2[1]);
    return null;
  }

  _extractDate(text, context) {
    const today = context.currentDate;
    if (/昨天/.test(text)) {
      return this._addDays(today, -1);
    }
    if (/前天/.test(text)) {
      return this._addDays(today, -2);
    }
    const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) return dateMatch[1];
    return today;
  }

  _addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().substring(0, 10);
  }

  _extractFoodFromQuestion(text) {
    // 从"能吃XX吗"中提取食物名
    const match = text.match(/(?:能吃|可以吃|能不能吃|可不可以吃)\s*(\S+)/);
    if (match) return match[1].replace(/[吗呢吧?？]/g, '');
    return text.replace(/能|可以|不|吃|吗|呢|吧|\?|？/g, '').trim();
  }

  _parseDietSummary(content) {
    // 从饮食记录 MD 中提取摘要
    const lines = content.split('\n');
    const summary = [];
    let currentMeal = '';

    for (const line of lines) {
      if (line.startsWith('## ') && !line.includes('饮食记录')) {
        currentMeal = line.replace('## ', '').trim();
      }
      if (line.startsWith('- ') && currentMeal) {
        summary.push(`  ${currentMeal}: ${line.replace('- ', '')}`);
        currentMeal = '';
      }
      if (line.includes('热量估算')) {
        // Already captured in the line above
      }
      if (line.includes('total_calories')) {
        const calMatch = line.match(/~(\d+)/);
        if (calMatch) summary.push(`  总热量: ~${calMatch[1]} kcal`);
      }
    }

    return summary.length > 0 ? summary.join('\n') : '记录内容为空';
  }

  _findLastToolCall(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].tool_calls) {
        return messages[i].tool_calls[messages[i].tool_calls.length - 1];
      }
    }
    return null;
  }

  _findPendingAction(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i]._pendingAction) {
        return messages[i]._pendingAction;
      }
    }
    return null;
  }

  _getCurrentTime() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
