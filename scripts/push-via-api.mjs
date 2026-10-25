// push-via-api.mjs — github.com 直连不通时的备用推送通道（qingban-release skill）
// 通过 api.github.com 的 Git Data API 逐提交复刻本地提交（blob 原样 base64、
// author/committer/message 取本地原值），SHA 与本地一致时远端即等同已 push。
import { execSync } from 'node:child_process';

const TOKEN = process.env.GH_TOKEN;
if (!TOKEN) { console.error('缺少 GH_TOKEN'); process.exit(1); }
const REPO = process.env.REPO || 'zxlin96/qingban-mvp';

const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'User-Agent': 'qingban-push-helper',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {})
    }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${r.status}: ${JSON.stringify(j).slice(0, 400)}`);
  return j;
};

const git = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.env.SHELL || 'bash' });
const gitBuf = (cmd) => execSync(cmd, { maxBuffer: 64 * 1024 * 1024, shell: process.env.SHELL || 'bash' });

// 1. 远端 master 必须与本地 origin/master 一致（否则远端有新提交，先人工对账）
const remote = await api(`/repos/${REPO}/git/ref/heads/master`);
const localRemoteRef = git('git rev-parse refs/remotes/origin/master').trim();
console.log(`远端 master: ${remote.object.sha}`);
console.log(`本地 origin/master: ${localRemoteRef}`);
if (remote.object.sha !== localRemoteRef) {
  throw new Error('远端 master 与本地记录不一致，需先对账（fetch 或人工确认）');
}

// 2. 待推送提交（旧→新）
const commits = git(`git rev-list --reverse ${localRemoteRef}..HEAD`).trim().split('\n').filter(Boolean);
if (commits.length === 0) { console.log('没有待推送提交'); process.exit(0); }
console.log(`待推送 ${commits.length} 个提交: ${commits.join(', ')}`);

let parent = remote.object.sha;
const results = [];

for (const c of commits) {
  // 该提交相对父提交的变更（:oldMode newMode oldSha newSha status \t path）
  const lines = git(`git diff-tree -r --no-commit-id ${c}`).trim().split('\n').filter(Boolean);
  const entries = [];
  for (const line of lines) {
    const [meta, ...rest] = line.split('\t');
    const path = rest.join('\t');
    const parts = meta.replace(/^:/, '').split(/\s+/);
    const oldMode = parts[0], newMode = parts[1], oldSha = parts[2], newSha = parts[3];
    const status = parts[4];
    if (status === 'D') {
      entries.push({ path, mode: oldMode, type: 'blob', sha: null });
      continue;
    }
    const content = gitBuf(`git cat-file blob ${newSha}`);
    const blob = await api(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' })
    });
    entries.push({ path, mode: newMode, type: 'blob', sha: blob.sha });
  }
  console.log(`${c.slice(0, 7)}: ${entries.length} 个文件变更`);

  const tree = await api(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent, tree: entries })
  });

  // author/committer/message 全部取本地原值（%I/%cI 为严格 ISO8601）
  // 注意：git log 输出会自带一个记录尾换行（非消息内容），须剥掉，否则 API 建出的
  // 提交消息多一个 \n，SHA 与本地不一致（本仓库提交消息均无尾换行）
  const [an, ae, aI, cn, ce, cI] = git(`git log -1 --format='%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI' ${c}`).trim().split('\x00');
  const message = git(`git log -1 --format=%B ${c}`).replace(/\n$/, '');

  const commit = await api(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [parent],
      author: { name: an, email: ae, date: aI },
      committer: { name: cn, email: ce, date: cI }
    })
  });
  const match = commit.sha === c ? 'SHA 一致 ✓' : `SHA 不同（远端 ${commit.sha}）— 继续但注意去重`;
  console.log(`${c.slice(0, 7)} → ${commit.sha.slice(0, 7)} ${match}`);
  results.push({ local: c, remote: commit.sha, match: commit.sha === c });
  parent = commit.sha;
}

// 3. 更新远端 ref（非强推；远端被别人推进过会失败，属预期保护）
await api(`/repos/${REPO}/git/refs/heads/master`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: parent, force: false })
});
console.log(`远端 master 已更新 → ${parent}`);

// 4. 同步本地 origin/master 指针（fetch 也要过 github.com，直接本地改 ref）
execSync(`git update-ref refs/remotes/origin/master ${parent}`);
console.log('本地 origin/master 指针已同步');

const mismatch = results.filter(r => !r.match);
if (mismatch.length === 0) {
  console.log('全部提交 SHA 与本地一致，等同 push 完成，无需 pull/rebase 去重');
} else {
  console.log(`注意：${mismatch.length} 个提交 SHA 与本地不同，网络恢复后可 git pull --rebase 去重`);
}
