// spark-llm.test.js — SparkLLM 格式转换与 payload 组装测试
// 回归覆盖：v3.4.7（max_tokens 传参缺失）、v3.4.2（含图片时 max_tokens 被压到 4096 导致截断）
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installWindowStub, sseResponse, jsonResponse } from './helpers.mjs';

installWindowStub(
  { apiKey: 'test-key', baseURL: 'https://api.test/v1', model: 'k3', apiFormat: 'openai', maxOutputTokens: 32768 },
  {}
);
const { SparkLLM } = await import('../js/spark-llm.js');

const TEXT_MESSAGES = [
  { role: 'system', content: '你是轻伴' },
  { role: 'user', content: '我吃了两个包子' },
];
const IMG_MESSAGES = [
  { role: 'system', content: '你是轻伴' },
  { role: 'user', content: [
    { type: 'text', text: '这是什么菜' },
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
  ] },
];

describe('格式转换（OpenAI → Anthropic）', () => {
  test('_hasImages 检测数组 content 中的图片', () => {
    const svc = new SparkLLM();
    assert.equal(svc._hasImages(TEXT_MESSAGES), false);
    assert.equal(svc._hasImages(IMG_MESSAGES), true);
  });

  test('system 提取、tool 消息转换、图片 data URL 转 base64', () => {
    const svc = new SparkLLM();
    const { system, messages } = svc._convertToAnthropicMessages([
      { role: 'system', content: 'sys-a' },
      { role: 'system', content: 'sys-b' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', tool_calls: [
        { id: 't1', type: 'function', function: { name: 'write_file', arguments: '{"path":"a.md"}' } },
      ] },
      { role: 'tool', tool_call_id: 't1', content: 'ok' },
      { role: 'user', content: [
        { type: 'text', text: '看图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,XYZ=' } },
      ] },
    ]);
    assert.equal(system, 'sys-a\n\nsys-b');
    assert.equal(messages.length, 4);
    assert.deepEqual(messages[0], { role: 'user', content: 'hello' });
    // assistant tool_calls → tool_use，arguments 字符串解析为对象
    assert.equal(messages[1].role, 'assistant');
    assert.deepEqual(messages[1].content[0], { type: 'tool_use', id: 't1', name: 'write_file', input: { path: 'a.md' } });
    // tool → user tool_result
    assert.deepEqual(messages[2].content[0], { type: 'tool_result', tool_use_id: 't1', content: 'ok' });
    // image_url → base64 image source
    assert.deepEqual(messages[3].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'XYZ=' } });
  });

  test('_convertToAnthropicTools 映射 name/description/input_schema', () => {
    const svc = new SparkLLM();
    const tools = svc._convertToAnthropicTools([
      { type: 'function', function: { name: 'read_file', description: '读文件', parameters: { type: 'object', properties: {} } } },
    ]);
    assert.deepEqual(tools, [{ name: 'read_file', description: '读文件', input_schema: { type: 'object', properties: {} } }]);
    assert.equal(svc._convertToAnthropicTools(undefined), undefined);
  });

  test('_convertFromAnthropicResponse 映射文本/工具/用量', () => {
    const svc = new SparkLLM();
    const out = svc._convertFromAnthropicResponse({
      content: [
        { type: 'text', text: '好的' },
        { type: 'tool_use', id: 'u1', name: 'checkin_habit', input: { habit_name: '喝水', amount: 0.5 } },
      ],
      usage: { input_tokens: 120, output_tokens: 30 },
    }, 'k3');
    assert.equal(out.content, '好的');
    assert.deepEqual(out.tool_calls, [{
      id: 'u1', type: 'function',
      function: { name: 'checkin_habit', arguments: '{"habit_name":"喝水","amount":0.5}' },
    }]);
    assert.deepEqual(out.usage, { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 });
  });
});

describe('payload 组装（回归：v3.4.7 max_tokens 不生效）', () => {
  beforeEach(() => {
    globalThis.__capturedFetch = undefined;
  });

  test('OpenAI 格式：payload 携带 max_tokens = 配置值', async () => {
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    };
    try {
      await svc.chat(TEXT_MESSAGES, [], {});
    } finally {
      globalThis.fetch = origFetch;
    }
    assert.equal(captured.body.max_tokens, 32768);
    assert.equal(captured.body.model, 'k3');
    assert.equal(captured.url, 'https://api.test/v1/chat/completions');
  });

  test('Anthropic 格式：无图 max_tokens = 配置值（不写死 4096 上限）', async () => {
    window.QINGBAN_CONFIG.apiFormat = 'anthropic';
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } });
    };
    try {
      const out = await svc.chat(TEXT_MESSAGES, [], {});
      assert.equal(captured.body.max_tokens, 32768);
      assert.equal(out.content, 'hi');
      assert.equal(out.usage.total_tokens, 2);
    } finally {
      globalThis.fetch = origFetch;
      window.QINGBAN_CONFIG.apiFormat = 'openai';
    }
  });

  test('Anthropic 格式：含图片时 max_tokens 同样 = 配置值（回归 v3.4.2 截断）', async () => {
    window.QINGBAN_CONFIG.apiFormat = 'anthropic';
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      captured = { body: JSON.parse(opts.body) };
      return jsonResponse({ content: [{ type: 'text', text: '红烧肉' }], usage: {} });
    };
    try {
      await svc.chat(IMG_MESSAGES, [], {});
      assert.equal(captured.body.max_tokens, 32768);
      // 图片被转为 Anthropic base64 格式；system 消息被提取到 system 字段
      assert.equal(captured.body.messages.length, 1);
      assert.equal(captured.body.messages[0].content[1].type, 'image');
      assert.equal(captured.body.system, '你是轻伴');
    } finally {
      globalThis.fetch = origFetch;
      window.QINGBAN_CONFIG.apiFormat = 'openai';
    }
  });

  test('settings.maxOutputTokens 优先于 QINGBAN_CONFIG.maxOutputTokens', async () => {
    window.QINGBAN_SETTINGS.maxOutputTokens = 16384;
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      captured = { body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: 'x' } }], usage: {} });
    };
    try {
      await svc.chat(TEXT_MESSAGES, [], {});
      assert.equal(captured.body.max_tokens, 16384);
    } finally {
      globalThis.fetch = origFetch;
      delete window.QINGBAN_SETTINGS.maxOutputTokens;
    }
  });
});

describe('流式解析 _streamOpenAI', () => {
  test('文本增量拼接、finish_reason 透传、usage 捕获', async () => {
    const svc = new SparkLLM();
    const chunks = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data:{"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n',
      'data: [DONE]\n\n',
    ]);
    try {
      const out = await svc._streamOpenAI(TEXT_MESSAGES, [], 'k3', 0.7, {}, (c) => chunks.push(c), false);
      assert.equal(out.content, '你好');
      assert.equal(out.stop_reason, 'stop');
      assert.deepEqual(out.usage, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });
      assert.deepEqual(chunks, ['你', '好']);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('工具调用参数按 index 跨 chunk 累加（回归：v2.9.4 截断场景的解析基础）', async () => {
    const svc = new SparkLLM();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"write_file","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"diet/x.md\\"}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"max_tokens"}]}\n\n',
    ]);
    try {
      const out = await svc._streamOpenAI(TEXT_MESSAGES, [], 'k3', 0.7, {}, null, false);
      assert.equal(out.stop_reason, 'max_tokens'); // llm-service 据此跳过工具执行
      assert.deepEqual(out.tool_calls[0].function, { name: 'write_file', arguments: '{"path":"diet/x.md"}' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('流式中断返回部分内容并标记 stop_reason=error（回归：v3.1.0 后台切换容错）', async () => {
    const svc = new SparkLLM();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'));
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"内容"}}]}\n\n'));
          // 异步报错：同步 error 会丢弃已入队 chunk，模拟不出"收到部分内容后中断"
          setTimeout(() => c.error(new Error('network reset')), 5);
        },
      });
      return { ok: true, body: { getReader: () => stream.getReader() } };
    };
    try {
      const out = await svc._streamOpenAI(TEXT_MESSAGES, [], 'k3', 0.7, {}, null, false);
      assert.equal(out.stop_reason, 'error');
      assert.ok(out.content.startsWith('部分内容'));
      assert.ok(out.content.includes('网络中断'));
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('recognizeImages 图片预识别（两阶段发送）', () => {
  test('Anthropic 格式：无系统提示词、极简 hint、图片转 base64、视觉模型、返回修剪文本', async () => {
    window.QINGBAN_CONFIG.apiFormat = 'anthropic';
    window.QINGBAN_SETTINGS.visionModel = 'vtest';
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      captured = { body: JSON.parse(opts.body) };
      return jsonResponse({ content: [{ type: 'text', text: '  红烧肉约500kcal  ' }], usage: {} });
    };
    try {
      const out = await svc.recognizeImages(['data:image/jpeg;base64,AAA']);
      assert.equal(out, '红烧肉约500kcal');
      assert.equal(captured.body.model, 'vtest');
      assert.equal(captured.body.max_tokens, 4096);
      assert.equal(captured.body.system, undefined, '预识别不携带系统提示词');
      assert.equal(captured.body.messages.length, 1);
      assert.ok(captured.body.messages[0].content[0].text.includes('识别'));
      assert.deepEqual(captured.body.messages[0].content[1], {
        type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' },
      });
    } finally {
      globalThis.fetch = origFetch;
      window.QINGBAN_CONFIG.apiFormat = 'openai';
      delete window.QINGBAN_SETTINGS.visionModel;
    }
  });

  test('OpenAI 直连格式：content 数组含 image_url 原样携带', async () => {
    const svc = new SparkLLM();
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => {
      captured = { body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: ' 体重秤 78.2kg ' } }], usage: {} });
    };
    try {
      const out = await svc.recognizeImages(['data:image/png;base64,XYZ']);
      assert.equal(out, '体重秤 78.2kg');
      assert.equal(captured.body.model, 'k3');
      assert.equal(captured.body.messages[0].content[1].type, 'image_url');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('开发模式走 /api/chat 代理', async () => {
    const savedKey = window.QINGBAN_CONFIG.apiKey;
    delete window.QINGBAN_CONFIG.apiKey;
    const svc = new SparkLLM();
    assert.equal(svc.apkMode, false);
    svc.endpoint = 'http://proxy.test/api/chat';
    let captured;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse({ choices: [{ message: { content: '识别结果' } }] });
    };
    try {
      const out = await svc.recognizeImages(['data:image/jpeg;base64,A']);
      assert.equal(out, '识别结果');
      assert.ok(captured.url.endsWith('/api/chat'));
      assert.equal(captured.body.max_tokens, 4096);
    } finally {
      globalThis.fetch = origFetch;
      window.QINGBAN_CONFIG.apiKey = savedKey;
    }
  });

  test('空图片列表直接返回空串（不发请求）', async () => {
    const svc = new SparkLLM();
    let called = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { called++; return jsonResponse({}); };
    try {
      assert.equal(await svc.recognizeImages([]), '');
      assert.equal(await svc.recognizeImages([null, '']), '');
      assert.equal(called, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('请求失败抛错（调用方据此回退原图直发）', async () => {
    const svc = new SparkLLM();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => 'bad request' });
    try {
      await assert.rejects(() => svc.recognizeImages(['data:image/jpeg;base64,A']), /400/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// v3.20.3 — 图片识别辅助上下文：携带用户随图发送的文字
describe('SparkLLM.buildRecognitionContext', () => {
  test('用户附言放在最前', () => {
    const ctx = SparkLLM.buildRecognitionContext({
      userText: '帮我看这杯的配料表',
      foodTypesMd: '## 主食\n- 包子',
      historyLines: ['用户: 早上好', 'AI: 早']
    });
    assert.ok(ctx.startsWith('【用户附言（随图发送，识别时请结合）】\n帮我看这杯的配料表'), ctx);
    const iNote = ctx.indexOf('用户附言');
    const iFood = ctx.indexOf('食物种类清单');
    const iHist = ctx.indexOf('今日对话记录');
    assert.ok(iNote < iFood && iFood < iHist, '三段顺序应为 附言→清单→对话');
  });

  test('空段跳过、全空返回空串（零上下文识别）', () => {
    assert.equal(SparkLLM.buildRecognitionContext({}), '');
    assert.equal(SparkLLM.buildRecognitionContext({ userText: '  ' }), '');
    const only = SparkLLM.buildRecognitionContext({ userText: '', foodTypesMd: '## 主食\n- 米饭' });
    assert.ok(only.startsWith('【用户食物种类清单'));
    assert.ok(!only.includes('用户附言') && !only.includes('今日对话记录'));
  });

  test('随图文字为空白/无文字时不产生空附言段', () => {
    // 纯图片发送（无文字）——上下文不应出现空附言头
    const ctx = SparkLLM.buildRecognitionContext({ userText: '', historyLines: ['用户: 昨天吃了火锅'] });
    assert.equal(ctx, '【今日对话记录】\n用户: 昨天吃了火锅');
  });
});
