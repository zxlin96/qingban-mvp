// server.test.js — 后端 cleanMessages 测试（回归：讯飞拒绝非标准字段 _pendingAction）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessages } from '../server.js';

describe('cleanMessages 字段剥离', () => {
  test('剥离 _pendingAction/_displayPhotos 等非标准字段，保留标准字段', () => {
    const out = cleanMessages([
      {
        role: 'assistant',
        content: '记录中',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{}' } }],
        _pendingAction: { foo: 1 },
      },
      { role: 'tool', tool_call_id: 'c1', name: 'write_file', content: 'ok', _internal: 'x' },
      { role: 'user', content: '你好', _displayPhotos: ['data:image/jpeg;base64,AAA'] },
    ]);
    assert.deepEqual(out, [
      {
        role: 'assistant',
        content: '记录中',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', name: 'write_file', content: 'ok' },
      { role: 'user', content: '你好' },
    ]);
  });

  test('content 为 null/undefined 时不携带该字段；空入参返回空数组', () => {
    assert.deepEqual(cleanMessages([{ role: 'assistant', content: null }]), [{ role: 'assistant' }]);
    assert.deepEqual(cleanMessages([{ role: 'assistant' }]), [{ role: 'assistant' }]);
    assert.deepEqual(cleanMessages(undefined), []);
    assert.deepEqual(cleanMessages(null), []);
  });
});
