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

  // 统一的 HTTP 请求 — 带重试机制与整体超时保护
  async _request_openai(payload, retries = 30, timeoutMs = 120000) {
    let lastError = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const resp = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
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
          // 整体超时（AbortController.abort）— 直接放弃，不再重试
          if (e.name === 'AbortError') {
            throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s 无响应），已自动取消，请重试`);
          }
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
    } finally {
      clearTimeout(timeoutId);
    }
    throw lastError || new Error('LLM 请求失败（重试耗尽）');
  }

  // Anthropic 格式请求
  async _request_anthropic(payload, retries = 30, timeoutMs = 120000) {
    let lastError = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const resp = await fetch(`${this.baseURL}/v1/messages`, {
            method: 'POST',
            headers: {
              'x-api-key': this.apiKey,
              'anthropic-version': '2023-06-01',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
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
          // 整体超时（AbortController.abort）— 直接放弃，不再重试
          if (e.name === 'AbortError') {
            throw new Error(`请求超时（${Math.round(timeoutMs / 1000)}s 无响应），已自动取消，请重试`);
          }
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
    } finally {
      clearTimeout(timeoutId);
    }
    throw lastError || new Error('LLM 请求失败（重试耗尽）');
  }

  // 流式请求的 fetch — 带连接超时(30s)和网络错误重试(3次)
  async _fetchStreamWithRetry(url, options, retries = 3) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const resp = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        if (!resp.ok) {
          const text = await resp.text();
          let msg = text;
          try { msg = JSON.parse(text).error?.message || text; } catch (_) {}

          // 429 或 5xx 重试
          if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
            const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
            console.warn(`[LLM Stream] ${resp.status}，${wait}ms 后重试 (${attempt + 1}/${retries})`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
        }

        return resp;
      } catch (e) {
        lastError = e;
        const isNetworkError = e.message.includes('Failed to fetch') ||
                               e.message.includes('NetworkError') ||
                               e.message.includes('network') ||
                               e.name === 'AbortError';

        if (isNetworkError && attempt < retries) {
          const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
          console.warn(`[LLM Stream] 网络错误，${wait}ms 后重试 (${attempt + 1}/${retries}): ${e.message}`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    throw lastError || new Error('LLM 流式请求失败（重试耗尽）');
  }

  // 带超时的 reader.read() — 防止流式读取无限挂起
  async _readWithTimeout(reader, timeoutMs = 90000) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Stream read timeout')), timeoutMs);
    });
    try {
      return await Promise.race([reader.read(), timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
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
        const content = msg.content.map(c => SparkLLM._imageUrlToAnthropic(c));
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

  // OpenAI image_url 部件 → Anthropic image 部件（data URL 转 base64 source；非 data URL 降级为文字占位）
  static _imageUrlToAnthropic(c) {
    if (c.type !== 'image_url') return c;
    const url = c.image_url?.url || '';
    const match = url.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    }
    return { type: 'text', text: '[图片]' };
  }

  // ===== 图片预识别 — 两阶段发送的第一阶段 =====
  // 图片单独发给视觉模型：不带系统提示词（省掉整个固定前缀），仅一句极简识别指令；
  // 返回识别文字后由调用方与用户文字合并为纯文本消息走主对话（文本模型、无图片重复编码）。
  // 失败抛错，由调用方回退为「原图+文字」直发。max_tokens 给 4096 余量（thinking 模式会消耗输出 token）。
  static RECOGNIZE_HINT = '请识别图片内容，简要输出。若为食物：列出食物与分量，估算总热量（kcal）；若为体重秤/运动/其他：客观描述关键信息。只输出识别结果，不要给建议。';

  async recognizeImages(images, { retries = 2, timeoutMs = 60000 } = {}) {
    const settings = window.QINGBAN_SETTINGS || {};
    const visionModel = settings.visionModel || 'k3';
    const imgs = (images || []).filter(Boolean);
    if (imgs.length === 0) return '';

    const content = [{ type: 'text', text: SparkLLM.RECOGNIZE_HINT }];
    for (const img of imgs) content.push({ type: 'image_url', image_url: { url: img } });

    if (this.apkMode && this.apiFormat === 'anthropic') {
      const payload = {
        model: visionModel,
        max_tokens: 4096,
        messages: [{ role: 'user', content: content.map(c => SparkLLM._imageUrlToAnthropic(c)) }],
        temperature: 0.2
      };
      const data = await this._request_anthropic(payload, retries, timeoutMs);
      return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    }

    if (this.apkMode) {
      const payload = { model: visionModel, messages: [{ role: 'user', content }], max_tokens: 4096, temperature: 0.2 };
      const data = await this._request_openai(payload, retries, timeoutMs);
      return (data.choices?.[0]?.message?.content || '').trim();
    }

    // 开发模式 — 走后端代理 /api/chat（OpenAI 格式，模型由服务端指定）
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content }], max_tokens: 4096 })
    });
    const respText = await resp.text();
    if (!resp.ok) throw new Error(`图片识别请求失败 (${resp.status}): ${String(respText).slice(0, 200)}`);
    return JSON.parse(respText).choices?.[0]?.message?.content?.trim() || '';
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
    const emitSent = () => {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        try { window.dispatchEvent(new CustomEvent('qb-llm-stage', { detail: { stage: 'sent', hasImages } })); } catch (_) {}
      }
    };

    if (this.apkMode && this.apiFormat === 'anthropic') {
      // ===== Anthropic 格式 =====
      const { system, messages: anthropicMessages } = this._convertToAnthropicMessages(messages);
      const anthropicTools = this._convertToAnthropicTools(tools);

      const baseMax = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;
      const maxTokens = baseMax;

      const payload = {
        model: modelName,
        max_tokens: maxTokens,
        system: system || undefined,
        messages: anthropicMessages,
        temperature: temperature,
        tools: anthropicTools
      };

      try {
        emitSent();
        data = await this._request_anthropic(payload, 30, hasImages ? 180000 : 120000);
      } catch (e) {
        throw e;
      }

      return this._convertFromAnthropicResponse(data, modelName);

    } else if (this.apkMode) {
      // ===== OpenAI 格式（讯飞等） =====
      const baseMax = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;
      const payload = {
        messages,
        tools: tools || undefined,
        model: modelName,
        temperature: temperature,
        max_tokens: baseMax
      };

      try {
        emitSent();
        data = await this._request_openai(payload, 30, hasImages ? 180000 : 120000);
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
        emitSent();
        data = await this._request_openai(payload, 30, hasImages ? 180000 : 120000);
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

    // 通知 APP 层：请求已真正发出（状态条从「准备中」切到「等待服务端响应」）
    if (typeof window !== 'undefined' && window.dispatchEvent) {
      try { window.dispatchEvent(new CustomEvent('qb-llm-stage', { detail: { stage: 'sent', hasImages } })); } catch (_) {}
    }

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
    const baseMax = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;
    const payload = isProxy
      ? { messages, tools: tools || undefined, max_tokens: baseMax }
      : { messages, tools: tools || undefined, model: modelName, temperature, stream: true, max_tokens: baseMax };

    const url = isProxy ? this.streamEndpoint : `${this.baseURL}/chat/completions`;
    const headers = isProxy
      ? { 'Content-Type': 'application/json' }
      : { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' };

    const resp = await this._fetchStreamWithRetry(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let stopReason = null;

    try {
    while (true) {
      const { done, value } = await this._readWithTimeout(reader);
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
          const choice = json.choices?.[0];
          const delta = choice?.delta;

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
          // 捕获 finish_reason（OpenAI 格式的 stop_reason）
          if (choice?.finish_reason) {
            stopReason = choice.finish_reason;
          }
        } catch (_) {
          // 忽略解析错误的行
        }
      }
    }
    } catch (streamErr) {
      // 流式读取中断（后台切换、网络波动等）— 返回已收到的部分内容
      console.warn('[LLM Stream] 流式读取中断:', streamErr.message);
      if (content || toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: content + (content ? '\n\n⚠️ （网络中断，回复可能不完整，可点击重试）' : '⚠️ 网络中断，请重试'),
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          model: modelName,
          usage,
          stop_reason: 'error'
        };
      }
      throw streamErr;
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

    if (stopReason === 'max_tokens') {
      console.warn('[LLM Stream] OpenAI max_tokens 截断诊断:', {
        model: modelName,
        hasImages: this._hasImages(messages),
        contentLen: content.length,
        toolCallsLen: toolCalls.length,
        tools: toolCalls.map(t => ({ name: t.function.name, argsLen: t.function.arguments.length })),
        usage,
        stopReason
      });
    }

    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      model: modelName,
      usage,
      stop_reason: stopReason
    };
  }

  // Anthropic 格式流式
  async _streamAnthropic(messages, tools, modelName, temperature, settings, onChunk, onThinkingChunk) {
    const { system, messages: anthropicMessages } = this._convertToAnthropicMessages(messages);
    const anthropicTools = this._convertToAnthropicTools(tools);
    const hasImages = this._hasImages(messages);
    const baseMax = settings.maxOutputTokens || window.QINGBAN_CONFIG?.maxOutputTokens || 8192;
    const maxTokens = baseMax;

    const payload = {
      model: modelName,
      max_tokens: maxTokens,
      system: system || undefined,
      messages: anthropicMessages,
      temperature,
      tools: anthropicTools,
      stream: true
    };

    const resp = await this._fetchStreamWithRetry(`${this.baseURL}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let currentToolIdx = -1;
    let stopReason = null;

    try {
    while (true) {
      const { done, value } = await this._readWithTimeout(reader);
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
            if (json.delta?.stop_reason) {
              stopReason = json.delta.stop_reason;
            }
          } else if (json.type === 'message_start' && json.message?.usage) {
            usage.prompt_tokens = json.message.usage.input_tokens || 0;
            usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
          }
        } catch (_) {}
      }
    }
    } catch (streamErr) {
      // 流式读取中断（后台切换、网络波动等）— 返回已收到的部分内容
      console.warn('[LLM Stream] Anthropic 流式读取中断:', streamErr.message);
      if (content || toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: content + (content ? '\n\n⚠️ （网络中断，回复可能不完整，可点击重试）' : '⚠️ 网络中断，请重试'),
          tool_calls: toolCalls.length > 0 ? toolCalls : null,
          model: modelName,
          usage,
          stop_reason: 'error'
        };
      }
      throw streamErr;
    }

    if (stopReason === 'max_tokens') {
      console.warn('[LLM Stream] Anthropic max_tokens 截断诊断:', {
        model: modelName,
        hasImages,
        maxTokens,
        contentLen: content.length,
        toolCallsLen: toolCalls.length,
        tools: toolCalls.map(t => ({ name: t.function.name, argsLen: t.function.arguments.length })),
        usage,
        stopReason
      });
    }

    return {
      role: 'assistant',
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : null,
      model: modelName,
      usage,
      stop_reason: stopReason
    };
  }

  // 供 ChatManager.saveDailySummary() 调用 — 生成每日真摘要（300-500字）
  // 强制保留饮食/体重/打卡/过敏/偏好/运动/图片识别结果等关键事实数据原值
  // 成功返回摘要文本字符串；失败返回空字符串 ''（由调用方判定空即降级）
  async generateDailySummary(messages, date) {
    const sysPrompt = `你是轻伴的每日对话摘要助手。请把以下当日对话压缩成 300-500 字的要点式摘要。

## 强制保留（原值，不得改写或省略）
1. **饮食记录**：食物名称、份量、估算热量（如"一碗面条 约400千卡"必须原值保留）
2. **体重数据**：体重数值及单位（如"70.5公斤"必须保留"70.5"）
3. **打卡记录**：习惯打卡的名称与数量（如"喝水0.5L""跑步30分钟"）
4. **过敏忌口**：用户陈述的过敏或忌口（如"对花生过敏"必须保留"花生""过敏"）
5. **饮食偏好**：口味/喜好/不吃的食物（如"不喜欢香菜""偏爱辣"）
6. **运动情况**：运动类型/时长/能力/限制（如"跑步30分钟""膝盖不能跳"）
7. **图片识别结果**：AI 识别出的食物种类与估算热量原值

## 可压缩
- AI 的鼓励语、解释语、建议展开、闲聊 → 仅保留与关键事实数据相关的结论性信息
- 重复的寒暄、确认语 → 省略

## 约束
- 内容仅能来自当日对话，不得编造对话中未出现的信息
- 用要点形式，按 饮食/体重/打卡/偏好/运动/其他 分类组织
- 字数严格控制在 300-500 字`;

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
        return textParts.join('').trim();
      } catch (e) {
        console.error('[SparkLLM] 每日摘要生成失败:', e.message);
        return '';
      }
    } else {
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
        return (data.choices?.[0]?.message?.content || '').trim();
      } catch (e) {
        console.error('[SparkLLM] 每日摘要生成失败:', e.message);
        return '';
      }
    }
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
