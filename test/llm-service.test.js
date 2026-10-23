// llm-service.test.js — LLMService 测试（KV 缓存失效、响应缓存、图片剥离、工具执行）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installWindowStub, mockFm } from './helpers.mjs';

installWindowStub({}, {});
const { LLMService } = await import('../js/llm-service.js');

const LOADER_STUB = { loadForChat: async () => ({ strategy: 'no_match', indexSummaryLines: [] }) };

function newSvc(fmInitial = {}) {
  const fm = mockFm(fmInitial);
  return { fm, svc: new LLMService(fm, {}, LOADER_STUB) };
}

const toolCall = (name, args, id = 't1') => ({
  id,
  function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

describe('固定前缀缓存失效（回归：v3.3.0 KV Cache）', () => {
  test('write_file 修改固定文件时失效缓存，普通文件不失效', async () => {
    const { fm, svc } = newSvc();
    svc._cachedPrefix = 'P';
    svc._prefixCacheValid = true;

    await svc.executeTool(toolCall('write_file', { path: 'diet/2026-09-18.md', content: '午餐 500千卡' }, 'w1'));
    assert.equal(svc._prefixCacheValid, true, 'diet 文件不应失效前缀缓存');

    // v3.11.0 起 PROFILE.md 移出固定前缀（动态注入），写入不再失效缓存
    await svc.executeTool(toolCall('write_file', { path: 'PROFILE.md', content: '男，30岁' }, 'w2'));
    assert.equal(svc._prefixCacheValid, true, 'PROFILE.md 已是动态注入，不应失效前缀缓存');

    await svc.executeTool(toolCall('write_file', { path: 'rules/learned-habits.md', content: '习惯' }, 'w3'));
    assert.equal(svc._prefixCacheValid, false, '固定文件（rules/）必须失效前缀缓存');
    assert.equal(svc._cachedPrefix, null);
    assert.ok(fm.files.get('rules/learned-habits.md') === '习惯');
  });

  test('append_file 同样触发失效', async () => {
    const { svc } = newSvc({ 'rules/allergies.md': '花生' });
    svc._cachedPrefix = 'P';
    svc._prefixCacheValid = true;
    await svc.executeTool(toolCall('append_file', { path: 'rules/allergies.md', content: '\n虾' }, 'a1'));
    assert.equal(svc._prefixCacheValid, false);
  });

  test('_getFixedPrefix 缓存命中后不再读 IndexedDB', async () => {
    const { fm, svc } = newSvc({ 'CLAUDE.md': 'CLAUDE', 'PROFILE.md': '档案' });
    const p1 = await svc._getFixedPrefix();
    assert.ok(p1.startsWith('CLAUDE'));
    fm.files.set('CLAUDE.md', '改过的内容');
    const p2 = await svc._getFixedPrefix();
    assert.equal(p2, p1, '缓存有效期内不应重读');
    svc._invalidatePrefixCache('CLAUDE.md');
    const p3 = await svc._getFixedPrefix();
    assert.ok(p3.startsWith('改过的内容'));
  });

  test('write_file 修改 rules/food-types.md 失效缓存（v3.14.0 食物种类记忆）', async () => {
    const { fm, svc } = newSvc({ 'rules/food-types.md': '# 食物种类' });
    svc._cachedPrefix = 'P';
    svc._prefixCacheValid = true;
    await svc.executeTool(toolCall('write_file', { path: 'rules/food-types.md', content: '# 食物种类\n- 包子' }, 'w4'));
    assert.equal(svc._prefixCacheValid, false, 'food-types.md 是固定注入文件，写入必须失效前缀缓存');
    assert.ok(fm.files.get('rules/food-types.md').includes('包子'));
  });

  test('_buildFixedPrefix 注入食物种类段', async () => {
    const { svc } = newSvc({ 'CLAUDE.md': 'CLAUDE', 'rules/food-types.md': '# 食物种类\n- 包子（早餐常吃）' });
    const prefix = await svc._buildFixedPrefix();
    assert.ok(prefix.includes('# 食物种类（固定注入）'));
    assert.ok(prefix.includes('包子'), '食物种类内容必须进入固定前缀');
  });
});

describe('响应缓存（LRU + TTL）', () => {
  test('写入后命中，TTL 过期后失效', async () => {
    const { svc } = newSvc();
    const key = svc._computeResponseCacheKey('你好', []);
    svc._setResponseCache(key, { content: '你好呀' });
    assert.equal(svc._getResponseFromCache(key).content, '你好呀');

    svc._responseCacheTTL = 1;
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(svc._getResponseFromCache(key), null);
  });

  test('LRU 容量 10，最旧的被淘汰', () => {
    const { svc } = newSvc();
    for (let i = 0; i < 11; i++) {
      svc._setResponseCache(`k${i}`, { content: `r${i}` });
    }
    assert.equal(svc._getResponseFromCache('k0'), null, '最早写入的 k0 应被淘汰');
    assert.equal(svc._getResponseFromCache('k10').content, 'r10');
    assert.equal(svc._responseCache.size, 10);
  });

  test('缓存 key 只取最近 8 条历史，且消息内容截断 200 字', () => {
    const { svc } = newSvc();
    const history = Array.from({ length: 12 }, (_, i) => ({ role: 'user', content: `m${i}` }));
    const k1 = svc._computeResponseCacheKey('提问', history);
    const k2 = svc._computeResponseCacheKey('提问', history.slice(-8));
    assert.equal(k1, k2, '超过 8 条的旧历史不参与 key');

    const k3 = svc._computeResponseCacheKey('x'.repeat(600) + 'A', []);
    const k4 = svc._computeResponseCacheKey('x'.repeat(600) + 'B', []);
    assert.equal(k3, k4, '用户消息仅取前 500 字，之后的内容不影响 key');
  });
});

describe('_stripHistoryImages 历史图片剥离', () => {
  test('仅保留最后一条用户消息的图片', () => {
    const { svc } = newSvc();
    const img = (d) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${d}` } });
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [img('OLD'), { type: 'text', text: '上一张' }] },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: [img('NEW'), { type: 'text', text: '这张呢' }] },
    ];
    const out = svc._stripHistoryImages(messages);
    assert.equal(out[1].content[0].text, '[历史图片已省略，其内容已写入长期记忆文件]');
    assert.equal(out[1].content[1].text, '上一张');
    assert.equal(out[3].content[0].image_url.url, 'data:image/jpeg;base64,NEW', '最后一条用户消息的图片保留');
    assert.equal(out[3].content[1].text, '这张呢');
  });
});

describe('executeTool 工具执行', () => {
  test('read_file 未找到时返回错误提示', async () => {
    const { svc } = newSvc();
    const r = await svc.executeTool(toolCall('read_file', { path: 'diet/2099-01-01.md' }, 'r1'));
    assert.equal(r.role, 'tool');
    assert.equal(r.content, 'Error: file not found: diet/2099-01-01.md');
    assert.equal(r.tool_call_id, 'r1');
  });

  test('参数 JSON 解析失败时返回可重试错误（回归：v2.9.4 截断场景）', async () => {
    const { svc } = newSvc();
    const r = await svc.executeTool({ id: 'bad', function: { name: 'write_file', arguments: '{"path":"a.md", "cont' } });
    assert.ok(r.content.startsWith('Error: 参数 JSON 解析失败'));
    assert.equal(svc.toolCallLog[0].resultPreview, '参数 JSON 解析失败');
  });

  test('未知工具返回错误', async () => {
    const { svc } = newSvc();
    const r = await svc.executeTool(toolCall('no_such_tool', {}, 'u1'));
    assert.equal(r.content, 'Error: unknown tool: no_such_tool');
  });

  test('ask_user 走回调', async () => {
    const { svc } = newSvc();
    svc.onAskUser = async (q, opts) => `用户选了:${q}|${opts[0]}`;
    const r = await svc.executeTool(toolCall('ask_user', { question: '吃了吗', options: ['吃了', '没吃'] }, 'ak1'));
    assert.equal(r.content, '用户选了:吃了吗|吃了');
  });
});

describe('chat() 主流程（Function Calling 循环 + 响应缓存）', () => {
  function makeLLM(responses) {
    const calls = [];
    return {
      calls,
      chat: async (messages) => {
        calls.push(messages);
        return responses[(calls.length - 1) % responses.length];
      },
    };
  }

  test('工具调用循环：执行工具 → 二轮返回最终回复', async () => {
    const { fm, svc } = newSvc({ 'diet/2026-09-18.md': '' });
    const llm = makeLLM([
      { content: '', tool_calls: [toolCall('write_file', { path: 'diet/2026-09-18.md', content: '午餐' }, 'c1')], model: 'k3', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      { content: '已记录午餐', tool_calls: null, model: 'k3', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]);
    svc.llm = llm;
    const out = await svc.chat('午餐吃了一碗面', [], { currentDate: '2026-09-18' });
    assert.equal(out.content, '已记录午餐');
    assert.equal(out.toolCalls.length, 1);
    assert.equal(llm.calls.length, 2);
    // 第二轮请求包含工具结果消息
    const toolMsg = llm.calls[1].find((m) => m.role === 'tool');
    assert.ok(toolMsg, '第二轮请求应包含 tool 结果');
    assert.ok(fm.files.get('diet/2026-09-18.md') === '午餐');
  });

  test('纯文本回复写入响应缓存，相同请求不再调 LLM', async () => {
    const { svc } = newSvc();
    const llm = makeLLM([{ content: '你好呀', tool_calls: null, model: 'k3', usage: {} }]);
    svc.llm = llm;

    const r1 = await svc.chat('你好', [], {});
    assert.equal(r1.content, '你好呀');
    const r2 = await svc.chat('你好', [], {});
    assert.equal(r2.content, '你好呀');
    assert.equal(llm.calls.length, 1, '第二次应命中缓存');
  });

  test('带工具调用的回复不写缓存', async () => {
    const { fm, svc } = newSvc();
    const llm = makeLLM([
      { content: '', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c1')], model: 'k3', usage: {} },
      { content: '档案如下', tool_calls: null, model: 'k3', usage: {} },
    ]);
    svc.llm = llm;
    await svc.chat('我的档案', [], {});
    await svc.chat('我的档案', [], {});
    assert.equal(llm.calls.length, 4, '带工具调用的对话不应命中缓存');
  });

  test('系统提示词包含固定前缀与动态时间，且固定前缀在前（KV Cache 结构约束）', async () => {
    const { svc } = newSvc({ 'CLAUDE.md': '固定开头CLAUDE' });
    const llm = makeLLM([{ content: 'ok', tool_calls: null, model: 'k3', usage: {} }]);
    svc.llm = llm;
    await svc.chat('hi', [], {});
    const sys = llm.calls[0][0];
    assert.equal(sys.role, 'system');
    assert.ok(sys.content.startsWith('固定开头CLAUDE'), '固定内容必须在提示词最前');
    assert.ok(sys.content.includes('# 当前时间'));
    assert.ok(sys.content.includes('# 今日打卡状态'));
  });
});
describe('工具调用轮次耗尽 — 保留已生成内容（回归：v3.13.3）', () => {
  function makeLLM(responses) {
    const calls = [];
    return {
      calls,
      chat: async (messages) => {
        calls.push(messages);
        return responses[(calls.length - 1) % responses.length];
      },
    };
  }

  test('chat() 达到上限时返回累积内容而非丢弃', async () => {
    const { svc } = newSvc({ 'PROFILE.md': '档案' });
    svc.maxToolRounds = 3;
    const llm = makeLLM([
      { content: '第一轮内容', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c1')], model: 'k3', usage: {} },
      { content: '第二轮内容', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c2')], model: 'k3', usage: {} },
      { content: '第三轮内容', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c3')], model: 'k3', usage: {} },
    ]);
    svc.llm = llm;
    const out = await svc.chat('测试', [], {});
    assert.ok(out.content.includes('第一轮内容'), '应保留第一轮已生成内容');
    assert.ok(out.content.includes('第二轮内容'), '应保留第二轮已生成内容');
    assert.ok(out.content.includes('第三轮内容'), '应保留第三轮已生成内容');
    assert.ok(out.content.includes('已处理 3 轮工具调用但未完成'), '文案应准确描述轮次耗尽而非误导性"处理超时"');
    assert.equal(out.model, 'k3');
  });

  test('chat() 达到上限且无内容时返回准确提示', async () => {
    const { svc } = newSvc({ 'PROFILE.md': '档案' });
    svc.maxToolRounds = 2;
    const llm = makeLLM([
      { content: '', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c1')], model: 'k3', usage: {} },
      { content: '', tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, 'c2')], model: 'k3', usage: {} },
    ]);
    svc.llm = llm;
    const out = await svc.chat('测试', [], {});
    assert.ok(out.content.includes('已处理 2 轮工具调用但未完成'), '无内容时应返回准确提示');
    assert.ok(!out.content.includes('处理超时'), '不应再使用误导性"处理超时"文案');
  });

  test('chatStream() 达到上限时返回累积流式内容而非丢弃', async () => {
    const { svc } = newSvc({ 'PROFILE.md': '档案' });
    svc.maxToolRounds = 2;
    const calls = [];
    svc.llm = {
      chatStream: async (messages, tools, context, onChunk) => {
        const idx = calls.length;
        calls.push(messages);
        const text = `流式第${idx + 1}轮`;
        if (onChunk) onChunk(text, text);
        return {
          content: text,
          tool_calls: [toolCall('read_file', { path: 'PROFILE.md' }, `c${idx + 1}`)],
          model: 'k3',
          usage: {},
          stop_reason: 'tool_calls',
        };
      },
    };
    const out = await svc.chatStream('测试', [], {}, () => {});
    assert.ok(out.content.includes('流式第1轮'), '应保留第一轮流式内容');
    assert.ok(out.content.includes('流式第2轮'), '应保留第二轮流式内容');
    assert.ok(out.content.includes('已处理 2 轮工具调用但未完成'), '文案应准确描述轮次耗尽');
    assert.equal(out.model, 'k3');
  });
});
