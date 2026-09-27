// profile-learner.js
// 用户习惯自动学习模块 — Claude Code 记忆架构的"学习层"
// 在跨天时用 LLM 分析当日对话,提取用户习惯/生活环境,合并到 rules/learned-habits.md
// 该文件每次对话固定注入,让 AI 越来越了解用户

export class ProfileLearner {
  constructor(fileManager, llm, onDemandLoader) {
    this.fm = fileManager;
    this.llm = llm;
    this.onDemandLoader = onDemandLoader;
    this.profilePath = 'rules/learned-habits.md';
    this.refreshStatePath = '.meta/habits-refresh.json';
  }

  // ===== 21 天分析降频（v3.12.0）=====
  // 跑当且仅当：距上次成功刷新 ≥ 2 天 且 期间有新对话摘要（chat/*.md 日期 > 上次刷新日期）
  // 返回 { skip: bool, reason: string }
  async shouldSkipRefresh(settleDate) {
    try {
      const raw = await this.fm.readFile(this.refreshStatePath);
      const state = raw ? JSON.parse(raw) : null;
      if (!state || !state.lastRefreshDate) return { skip: false, reason: 'first_run' };
      const days = (new Date(`${settleDate}T00:00:00`) - new Date(`${state.lastRefreshDate}T00:00:00`)) / 86400000;
      if (days < 2) return { skip: true, reason: `距上次刷新仅 ${days} 天` };
      const all = await this.fm.listFiles();
      const hasNewer = all.some((f) => {
        const m = f.path.match(/^chat\/(\d{4}-\d{2}-\d{2})\.md$/);
        return m && m[1] > state.lastRefreshDate;
      });
      if (!hasNewer) return { skip: true, reason: '无新对话摘要' };
      return { skip: false, reason: 'ok' };
    } catch (_) {
      return { skip: false, reason: 'state_read_failed' };
    }
  }

  // 刷新成功后记录状态（settleDate = 本次分析覆盖到的日期，即被结算的"昨天"）
  async markRefreshed(settleDate) {
    try {
      await this.fm.writeFile(this.refreshStatePath, JSON.stringify({
        lastRefreshDate: settleDate,
        lastAt: new Date().toISOString(),
      }));
    } catch (_) { /* 状态记录失败不影响刷新本身 */ }
  }

  // 主入口:从某天的对话中学习,更新 learned-habits.md
  // 返回 { learned: bool, summary: string }
  async learnFromDate(date, messages) {
    if (!messages || messages.length === 0) {
      return { learned: false, summary: '当日无对话' };
    }

    // 读取现有学习档案
    const existing = await this.fm.readFile(this.profilePath);
    const existingProfile = existing || this._emptyProfile();

    // 把对话消息序列化为文本
    const dialogueText = this._serializeMessages(messages);

    // 用 LLM 一次性完成"提取 + 合并"(省 token)
    let updatedProfile = null;
    try {
      updatedProfile = await this._llmMergeLearnings(existingProfile, dialogueText, date);
    } catch (err) {
      console.error('[ProfileLearner] LLM 学习失败,降级为文本追加:', err.message);
      updatedProfile = this._fallbackMerge(existingProfile, dialogueText, date);
    }

    if (!updatedProfile || !updatedProfile.trim()) {
      return { learned: false, summary: '学习结果为空' };
    }

    // 如果 LLM 说"无新观察",不改文件
    if (updatedProfile.includes('无新观察') && !updatedProfile.includes('# AI 学习到的用户习惯')) {
      return { learned: false, summary: '当日无新的习惯信息' };
    }

    // 确保输出是完整的档案格式
    if (!updatedProfile.trimStart().startsWith('# AI 学习到的用户习惯')) {
      // LLM 只返回了增量,用 fallback 合并
      updatedProfile = this._fallbackMerge(existingProfile, updatedProfile, date);
    }

    await this.fm.writeFile(this.profilePath, updatedProfile);
    return { learned: true, summary: `已从 ${date} 的对话中学习并更新习惯档案` };
  }

  // 用 LLM 合并学习:输入现有档案 + 当日对话,输出更新后的完整档案
  async _llmMergeLearnings(existingProfile, dialogueText, date) {
    if (!this.llm || !this.llm.chat) {
      return this._fallbackMerge(existingProfile, dialogueText, date);
    }

    const sysPrompt = `你是"轻伴"的用户习惯学习模块。你的任务是维护一份"用户习惯学习档案"。

规则:
1. 只记录对话中【明确提到】或【可合理推断】的信息,绝不臆测
2. 保留现有档案中仍然有效的条目
3. 补充当日新发现的生活习惯、饮食规律、用餐场所、作息、运动、工作环境、情绪等
4. 若现有条目与今日观察矛盾,以最新观察为准并更新
5. 若当日对话无任何相关生活习惯信息,原样返回现有档案(不改动)
6. 保持 Markdown 结构,以 "# AI 学习到的用户习惯" 开头,包含以下分段:
   ## 饮食习惯 / ## 常去用餐场所 / ## 生活作息 / ## 运动规律 / ## 工作与生活环境 / ## 情绪与压力 / ## 其他观察 / ## 更新日志
7. 更新日志末尾追加一行: - ${date}: (简述本次学到什么,或"无新发现")

直接输出更新后的完整档案,不要加任何解释或前言。`;

    const userContent = `## 现有学习档案
${existingProfile}

---

## 当日(${date})对话内容
${dialogueText}

---

请根据当日对话更新学习档案,直接输出完整的更新后档案:`;

    const resp = await this.llm.chat(
      [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userContent }
      ],
      null,
      { task: 'profile_learning' }
    );

    return resp.content || '';
  }

  // 降级:LLM 不可用时,简单文本追加
  _fallbackMerge(existingProfile, dialogueText, date) {
    // 如果 dialogueText 看起来是对话原文,提取关键句
    let notes = '';
    if (dialogueText.includes('[user]')) {
      const userLines = dialogueText.split('\n')
        .filter(l => l.startsWith('[user]'))
        .map(l => l.replace('[user]', '').trim())
        .filter(l => l.length > 5);
      if (userLines.length > 0) {
        notes = userLines.slice(0, 5).map(l => `- ${l.substring(0, 80)}`).join('\n');
      }
    }

    let profile = existingProfile;
    if (!profile.includes('## 更新日志')) {
      profile += '\n\n## 更新日志\n';
    }
    profile += `- ${date}: ${notes ? '观察到: ' + notes : '无新发现'}\n`;
    return profile;
  }

  // 把消息数组序列化为文本
  _serializeMessages(messages) {
    return messages.map(m => {
      const role = m.role === 'user' ? '[user]' : (m.role === 'assistant' ? '[assistant]' : '[system]');
      let text = '';
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content.map(c => c.type === 'text' ? c.text : '[图片]').join(' ');
      }
      // 截断过长内容,避免超 token
      if (text.length > 500) text = text.substring(0, 500) + '...';
      return `${role} ${text}`;
    }).join('\n');
  }

  // 空档案模板
  _emptyProfile() {
    return `# AI 学习到的用户习惯

> 此文件由 AI 自动维护,记录对用户生活习惯、生活环境的观察和推测。
> 每次对话 AI 都会加载此文件,并在跨天时自动更新。

## 饮食习惯
- (待学习)

## 常去用餐场所
- (待学习)

## 生活作息
- (待学习)

## 运动规律
- (待学习)

## 工作与生活环境
- (待学习)

## 情绪与压力
- (待学习)

## 其他观察
- (待学习)

## 更新日志
- 初始创建`;
  }

  // 生成"今日习惯打卡"问候语 — 新一天开始时调用
  // 读取 learned-habits.md,用 LLM 提炼可打卡习惯,生成自然的提问
  // 返回 string (打卡问候语),失败返回 null
  async generateHabitCheckin(currentDate) {
    const profile = await this.fm.readFile(this.profilePath);
    if (!profile) return null;

    // 快速检查:档案是否还是空的(全是"待学习")
    const meaningful = profile.replace(/待学习|初始创建|更新日志/g, '');
    const realChars = meaningful.replace(/[#\-\s>\*]/g, '').length;
    if (realChars < 10) return null; // 档案太空,跳过打卡

    let checkin = null;
    try {
      checkin = await this._llmHabitCheckin(profile, currentDate);
    } catch (err) {
      console.error('[ProfileLearner] 打卡生成失败:', err.message);
      return null;
    }

    if (!checkin || !checkin.trim()) return null;
    // 若 LLM 明确说"无可打卡习惯"
    if (checkin.includes('无可打卡') || checkin.includes('习惯尚未成型')) return null;
    return checkin.trim();
  }

  // 用 LLM 生成习惯打卡提问
  async _llmHabitCheckin(profile, currentDate) {
    if (!this.llm || !this.llm.chat) {
      return this._fallbackCheckin(profile, currentDate);
    }

    const sysPrompt = `你是"轻伴"的习惯打卡助手。根据用户的学习档案,为新的一天生成一句自然的问候+打卡提问。

规则:
1. 从档案中挑出 1-3 个【可验证的日常习惯】(如:跑步、某餐吃什么、几点起床、喝水、不喝含糖饮料等)
2. 用温暖自然的口吻问用户今天是否做到了,像朋友随口一问,不要像清单
3. 一次最多问 2-3 个习惯,不要全部罗列
4. 如果档案里只有"(待学习)"没有真实习惯,直接回复"习惯尚未成型"
5. 只输出问候语本身,不要加解释、不要加引号、不要加 markdown 代码块

格式示例:
"早呀!新的一天开始了。今天跑步了吗?还有,你常去的食堂中午打算吃点啥?记得避开花生哦~"`;

    const userContent = `今天是 ${currentDate}。

## 用户习惯学习档案
${profile}

请生成今天的习惯打卡问候:`;

    const resp = await this.llm.chat(
      [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userContent }
      ],
      null,
      { task: 'habit_checkin' }
    );

    return resp.content || '';
  }

  // 降级:LLM 不可用时,简单从档案提取关键习惯
  _fallbackCheckin(profile, currentDate) {
    const lines = profile.split('\n')
      .filter(l => l.startsWith('- ') && !l.includes('待学习') && !l.includes('初始创建') && !l.includes('更新日志'))
      .map(l => l.replace(/^- /, '').trim())
      .filter(l => l.length > 3)
      .slice(0, 2);

    if (lines.length === 0) return null;
    const q = lines.map(h => `今天${h}了吗?`).join(' 还有,');
    return `新的一天!${q}`;
  }

  // ===== 刷新习惯总结：基于近 N 天对话重新分析用户习惯 =====
  // 读取 chat/*.md 摘要文件，让 LLM 全量分析后生成全新的习惯档案
  // 返回 { success: bool, summary: string, daysAnalyzed: number }
  async refreshHabits(days = 21) {
    // 1. 读取近 N 天的对话摘要 — 按需加载或盲读
    const truncate = window.QINGBAN_SETTINGS?.fileTruncate || 800;
    const chatEntries = [];

    if (window.QINGBAN_SETTINGS?.onDemandLoad !== false && this.onDemandLoader) {
      // 按需加载分支：通过索引筛选有记录的日期
      const pad = (n) => String(n).padStart(2, '0');
      const now = new Date();
      const currentDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const result = await this.onDemandLoader.loadForSummary({
        taskType: 'habit_refresh',
        currentDate,
        targetDays: days
      });
      for (const f of result.files) {
        const trimmed = f.content.length > truncate
          ? f.content.substring(0, truncate) + '\n...(截断)'
          : f.content;
        chatEntries.push({ date: f.date, content: trimmed });
      }
    } else {
      // 回退分支：原盲读循环
      const pad = (n) => String(n).padStart(2, '0');
      const now = new Date();
      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const content = await this.fm.readFile(`chat/${dateStr}.md`);
        if (content) {
          const trimmed = content.length > truncate
            ? content.substring(0, truncate) + '\n...(截断)'
            : content;
          chatEntries.push({ date: dateStr, content: trimmed });
        }
      }
    }

    if (chatEntries.length === 0) {
      return { success: false, summary: `近 ${days} 天没有对话记录，无法分析`, daysAnalyzed: 0 };
    }

    // 2. 读取现有习惯档案
    const existingProfile = await this.fm.readFile(this.profilePath) || this._emptyProfile();

    // 3. 拼接对话摘要文本
    const dialogueText = chatEntries
      .map(e => `### ${e.date}\n${e.content}`)
      .join('\n\n---\n\n');

    // 4. 调用 LLM 全量分析
    let updatedProfile = null;
    try {
      updatedProfile = await this._llmRefreshHabits(existingProfile, dialogueText, chatEntries.length, days);
    } catch (err) {
      console.error('[ProfileLearner] 刷新习惯失败:', err.message);
      return { success: false, summary: `LLM 分析失败: ${err.message}`, daysAnalyzed: chatEntries.length };
    }

    if (!updatedProfile || !updatedProfile.trim()) {
      return { success: false, summary: 'LLM 返回为空', daysAnalyzed: chatEntries.length };
    }

    // 5. 确保输出是完整的档案格式
    if (!updatedProfile.trimStart().startsWith('# AI 学习到的用户习惯')) {
      updatedProfile = `# AI 学习到的用户习惯\n\n${updatedProfile}`;
    }

    // 6. 写入更新后的档案
    await this.fm.writeFile(this.profilePath, updatedProfile);

    return {
      success: true,
      summary: `已基于近 ${chatEntries.length} 天对话重新分析并更新习惯档案`,
      daysAnalyzed: chatEntries.length
    };
  }

  // LLM 全量分析：输入近 N 天对话 + 现有档案，输出全新的习惯档案
  async _llmRefreshHabits(existingProfile, dialogueText, actualDays, targetDays) {
    if (!this.llm || !this.llm.chat) {
      throw new Error('LLM 不可用');
    }

    const sysPrompt = `你是"轻伴"的用户习惯分析模块。你将收到用户近 ${actualDays} 天的对话摘要和现有习惯档案。
你的任务是：基于这些对话记录，重新分析并生成一份全新的用户习惯档案。

分析规则：
1. **基于证据**：只记录对话中【明确提到】或【可合理推断】的行为模式，绝不臆测
2. **频率标注**：对每个习惯，标注出现频率（如"经常""偶尔""约X次/周"），让用户知道一致性
3. **去旧换新**：如果现有档案中的条目在近 ${actualDays} 天对话中完全没出现，且不是永久性信息（如过敏），可以移除或标注"近期未观察到"
4. **保留永久信息**：过敏、身体限制等永久性信息必须保留
5. **发现新规律**：从对话中识别饮食习惯、用餐时间偏好、运动规律、作息模式、工作环境、情绪触发因素等
6. **趋势分析**：如果某个行为在前期频繁出现但近期减少（或反之），标注趋势变化

输出格式要求：
- 以 "# AI 学习到的用户习惯" 开头
- 保持以下分段：
  ## 饮食习惯 / ## 常去用餐场所 / ## 生活作息 / ## 运动规律 / ## 工作与生活环境 / ## 情绪与压力 / ## 其他观察 / ## 更新日志
- 每个条目格式：- 内容（频率/趋势标注）
- 更新日志末尾追加：- ${new Date().toISOString().substring(0, 10)}: 基于近${actualDays}天对话全量刷新

直接输出完整的更新后档案，不要加任何解释或前言。`;

    const userContent = `## 现有习惯档案（供参考，可能已过时）
${existingProfile}

---

## 近 ${actualDays} 天对话记录（共 ${actualDays} 天有记录，目标 ${targetDays} 天）
${dialogueText}

---

请基于以上对话记录，重新分析并生成全新的用户习惯档案：`;

    const resp = await this.llm.chat(
      [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userContent }
      ],
      null,
      { task: 'habit_refresh' }
    );

    return resp.content || '';
  }
}
