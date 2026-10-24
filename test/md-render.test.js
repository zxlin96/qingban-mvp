// md-render.test.js — mdToHtml 渲染测试（v3.17.0 文件查看器 Markdown 渲染）
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mdToHtml, escapeHtml } from '../js/md-render.js';

describe('mdToHtml 基础渲染', () => {
  test('front-matter → meta 徽标；标题/列表/粗体/表格渲染', () => {
    const html = mdToHtml(`---
updated: 2026-10-24
version: 3
---

# 用户档案

## 基础信息
- 性别: 男
- **目标**: 72kg

| 日期 | 体重 |
|------|------|
| 09-20 | 80.2 |
`);
    assert.ok(html.includes('md-meta'), 'front-matter 提取为徽标');
    assert.ok(html.includes('更新于 2026-10-24 · v3'), '徽标含更新日期与版本');
    assert.ok(html.includes('<h1 class="md-h1">用户档案</h1>'));
    assert.ok(html.includes('<h2 class="md-h2">基础信息</h2>'));
    assert.ok(html.includes('<li>性别: 男</li>'), '无序列表');
    assert.ok(html.includes('<strong>目标</strong>'), '粗体');
    assert.ok(html.includes('<th>日期</th>') && html.includes('<td>80.2</td>'), '表格');
  });

  test('HTML 转义防注入、行内代码、引用、空文件', () => {
    assert.ok(mdToHtml('# <script>x</script>').includes('&lt;script&gt;'), '正文 HTML 转义');
    assert.ok(mdToHtml('用 `read_file` 读').includes('<code>read_file</code>'), '行内代码');
    assert.ok(mdToHtml('> 提示文字').includes('md-quote'), '引用块');
    assert.ok(mdToHtml('').includes('md-empty'), '空文件占位');
    assert.ok(mdToHtml(null).includes('md-empty'), 'null 容错');
    assert.equal(escapeHtml('<b>&'), '&lt;b&gt;&amp;', 'escapeHtml 独立导出');
  });
});
