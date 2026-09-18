// helpers.mjs — 测试公共工具（node --test 只运行 *.test.js，本文件不会被当作测试执行）

// 浏览器全局 stub：llm-service / spark-llm 顶层会读 window.QINGBAN_SETTINGS / QINGBAN_CONFIG
export function installWindowStub(config = {}, settings = {}) {
  globalThis.window = {
    QINGBAN_CONFIG: config,
    QINGBAN_SETTINGS: settings,
    dispatchEvent() {},
    addEventListener() {},
  };
  return globalThis.window;
}

// FileManager mock：内存 Map 存储
export function mockFm(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (p) => (files.has(p) ? files.get(p) : null),
    writeFile: async (p, c) => {
      files.set(p, c);
      return `已写入 ${p}（${c.length} 字）`;
    },
    appendFile: async (p, c) => {
      files.set(p, (files.get(p) || '') + c + '\n');
      return `已追加 ${p}（${c.length} 字）`;
    },
    searchFiles: async () => [],
    deleteFile: async (p) => {
      files.delete(p);
      return `Deleted ${p}`;
    },
    clearAll: async () => {
      files.clear();
    },
    listFiles: async () => [...files.entries()].map(([path, content]) => ({ path, updatedAt: '', size: content.length }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// 构造 SSE 流式 Response mock（spark-llm._streamOpenAI/_streamAnthropic 用）
export function sseResponse(lines) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(encoder.encode(l));
      c.close();
    },
  });
  return { ok: true, body: { getReader: () => stream.getReader() } };
}

// JSON Response mock（非流式请求用）
export function jsonResponse(data) {
  return { ok: true, text: async () => JSON.stringify(data) };
}
