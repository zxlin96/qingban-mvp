// spark-llm.js
// 真实大模型适配器 — 双模式:
//  - APK 模式: window.QINGBAN_CONFIG 存在时,直连讯飞(Bearer key 打包,Capacitor 原生 HTTP 绕过 CORS)
//  - 开发模式: 走后端代理 /api/chat (node server.js)
// 与 MockLLM 接口一致,可直接替换。LLMService 的 Function Calling 循环无需改动。
//
// ⚠ Coding Plan 条款禁止用于自建应用后端,本适配器仅限本地测试。

export class SparkLLM {
  constructor() {
    this.callCount = 0;
    // APK 模式:直连讯飞;开发模式:走代理
    const cfg = (typeof window !== 'undefined') ? window.QINGBAN_CONFIG : null;
    this.apkMode = !!(cfg && cfg.apiKey && cfg.apiKey !== 'your-coding-plan-api-key');
    if (this.apkMode) {
      this.apiKey = cfg.apiKey;
      this.baseURL = (cfg.baseURL || 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2').replace(/\/$/, '');
      this.model = cfg.model || 'astron-code-latest';
    } else {
      this.endpoint = '/api/chat';
    }
  }

  // 统一的 HTTP 请求(双模式) — 带重试机制
  async _request(payload, retries = 30) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (this.apkMode) {
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
            // 429 限流 / 5xx 服务端错误 → 重试
            if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
              const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
              console.warn(`[LLM] ${resp.status}，${wait}ms 后重试 (${attempt + 1}/${retries})`);
              await new Promise(r => setTimeout(r, wait));
              continue;
            }
            throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
          }
          return JSON.parse(text);
        } else {
          const resp = await fetch(this.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!resp.ok) {
            let detail = '';
            try { const j = await resp.json(); detail = j.body || j.message || JSON.stringify(j); } catch (_) { try { detail = await resp.text(); } catch (__) {} }
            let msg = detail;
            try { const j = JSON.parse(detail); msg = j.error?.message || j.message || detail; } catch (_) {}
            if ((resp.status === 429 || resp.status >= 500) && attempt < retries) {
              const wait = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), 10000);
              console.warn(`[LLM] ${resp.status}，${wait}ms 后重试 (${attempt + 1}/${retries})`);
              await new Promise(r => setTimeout(r, wait));
              continue;
            }
            throw new Error(`模型请求失败 (${resp.status}): ${String(msg).slice(0, 200)}`);
          }
          return await resp.json();
        }
      } catch (e) {
        lastError = e;
        // 网络错误（Failed to fetch / 超时）→ 重试
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
        return m.content.some(c => c.type === 'image_url');
      }
      return false;
    });
  }

  // 主入口 — 供 LLMService.chat() 调用
  async chat(messages, tools, context) {
    this.callCount++;
    const payload = { messages, tools: tools || undefined };
    if (this.apkMode) {
      // 有图片用 xopkimik26，纯文本用 xopglm52
      const hasImages = this._hasImages(messages);
      payload.model = hasImages ? 'xopkimik26' : 'xopglm52';
      console.log(`[LLM] 使用模型: ${payload.model} (图片: ${hasImages ? '是' : '否'})`);
    }

    let data;
    try {
      data = await this._request(payload);
    } catch (e) {
      if (!this.apkMode && e.message.includes('Failed to fetch')) {
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
      model: payload.model || this.model || 'unknown',
      usage: {
        prompt_tokens: usage.prompt_tokens || usage.input_tokens || 0,
        completion_tokens: usage.completion_tokens || usage.output_tokens || 0,
        total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
      }
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

    const payload = { messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userContent }
    ] };
    if (this.apkMode) payload.model = 'xopglm52'; // 摘要纯文本，用轻量模型

    try {
      const data = await this._request(payload);
      return data.choices?.[0]?.message?.content || '【摘要为空】';
    } catch (e) {
      return this.apkMode ? '【摘要生成失败】' : '【摘要生成失败:后端未连接】';
    }
  }
}
