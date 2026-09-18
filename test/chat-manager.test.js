// chat-manager.test.js — ChatManager 单元测试（含历史 Bug 回归：UTC 时区、跨天日期推进）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ChatManager } from '../js/chat-manager.js';
import { mockFm } from './helpers.mjs';

function newCM(initialFiles = {}) {
  const fm = mockFm(initialFiles);
  return { fm, cm: new ChatManager(fm) };
}

describe('ChatManager._getToday 本地时区（回归：2026-07-08 UTC 差一天 Bug）', () => {
  test('返回本地时区的今天，格式 YYYY-MM-DD', () => {
    const { cm } = newCM();
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    assert.equal(cm._getToday(), expected);
    assert.match(cm._getToday(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ChatManager.getEffectiveToday（回归：凌晨 0-4 点熬夜不跨天）', () => {
  test('凌晨 0-3 点视为前一天', () => {
    const { cm } = newCM();
    for (const h of [0, 1, 2, 3]) {
      const now = new Date(2026, 8, 18, h, 30); // 2026-09-18 凌晨
      assert.equal(cm.getEffectiveToday(now), '2026-09-17', `hour=${h}`);
    }
  });

  test('凌晨 4 点起算当天', () => {
    const { cm } = newCM();
    for (const h of [4, 8, 13, 23]) {
      const now = new Date(2026, 8, 18, h, 0);
      assert.equal(cm.getEffectiveToday(now), '2026-09-18', `hour=${h}`);
    }
  });

  test('月初凌晨回退到上个月最后一天', () => {
    const { cm } = newCM();
    const now = new Date(2026, 8, 1, 2, 0); // 2026-09-01 02:00 → 前一天 08-31
    assert.equal(cm.getEffectiveToday(now), '2026-08-31');
  });

  test('1月1日凌晨回退到上一年', () => {
    const { cm } = newCM();
    const now = new Date(2027, 0, 1, 1, 0); // 2027-01-01 01:00 → 2026-12-31
    assert.equal(cm.getEffectiveToday(now), '2026-12-31');
  });

  test('不传 now 时与 _getToday 在白天时段一致', () => {
    const { cm } = newCM();
    if (new Date().getHours() >= 4) {
      assert.equal(cm.getEffectiveToday(), cm._getToday());
    }
  });
});

describe('getHistory / 图片消息格式', () => {
  test('getHistory 剥离 _displayPhotos 等下划线字段', () => {
    const { cm } = newCM();
    cm.addUserMessage('今天吃了包子');
    cm.addUserPhotoMessage('看看这个', ['data:image/jpeg;base64,AAA']);
    cm.addAssistantMessage('这是红烧肉');
    const h = cm.getHistory();
    assert.deepEqual(h, [
      { role: 'user', content: '今天吃了包子' },
      { role: 'user', content: '看看这个' },
      { role: 'assistant', content: '这是红烧肉' },
    ]);
  });

  test('replaceLastPhotoMessage 将旧 image_url 格式转为纯文本 + _displayPhotos（回归：多模态切换）', () => {
    const { cm } = newCM();
    cm.history.push({
      role: 'user',
      content: [
        { type: 'text', text: '这是什么菜' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,IMGDATA' } },
      ],
    });
    const replaced = cm.replaceLastPhotoMessage('红烧肉，约500千卡');
    assert.equal(replaced, true);
    assert.equal(cm.history[0].content, '这是什么菜\n[图片已识别，AI分析: 红烧肉，约500千卡]');
    assert.deepEqual(cm.history[0]._displayPhotos, ['data:image/jpeg;base64,IMGDATA']);
    assert.equal(cm.replaceLastPhotoMessage('x'), false); // 无旧格式消息时不动
  });
});

describe('每日摘要 saveDailySummary', () => {
  test('空历史不写摘要', async () => {
    const { fm, cm } = newCM();
    await cm.saveDailySummary(undefined);
    assert.equal(fm.files.size, 0);
  });

  test('LLM 不可用时降级全文拼接，写入 chat/日期.md 并更新 INDEX.md', async () => {
    const { fm, cm } = newCM();
    cm.currentDate = '2026-09-18';
    cm.addUserMessage('午餐吃了牛肉面');
    cm.addAssistantMessage('牛肉面约450千卡，记得晚餐少吃点主食');
    await cm.saveDailySummary(undefined);

    const content = fm.files.get('chat/2026-09-18.md');
    assert.ok(content.startsWith('---\ndate: 2026-09-18\n---'));
    assert.ok(content.includes('# 2026-09-18 对话摘要'));
    assert.ok(content.includes('## 用户\n午餐吃了牛肉面'));
    assert.ok(content.includes('## 轻伴\n牛肉面约450千卡'));
    const index = fm.files.get('INDEX.md');
    assert.ok(index.includes('- chat/2026-09-18.md — 2条对话'));
  });

  test('LLM 可用时生成真摘要；占位符输出视为失败并降级', async () => {
    const { fm, cm } = newCM();
    cm.currentDate = '2026-09-18';
    cm.addUserMessage('体重80公斤');

    const goodLLM = { llm: { generateDailySummary: async () => '· 体重记录：80公斤\n· 饮食：暂无' } };
    await cm.saveDailySummary(goodLLM);
    assert.ok(fm.files.get('chat/2026-09-18.md').includes('80公斤'));

    const badLLM = { llm: { generateDailySummary: async () => '【摘要生成失败】' } };
    await cm.saveDailySummary(badLLM);
    const content = fm.files.get('chat/2026-09-18.md');
    assert.ok(content.includes('## 用户\n体重80公斤'), '应降级为全文拼接');
  });

  test('超 500 字摘要在句子边界截断', async () => {
    const { cm } = newCM();
    const long = '这是一个要点。'.repeat(100); // 700 字，含句号边界
    const truncated = cm._truncateSummary(long, 500);
    assert.ok(truncated.length <= 502);
    assert.ok(truncated.endsWith('…'));
  });
});

describe('上下文压缩 compactHistory', () => {
  test('低于阈值不压缩', async () => {
    const { cm } = newCM();
    cm.addUserMessage('hi');
    const r = await cm.compactHistory(null);
    assert.deepEqual(r, { compacted: false, reason: 'below_threshold' });
  });

  test('超过阈值：保留最近 4 条，旧消息替换为系统摘要', async () => {
    const { cm } = newCM();
    for (let i = 0; i < 10; i++) {
      cm.addUserMessage(`消息${i}，内容足够长一些用来估算token`);
      cm.addAssistantMessage(`回复${i}`);
    }
    const r = await cm.compactHistory({ llm: {} }); // 无 generateSummary → 降级
    assert.equal(r.compacted, true);
    assert.equal(cm.history.length, 1 + cm.keepRecentRounds);
    assert.equal(cm.history[0].role, 'system');
    assert.ok(cm.history[0].content.includes('[之前的对话已压缩]'));
    assert.ok(cm.history[0].content.includes('消息0')); // 降级摘要截取前 60 字
  });
});

describe('跨天推进 advanceDay', () => {
  test('日期 +1、清空历史、写摘要', async () => {
    const { fm, cm } = newCM();
    cm.currentDate = '2026-09-17';
    cm.addUserMessage('早餐吃了鸡蛋');
    cm.addAssistantMessage('好的，已记录');
    const next = await cm.advanceDay(null, null);
    assert.equal(next, '2026-09-18');
    assert.equal(cm.currentDate, '2026-09-18');
    assert.equal(cm.history.length, 0);
    assert.ok(fm.files.get('chat/2026-09-17.md'));
    assert.equal(fm.files.get('.meta/chat-history.json'), '');
  });

  test('跨月正确推进（9-30 → 10-01）', async () => {
    const { cm } = newCM();
    cm.currentDate = '2026-09-30';
    const next = await cm.advanceDay(null, null);
    assert.equal(next, '2026-10-01');
  });

  test('传入 profileLearner 时刷新习惯档案，失败不中断跨天', async () => {
    const { cm } = newCM();
    cm.currentDate = '2026-09-17';
    let called = 0;
    const okLearner = { refreshHabits: async (days) => { called++; return { learned: true, summary: `${days}天` }; } };
    await cm.advanceDay(okLearner, null);
    assert.equal(called, 1);
    assert.deepEqual(cm._lastLearnResult, { learned: true, summary: '21天' });

    const badLearner = { refreshHabits: async () => { throw new Error('超时'); } };
    await cm.advanceDay(badLearner, null);
    assert.equal(cm.currentDate, '2026-09-19'); // 失败仍推进
    assert.ok(cm._lastLearnResult.summary.includes('超时'));
  });
});

describe('token 用量记录', () => {
  test('按日重置并累计', async () => {
    const { fm, cm } = newCM();
    cm.tokenUsage.today.date = '2026-01-01';
    await cm.recordTokenUsage({ prompt_tokens: 100, completion_tokens: 50 });
    assert.equal(cm.tokenUsage.today.input, 100);
    assert.equal(cm.tokenUsage.today.calls, 1);
    assert.equal(cm.tokenUsage.total.input, 100);
    await cm.recordTokenUsage({ prompt_tokens: 10, completion_tokens: 0 });
    assert.equal(cm.tokenUsage.today.input, 110);
    assert.equal(cm.getTokenUsageInfo().todayCalls, 2);
    assert.ok(fm.files.get('.meta/token-usage.json'));
  });
});
