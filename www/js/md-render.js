// md-render.js — 极简 Markdown → HTML 渲染（文件查看器用，零依赖）
// 支持范围按本项目 AI 写入的记忆文件格式定制：
//   front-matter（--- updated/version ---）、标题 #~####、表格、有序/无序列表、
//   粗体/斜体/行内代码、引用、分隔线、代码块；其余按段落渲染
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mdToHtml(md) {
  if (!md || !md.trim()) return '<p class="md-empty">（文件为空）</p>';
  const inline = (s) => escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');

  let body = md;
  let meta = '';
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    const updated = (fm[1].match(/^updated:\s*(\S+)/m) || [])[1];
    const version = (fm[1].match(/^version:\s*(\S+)/m) || [])[1];
    const bits = [];
    if (updated) bits.push(`更新于 ${updated}`);
    if (version) bits.push(`v${version}`);
    meta = bits.length ? `<div class="md-meta">${bits.join(' · ')}</div>` : '';
    body = body.slice(fm[0].length);
  }

  const lines = body.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre class="md-code">${escapeHtml(buf.join('\n'))}</pre>`);
      continue;
    }
    if (/^\|.*\|/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      const head = line.split('|').slice(1, -1).map((s) => s.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i])) {
        rows.push(lines[i].split('|').slice(1, -1).map((s) => s.trim()));
        i++;
      }
      out.push('<table class="md-table"><thead><tr>' + head.map((h) => `<th>${inline(h)}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { const lv = h[1].length; out.push(`<h${lv} class="md-h${lv}">${inline(h[2])}</h${lv}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr class="md-hr">'); i++; continue; }
    if (/^>\s?/.test(line)) { out.push(`<blockquote class="md-quote">${inline(line.replace(/^>\s?/, ''))}</blockquote>`); i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^[-*]\s+/, ''))}</li>`); i++; }
      out.push(`<ul class="md-list">${items.join('')}</ul>`);
      continue;
    }
    if (/^\d+[.、]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.、]\s+/.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(/^\d+[.、]\s+/, ''))}</li>`); i++; }
      out.push(`<ol class="md-list md-ol">${items.join('')}</ol>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    out.push(`<p class="md-p">${inline(line)}</p>`);
    i++;
  }
  return meta + out.join('\n');
}
