// server.js — 轻伴 MVP 本地后端代理 + 静态文件服务
// 转发请求到讯飞星辰 Coding Plan (OpenAI 兼容协议)
//
// ⚠ 合规提醒:讯飞 Coding Plan 条款 (4.2.3 节) 明确禁止将 API Key 用于
//   自建应用后端。本服务仅作本地功能演示,请勿上线或批量调用。
//   文档: https://www.xfyun.cn/doc/spark/CodingPlan.html

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 加载 .env (Node 20.6+ 原生支持)
try { process.loadEnvFile(); } catch (_) { /* .env 不存在时忽略 */ }

const PORT = process.env.PORT || 3000;
const XF_API_KEY = process.env.XF_API_KEY;
const XF_BASE_URL = (process.env.XF_BASE_URL || 'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2').replace(/\/$/, '');
const XF_MODEL = process.env.XF_MODEL || 'astron-code-latest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!XF_API_KEY || XF_API_KEY === 'your-coding-plan-api-key') {
  console.error('\n[✗] 未配置 XF_API_KEY');
  console.error('    请编辑 .env,填入你的 Coding Plan API Key');
  console.error('    获取地址: https://maas.xfyun.cn/packageSubscription\n');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

// 读取请求体
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// 清理 messages,只保留 OpenAI 标准字段,避免讯飞拒绝非标准字段(如 _pendingAction)
function cleanMessages(messages) {
  return (messages || []).map(m => {
    const clean = { role: m.role };
    if (m.content !== undefined && m.content !== null) clean.content = m.content;
    if (m.tool_calls) clean.tool_calls = m.tool_calls;
    if (m.tool_call_id) clean.tool_call_id = m.tool_call_id;
    if (m.name) clean.name = m.name;
    return clean;
  });
}

// 静态文件服务
function serveStatic(req, res) {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const filePath = path.join(__dirname, url);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + url);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // 健康检查 — 前端用来探测后端是否在线
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, model: XF_MODEL, hasKey: !!XF_API_KEY }));
    return;
  }

  // 聊天代理
  if (req.url === '/api/chat' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const payload = JSON.parse(raw);
      payload.model = XF_MODEL;
      payload.messages = cleanMessages(payload.messages);
      payload.stream = false;
      if (payload.tools && payload.tools.length === 0) delete payload.tools;

      const upstream = await fetch(`${XF_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${XF_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: true, status: upstream.status, body: text }));
        console.error(`[讯飞 ${upstream.status}] ${text.slice(0, 400)}`);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
      console.log(`[OK ${new Date().toLocaleTimeString('zh-CN')}] msgs=${payload.messages.length} tools=${payload.tools?.length || 0}`);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: true, message: '代理请求失败: ' + e.message }));
      console.error('[代理错误]', e.message);
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('\n  ┌──────────────────────────────────────────────┐');
  console.log('  │  轻伴 MVP · 已启动                            │');
  console.log(`  │  地址: http://localhost:${PORT}                │`);
  console.log(`  │  模型: ${XF_MODEL.padEnd(36)}│`);
  console.log('  │  ⚠ 仅限本地测试, Coding Plan 禁止用于自建应用  │');
  console.log('  └──────────────────────────────────────────────┘\n');
});
