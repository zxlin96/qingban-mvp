// profile-learner.test.js — 21 天分析降频策略（v3.12.0）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mockFm } from './helpers.mjs';
import { ProfileLearner } from '../js/profile-learner.js';

function newPL(files = {}) {
  const fm = mockFm(files);
  return { fm, pl: new ProfileLearner(fm, {}, null) };
}

describe('21 天分析降频（shouldSkipRefresh）', () => {
  test('无状态（首次运行）→ 不跳过', async () => {
    const { pl } = newPL();
    assert.deepEqual(await pl.shouldSkipRefresh('2026-09-27'), { skip: false, reason: 'first_run' });
  });

  test('距上次刷新不足 2 天 → 跳过（即使有新摘要）', async () => {
    const { pl } = newPL({
      '.meta/habits-refresh.json': JSON.stringify({ lastRefreshDate: '2026-09-26' }),
      'chat/2026-09-27.md': '摘要',
    });
    const r = await pl.shouldSkipRefresh('2026-09-27');
    assert.equal(r.skip, true);
    assert.ok(r.reason.includes('1 天'));
  });

  test('隔天且有新对话摘要 → 不跳过（该跑）', async () => {
    const { pl } = newPL({
      '.meta/habits-refresh.json': JSON.stringify({ lastRefreshDate: '2026-09-25' }),
      'chat/2026-09-26.md': '摘要',
      'chat/2026-09-27.md': '摘要',
    });
    assert.deepEqual(await pl.shouldSkipRefresh('2026-09-27'), { skip: false, reason: 'ok' });
  });

  test('隔天但期间无新摘要 → 跳过（不烧无用 API）', async () => {
    const { pl } = newPL({
      '.meta/habits-refresh.json': JSON.stringify({ lastRefreshDate: '2026-09-25' }),
      'chat/2026-09-24.md': '旧摘要',
    });
    const r = await pl.shouldSkipRefresh('2026-09-27');
    assert.equal(r.skip, true);
    assert.ok(r.reason.includes('无新'));
  });

  test('状态文件损坏 → 不跳过（宁可多跑不漏跑）', async () => {
    const { pl } = newPL({ '.meta/habits-refresh.json': '{broken json' });
    assert.equal((await pl.shouldSkipRefresh('2026-09-27')).skip, false);
  });

  test('markRefreshed 记录状态，决定下一次是否跳过', async () => {
    const { fm, pl } = newPL();
    await pl.markRefreshed('2026-09-27');
    const state = JSON.parse(fm.files.get('.meta/habits-refresh.json'));
    assert.equal(state.lastRefreshDate, '2026-09-27');
    assert.ok((await pl.shouldSkipRefresh('2026-09-27')).skip, '同日再结算 → 跳过');
    assert.equal((await pl.shouldSkipRefresh('2026-09-29')).skip, true, '次日无新摘要 → 跳过');
    fm.files.set('chat/2026-09-29.md', '新摘要');
    assert.equal((await pl.shouldSkipRefresh('2026-09-29')).skip, false, '次日有新摘要 → 该跑');
  });
});
