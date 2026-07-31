// spark-llm.js
// 大模型适配器 — 支持 OpenAI 和 Anthropic 两种 API 格式
//  - APK 模式: window.QINGBAN_CONFIG 存在时直连(支持讯飞OpenAI格式 / Kimi Anthropic格式)
//  - 开发模式: 走后端代理 /api/chat (node server.js)
// 与 MockLLM 接口一致,可直接替换。LLMService 的 Function Calling 循环无需改动。

export class SparkLLM {
  constructor() {
    this.callCount = 0;
    const cfg = (typeof window !== 'undefined') ? window.QINGBAN_CONFIG : null;
    this.apkMode = !!(cfg && cfg.apiKey && cfg.apiKey !== 'your-coding-plan-api-key');
    if (this.apkMode) {
      this.apiKey = cfg.apiKey;
      this.baseURL = (cfg.baseURL || '').replace(/\/$/, '');
      this.model = cfg.model || 'k3';
      this.apiFormat = cfg.apiFormat || 'openai'; // 'openai' or 'anthropic'
    } else {
      this.endpoint = '/api/chat';
      this.streamEndpoint = '/api/chat/stream';
      this.apiFormat = 'openai';
    }
  }

  // 统一的 HTTP 请求 — 带重试机制
  async _request_openai(payload, retries = 30) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        if (!resp.ok) {
          let msg = text;
          try { const j = JSON.parse(text); msg = j.error?.message || j.message || text; } catch (_) {}
          if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
            const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
            console.warn(`[LLM] ${resp.status}，${wait}ms 后重试 (${attempt + 1}/${retries})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
        }
        return JSON.parse(text);
      } catch (e) {
        lastError = e;
        const isNetworkError = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('network');
        if (isNetworkError && attempt < retries) {
          const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
          console.warn(`[LLM] 网络错误，${wait}ms 后重试 (${attempt + 1}/${retries}): ${e.message}`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('LLM 请求失败（重试耗尽）');
  }

  // Anthropic 格式请求
  async _request_anthropic(payload, retries = 30) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`${this.baseURL}/v1/messages`, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const text = await resp.text();
        if (!resp.ok) {
          let msg = text;
          try { const j = JSON.parse(text); msg = j.error?.message || j.message || text; } catch (_) {}
          if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
            const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
            console.warn(`[LLM] ${resp.status}，${wait}ms 后重试 (${attempt + 1}/${retries})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
        }
        return JSON.parse(text);
      } catch (e) {
        lastError = e;
        const isNetworkError = e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.message.includes('network');
        if (isNetworkError && attempt < retries) {
          const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
          console.warn(`[LLM] 网络错误，${wait}ms 后重试 (${attempt + 1}/${retries}): ${e.message}`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('LLM 请求失败（重试耗尽）');
  }

  // 检测 messages 中是否包含图片
  _hasImages(messages) {
    return messages.some(m => {
      if (Array.isArray(m.content)) {
        return m.content.some(c => c.type === 'image_url' || c.type === 'image');
      }
      return false;
    });
  }

  // ===== OpenAI → Anthropic 格式转换 =====

  // 将 OpenAI messages 转为 Anthropic 格式（提取 system，转换 tool 消息）
  _convertToAnthropicMessages(messages) {
    let system = '';
    const anthropicMessages = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // 提取 system prompt
        system += (system ? '\n\n' : '') + (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
        continue;
      }

      if (msg.role === 'tool') {
        // OpenAI tool result → Anthropic tool_result
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content
          }]
        });
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls) {
        // OpenAI assistant with tool_calls → Anthropic assistant with tool_use
        const content = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
          });
        }
        anthropicMessages.push({ role: 'assistant', content });
        continue;
      }

      // 普通消息 — 处理图片内容
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        const content = msg.content.map(c => {
          if (c.type === 'image_url') {
            // OpenAI image_url → Anthropic image
            const url = c.image_url?.url || '';
            const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
              return {
                type: 'image',
                source: { type: 'base64', media_type: match[1], data: match[2] }
              };
            }
            return { type: 'text', text: '[图片]' };
          }
          return c; // text 类型直接用
        });
        anthropicMessages.push({ role: msg.role, content });
        continue;
      }

      // 纯文本消息
      anthropicMessages.push({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      });
    }

    return { system, messages: anthropicMessages };
  }

  // 将 OpenAI tools 转为 Anthropic tools 格式
  _convertToAnthropicTools(tools) {
    if (!tools || !Array.isArray(tools)) return undefined;
    return tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters
    }));
  }

  // 将 Anthropic 响应转回 OpenAI 格式（供 LLMService 使用）
  _convertFromAnthropicResponse(data, modelName) {
    const contentParts = data.content || [];
    let textContent = '';
    const toolCalls = [];

    for (const part of contentParts) {
      if (part.type === 'text') {
        textContent += part.text;
      } else if (part.type === 'tool_use') {
        toolCalls.push({
          id: part.id,
          type: 'function',
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input)
          }
        });
      }
    }

    const usage = data.usage || {};
    return {
      role: 'assistant',
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      model: modelName,
      usage: {
        prompt_tokens: usage.input_tokens || 0,
        completion_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0)
      }
    };
  }

  // 主入口 — 供 LLMService.chat() 调用
  async chat(messages, tools, context) {
    this.callCount++;
    const settings = window.QINGBAN_SETTINGS || {};
    const hasImages = this._hasImages(messages);
    const visionModel = settings.visionModel || 'k3';
    const chatModel = settings.chatModel || 'k3';
    const modelName = hasImages ? visionModel : chatModel;
    const temperature = settings.temperature ?? 0.7;

    console.log(`[LLM] 使用模型: ${modelName} (图片: ${hasImages ? '是' : '否'}) 格式: ${this.apiFormat} 温度: ${temperature}`);

    let data;

    if (this.apkMode && this.apiFormat === 'anthropic') {
      // ===== Anthropic 格式 =====
      const { system, messages: anthropicMessages } = this._convertToAnthropicMessages(messages);
      const anthropicTools = this._convertToAnthropicTools(tools);

      const maxTokens = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;

      const payload = {
        model: modelName,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: anthropicMessages,
        temperature: temperature,
        tools: anthropicTools
      };

      try {
        data = await this._request_anthropic(payload);
      } catch (e) {
        throw e;
      }

      return this._convertFromAnthropicResponse(data, modelName);

    } else if (this.apkMode) {
      // ===== OpenAI 格式（讯飞等） =====
      const payload = {
        messages,
        tools: tools || undefined,
        model: modelName,
        temperature: temperature
      };

      try {
        data = await this._request_openai(payload);
      } catch (e) {
        if (!this.apkMode && e.message.includes('Failed to fetch')) {
          throw new Error('无法连接后端代理,请先运行 `node server.js`');
        }
        throw e;
      }

      const choice = data.choices?.[0];
      const message = choice?.message || {};
      const usage = data.usage || {};
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls || null,
        model: modelName,
        usage: {
          prompt_tokens: usage.prompt_tokens || usage.input_tokens || 0,
          completion_tokens: usage.completion_tokens || usage.output_tokens || 0,
          total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
        }
      };

    } else {
      // ===== 开发模式（后端代理） =====
      const payload = { messages, tools: tools || undefined };

      try {
        data = await this._request_openai(payload);
      } catch (e) {
        if (e.message.includes('Failed to fetch')) {
          throw new Error('无法连接后端代理,请先运行 `node server.js`(或 npm start)');
        }
        throw e;
      }

      const choice = data.choices?.[0];
      const message = choice?.message || {};
      const usage = data.usage || {};
      return {
        role: 'assistant',
        content: message.content ?? '',
        tool_calls: message.tool_calls || null,
        model: modelName,
        usage: {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0
        }
      };
    }
  }

  // ===== 流式请求 — SSE 解析 =====

  // 流式版 chat — onChunk(text) 在每个文本增量时回调
  // onThinkingChunk(text) 在思考增量时回调（可选）
  // 返回格式与 chat() 一致: { content, tool_calls, model, usage }
  async chatStream(messages, tools, context, onChunk, onThinkingChunk) {
    this.callCount++;
    const settings = window.QINGBAN_SETTINGS || {};
    const hasImages = this._hasImages(messages);
    const visionModel = settings.visionModel || 'k3';
    const chatModel = settings.chatModel || 'k3';
    const modelName = hasImages ? visionModel : chatModel;
    const temperature = settings.temperature ?? 0.7;

    console.log(`[LLM Stream] 模型: ${modelName} 图片: ${hasImages} 格式: ${this.apiFormat}`);

    if (this.apkMode && this.apiFormat === 'anthropic') {
      return await this._streamAnthropic(messages, tools, modelName, temperature, settings, onChunk, onThinkingChunk);
    } else if (this.apkMode) {
      return await this._streamOpenAI(messages, tools, modelName, temperature, settings, onChunk, false);
    } else {
      return await this._streamOpenAI(messages, tools, modelName, temperature, settings, onChunk, true);
    }
  }

  // OpenAI 格式流式（APK 直连或代理）
  async _streamOpenAI(messages, tools, modelName, temperature, settings, onChunk, isProxy) {
    const payload = isProxy
      ? { messages, tools: tools || undefined }
      : { messages, tools: tools || undefined, model: modelName, temperature, stream: true };

    const url = isProxy ? this.streamEndpoint : `${this.baseURL}/chat/completions`;
    const headers = isProxy
      ? { 'Content-Type': 'application/json' }
      : { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch (_) {}
      throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // 保留最后不完整的行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        // 兼容 "data: {...}" 和 "data:{...}" 两种格式
        const data = trimmed.slice(5).trimStart();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;

          if (delta) {
            // 文本增量
            if (delta.content) {
              content += delta.content;
              if (onChunk) onChunk(delta.content);
            }
            // 工具调用增量
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index || 0;
                if (!toolCalls[idx]) {
                  toolCalls[idx] = {
                    id: tc.id || `call-${idx}`,
                    type: 'function',
                    function: { name: '', arguments: '' }
                  };
                }
                if (tc.function?.name) toolCalls[idx].function.name = tc.function.name;
                if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }

          // usage 可能在最后一个 chunk
          if (json.usage) {
            usage = {
              prompt_tokens: json.usage.prompt_tokens || 0,
              completion_tokens: json.usage.completion_tokens || 0,
              total_tokens: json.usage.total_tokens || 0
            };
          }
        } catch (_) {
          // 忽略解析错误的行
        }
      }
    }

    // 清理 buffer 中剩余数据
    if (buffer.trim().startsWith('data:')) {
      const data = buffer.trim().slice(5).trimStart();
      if (data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          if (delta?.content) {
            content += delta.content;
            if (onChunk) onChunk(delta.content);
          }
          if (json.usage) {
            usage = {
              prompt_tokens: json.usage.prompt_tokens || 0,
              completion_tokens: json.usage.completion_tokens || 0,
              total_tokens: json.usage.total_tokens || 0
            };
          }
        } catch (_) {}
      }
    }

    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      model: modelName,
      usage
    };
  }

  // Anthropic 格式流式
  async _streamAnthropic(messages, tools, modelName, temperature, settings, onChunk, onThinkingChunk) {
    const { system, messages: anthropicMessages } = this._convertToAnthropicMessages(messages);
    const anthropicTools = this._convertToAnthropicTools(tools);
    const maxTokens = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;

    const payload = {
      model: modelName,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: anthropicMessages,
      temperature,
      tools: anthropicTools,
      stream: true
    };

    const resp = await fetch(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text();
      let msg = text;
      try { msg = JSON.parse(text).error?.message || text; } catch (_) {}
      throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let currentToolIdx = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        // 兼容 "data: {...}" 和 "data:{...}" 两种格式
        const data = trimmed.slice(5).trimStart();
        if (!data) continue;

        try {
          const json = JSON.parse(data);

          if (json.type === 'content_block_start') {
            if (json.content_block?.type === 'tool_use') {
              currentToolIdx++;
              toolCalls.push({
                id: json.content_block.id,
                type: 'function',
                function: {
                  name: json.content_block.name,
                  arguments: ''
                }
              });
            }
          } else if (json.type === 'content_block_delta') {
            const delta = json.delta;
            if (delta?.type === 'text_delta') {
              content += delta.text;
              if (onChunk) onChunk(delta.text);
            } else if (delta?.type === 'thinking_delta') {
              // 思考增量 — 通过 onThinkingChunk 回调传出
              if (onThinkingChunk) onThinkingChunk(delta.thinking);
            } else if (delta?.type === 'input_json_delta') {
              if (currentToolIdx >= 0) {
                toolCalls[currentToolIdx].function.arguments += delta.partial_json;
              }
            }
          } else if (json.type === 'message_delta') {
            if (json.usage) {
              usage.completion_tokens = json.usage.output_tokens || 0;
              usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
            }
          } else if (json.type === 'message_start' && json.message?.usage) {
            usage.prompt_tokens = json.message.usage.input_tokens || 0;
            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          }
        } catch (_) {}
      }
    }

    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      model: modelName,
      usage
    };
  }

  // 供 ChatManager.compactHistory() 调用 — 生成对话摘要
  async generateSummary(messages) {
    const sysPrompt = '你是轻伴的摘要助手。请把以下对话压缩成简短摘要(150字内),保留:饮食记录、体重变化、用户诉求、AI给的关键建议。用要点形式。';
    const userContent = messages.map(m => {
      const text = typeof m.content === 'string'
        ? m.content
        : (Array.isArray(m.content) ? m.content.map(c => c.type === 'text' ? c.text : '[图片]').join(' ') : '');
      return `[${m.role}] ${text}`;
    }).join('\n');

    const settings = window.QINGBAN_SETTINGS || {};
    const summaryModel = settings.summaryModel || 'k3';
    const temperature = settings.temperature ?? 0.7;

    if (this.apkMode && this.apiFormat === 'anthropic') {
      // Anthropic 格式
      const payload = {
        model: summaryModel,
        max_tokens: 1024,
        system: sysPrompt,
        messages: [{ role: 'user', content: userContent }],
        temperature: temperature
      };
      try {
        const data = await this._request_anthropic(payload);
        const textParts = (data.content || []).filter(c => c.type === 'text').map(c => c.text);
        return textParts.join('') || '【摘要为空】';
      } catch (e) {
        return '【摘要生成失败】';
      }
    } else {
      // OpenAI 格式
      const payload = {
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userContent }
        ],
        model: summaryModel,
        temperature: temperature
      };
      try {
        const data = await this._request_openai(payload);
        return data.choices?.[0]?.message?.content || '【摘要为空】';
      } catch (e) {
        return this.apkMode ? '【摘要生成失败】' : '【摘要生成失败:后端未连接】';
      }
    }
  }
}
