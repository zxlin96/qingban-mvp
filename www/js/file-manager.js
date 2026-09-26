// file-manager.js
// 本地 MD 文件管理系统 — 基于 IndexedDB
// 实现 read_file / write_file / search_files / append_file 四个工具函数

export class FileManager {
  constructor() {
    this.dbName = 'qingban';
    this.dbVersion = 1;
    this.storeName = 'files';
    this.db = null;
  }

  // 初始化 IndexedDB 并加载默认文件
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      let settled = false;

      // 超时兜底：IndexedDB 被锁/损坏/阻塞时，open 可能永远不回调，
      // 必须避免启动流程被永久挂起（否则界面黑屏卡在「加载中」）
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        console.warn('[FileManager] IndexedDB 打开超时，降级为「存储不可用」模式启动');
        this._dbBroken = true;
        resolve();
      }, 4500);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'path' });
        }
      };

      // 数据库被其他连接阻塞：open 不会完成，只能靠超时兜底
      request.onblocked = () => {
        console.warn('[FileManager] IndexedDB 打开被阻塞（onblocked）— 其他连接未关闭');
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        if (settled) return;
        try {
          await this.loadDefaults();
        } catch (e) {
          console.warn('[FileManager] loadDefaults 失败:', e);
        }
        clearTimeout(timer);
        settled = true;
        resolve();
      };

      request.onerror = (event) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(event.target.error);
      };
    });
  }

  // 加载默认 MD 文件（首次使用时）
  async loadDefaults() {
    const existing = await this.listFiles();
    if (existing.length === 0) {
      // 全新安装 — 写入所有默认文件
      const defaults = this.getDefaultFiles();
      for (const [path, content] of Object.entries(defaults)) {
        await this.writeFile(path, content);
      }
      return;
    }

    // 已有数据 — 检查系统文件是否需要升级
    await this._upgradeSystemFiles();

    // 强制检查 CLAUDE.md 是否更新成功
    const claudeCheck = await this.readFile('CLAUDE.md');
    const claudeVer = this._extractVersion(claudeCheck || '');
    const expectedVer = this._extractVersion(this._getClaudeMd());
    if (claudeVer < expectedVer) {
      // 版本号仍然低于预期 — 强制覆盖
      await this.writeFile('CLAUDE.md', this._getClaudeMd());
      console.log(`[强制升级] CLAUDE.md: v${claudeVer} → v${expectedVer}（版本检查失败，强制覆盖）`);
    }
  }

  // 系统文件自动升级（不覆盖用户数据）
  async _upgradeSystemFiles() {
    // 可安全覆盖升级的纯系统文件（不含用户对话中写入的数据）
    const systemFiles = {
      'CLAUDE.md': this._getClaudeMd(),
      'INDEX.md': this._getIndexMd(),
    };

    for (const [path, newContent] of Object.entries(systemFiles)) {
      const current = await this.readFile(path);
      
      // 文件不存在 → 写入默认
      if (!current) {
        await this.writeFile(path, newContent);
        continue;
      }

      // 提取版本号比较
      const currentVersion = this._extractVersion(current);
      const newVersion = this._extractVersion(newContent);

      // 版本号更高 → 覆盖升级
      if (newVersion > currentVersion) {
        await this.writeFile(path, newContent);
        console.log(`[升级] ${path}: v${currentVersion} → v${newVersion}`);
      }
    }

    // 用户数据文件：只在文件不存在时写入默认模板，一旦创建永不覆盖
    const userTemplateFiles = {
      'rules/allergies.md': this._getAllergiesMd(),
      'rules/preferences.md': this._getPreferencesMd(),
      'rules/exercise.md': this._getExerciseMd(),
      'rules/learned-habits.md': this._getLearnedHabitsMd(),
    };

    for (const [path, content] of Object.entries(userTemplateFiles)) {
      const existing = await this.readFile(path);
      if (!existing) {
        await this.writeFile(path, content);
      }
    }
  }

  // 从 MD 文件头部提取 version 字段
  _extractVersion(content) {
    const match = content.match(/version:\s*(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }

  getDefaultFiles() {
    return {
      'CLAUDE.md': this._getClaudeMd(),
      'PROFILE.md': this._getProfileMd(),
      'BODY_METRICS.md': this._getBodyMetricsMd(),
      'rules/allergies.md': this._getAllergiesMd(),
      'rules/preferences.md': this._getPreferencesMd(),
      'rules/exercise.md': this._getExerciseMd(),
      'rules/learned-habits.md': this._getLearnedHabitsMd(),
      'INDEX.md': this._getIndexMd(),
    };
  }

  _getClaudeMd() {
    return `---
version: 12
---

# 轻伴 AI 角色指令

你是"轻伴"，一个专业的 AI 减肥陪伴助手。你的工作方式：

## 核心原则
1. **主动记录（最高优先级）**：用户提到饮食、体重、过敏忌口、口味偏好、运动信息时，**必须先调用 write_file 写入对应文件，然后再回复用户**，不允许只口头回复而不写文件（详见下方数据写入规则）
2. **读取记忆**：PROFILE.md、BODY_METRICS.md、rules/learned-habits.md 已自动加载；用户询问历史细节时，使用 read_file 读取 diet/、chat/ 等文件
3. **每日总结**：每天结束时，将当日对话摘要写入 chat/YYYY-MM-DD.md

## 文件地图（历史数据一律查文件，不要凭记忆编造）
- 饮食: diet/YYYY-MM-DD.md ｜ 对话摘要: chat/日期.md ｜ 打卡报告: habits/日期.md
- 周报与分析: weekly/、insights/ ｜ 打卡原始数据: .meta/habit-checkins.json
- 文件总索引: INDEX.md —— 不确定路径或找不到时先 read_file 它；日期/范围不确定用 search_files 按模式搜（如 diet/2026-09-*.md）

## ⚠️ 数据写入规则（最高优先级 — 回复前必须先执行）

**回复前必须先检查是否需要 write_file：命中下面任一条就立即写文件再回复。绝对不允许只回复"好的，已记录"而不实际调用 write_file——这是严重失职。**

### 判断流程（每次收到用户消息时）：
1. 提到饮食（吃了/喝了/早餐/午餐/晚餐/夜宵/加餐/零食/点外卖/发食物照片——哪怕随口一句）→ **立即调用** read_file + write_file 更新 diet/日期.md
2. 提到体重（"称了XX""体重XX"）→ **立即调用** read_file + write_file 更新 BODY_METRICS.md
3. 提到过敏/忌口 → rules/allergies.md；口味/饮食习惯 → rules/preferences.md；运动情况/能力/限制 → rules/exercise.md；生活规律/常去场所/作息 → rules/learned-habits.md
4. 以上都不是 → 直接回复用户

### 饮食记录（必须通过 write_file 写入）
- 先 read_file diet/当天日期.md（不存在则创建），按"餐次"**追加**记录（不覆盖已有内容；一天可能多次更新同一文件），write_file 写回完整文件后再回复用户
- 每条记录包含：餐次、食物名称、估算分量、估算热量；每次更新后重新计算"当日汇总"总热量
- 用户发食物照片 → 识别后同样写入；食物不明确时先用 ask_user 问清，但不要跳过记录

文件格式：
\`\`\`markdown
---
date: YYYY-MM-DD
---

## 早餐
- 食物: 包子2个、豆浆1杯
- 分量: 中等
- 估算热量: ~450 kcal
- 时间: 08:30（如果用户提到时间）

## 午餐
- 食物: 红烧排骨、白米饭、炒青菜
- 分量: 排骨约150g、米饭1碗
- 估算热量: ~650 kcal

## 加餐
- 食物: 苹果1个
- 估算热量: ~80 kcal

## 当日汇总
- 总估算热量: ~1180 kcal
- 记录餐次: 3 餐
\`\`\`

### 身体数据更新（必须通过 write_file 写入）
用户提到体重时：read_file BODY_METRICS.md → 在"体重趋势"表末尾**追加**新行（不删除旧行）：| MM-DD | 体重 | 变化 |（"变化" = 本次体重 - 上次体重，首次记录写"-"）→ 同步更新"最新数据"区的日期、体重、BMI（= 体重 / (身高/100)²）、基础代谢 → write_file 写回完整文件 → 再回复用户（如"比上次轻了1.5kg，太棒了！"）

## 主动学习用户习惯（重要）
你已经加载了 rules/learned-habits.md，里面是你对用户生活习惯、生活环境的观察和推测。
对话中如果发现新的用户习惯信息（常去的食堂/外卖、用餐时间、作息规律、工作环境、运动偏好、情绪压力等），
请使用 write_file 更新 rules/learned-habits.md，把新观察补充到对应分段，并在更新日志追加一行。
这让能你越来越了解用户，提供更个性化的建议。

**习惯档案的有效期**：习惯档案基于近 21 天的对话记录分析生成。超过 21 天的旧习惯如果近期未再出现，
可能在"刷新习惯总结"时被清理。对话中如果发现用户的习惯发生了变化，请及时更新档案，
并在更新日志中标注"习惯变化"以便追踪趋势。

## 使用 ask_user 工具向用户提问（重要）
需要用户确认、选择或补充细节时，**优先用 ask_user 工具**（底部弹窗快速点选），不要在回复中直接提问。
- 选项要具体（"跑步"而非"有氧运动"），3-5 个为宜；allowCustom 默认 true，让用户总能自行输入
- 一次只问一个最关键的问题；拿到回答后继续完成记录或建议，不要只说"好的"
- 示例：说"运动了"没说类型 → ask_user("做了什么运动？", ["跑步", "快走", "健身", "游泳"])；吃牛排没说份量 → ask_user("大概多少克？", ["约100g", "约150g", "约200g"])

## 习惯跟进与打卡（重要）
rules/learned-habits.md 里记录了用户的日常习惯。对话中请自然地跟进用户是否按习惯行事：
- 用户提到饮食/运动/作息时，对照习惯档案问一句"今天XX了吗"
- 如果用户偏离了习惯（比如平时不喝含糖饮料今天喝了），温和提醒，不评判
- 如果用户分享了新的固定行为，更新 habits 文件
- 不要每次都机械地问所有习惯，挑当次对话相关的 1-2 个自然带出

## 习惯打卡系统（工具参数详见工具定义）
- 用户提到已完成的行为（"刚喝了500ml水""跑了30分钟""读了20页书"）→ **主动** checkin_habit 打卡，不必等用户说"帮我打卡"；打卡后告知进度（"今天已喝1.5L/2L，还差0.5L"），达标时鼓励
- 用户问打卡进度（今天/指定日期）→ get_habit_status；首次使用或求推荐 → suggest_habit；要求添加习惯（"我想每天冥想10分钟"）→ add_habit
- 不过度催促，自然融入对话；跨天日报由系统自动生成，无需你处理

## 健康生活小建议（重要）
结合当前语境自然带出 1-2 条，简短不说教、不生硬插入；同类建议换着说法重复，用户表现出抗拒就减少频率：
- 饮水：每日目标 = 体重kg × 30ml，饮食话题时顺带提醒
- 细嚼慢咽（每口20下以上）；进食顺序先蔬菜→蛋白质→主食
- 久坐/加班时建议每小时起身5分钟、饭后散步15分钟
- 晚10点后提醒避免熬夜（影响代谢和食欲调节/瘦素分泌）
- 用户提到压力/情绪时，提醒情绪性进食风险，建议替代行为（散步、喝水、深呼吸）
- 结合季节时令给建议（夏天补水防暑、冬天温热饮食）

## 使用 send_notification 发送提醒通知（重要）
发现用户需要提醒时**直接调用工具**（不要只在文字里说"记得喝水"），支持 delay_minutes 延迟发送（如用户说要运动 → 30分钟后提醒）。
- 标题 ≤10 字、内容温暖具体；type 匹配场景：喝水 water、吃饭 meal、运动 exercise、称重 weight、睡眠 sleep
- 示例：send_notification("喝水提醒", "记得喝一杯水，今天目标2L哦~", 0, "water")
- 同类提醒不要太频繁（喝水一天 2-3 次足够）；发完在回复中自然提一句"已帮你设好提醒哦"

## 语气
温暖、专业、不评判。像一个懂营养学的朋友。

## 语言
始终使用中文回复。`;
  }

  _getProfileMd() {
    return `---
updated: 2026-07-05
version: 1
---

# 用户档案

## 基础信息
- 昵称: （未填写，请完成首次引导）
- 性别: 待填写
- 年龄: 待填写
- 身高: 待填写
- 初始体重: 待填写
- 目标体重: 待填写
- 目标日期: 待填写

## 过敏与忌口
- (待记录，对话中 AI 会自动更新)

## 饮食偏好
- (待记录，对话中 AI 会自动更新)

## 运动情况
- (待记录，对话中 AI 会自动更新)`;
  }

  _getBodyMetricsMd() {
    return `---
updated: 2026-07-05
version: 1
---

# 身体指标追踪

## 最新数据
- 日期: 待填写
- 体重: 待填写
- BMI: 待计算
- 体脂率: 待测量
- 基础代谢: 待计算

## 体重趋势
| 日期 | 体重 | 变化 |
|------|------|------|
| (暂无记录) | | |

## 阶段判断
尚未完成首次引导，请填写基本信息后开始记录。`;
  }

  _getAllergiesMd() {
    return `---
version: 1
---

# 过敏与忌口

> 此文件由 AI 在对话中自动更新。当用户提到过敏、忌口信息时，AI 会写入此处。

## 严重过敏
- (暂无记录)

## 不吃 / 忌口
- (暂无记录)

## 注意事项
- (暂无记录)`;
  }

  _getPreferencesMd() {
    return `---
version: 1
---

# 饮食偏好

> 此文件由 AI 在对话中自动更新。当用户提到口味、习惯、饮食原则时，AI 会写入此处。

## 口味
- (暂无记录)

## 习惯
- (暂无记录)

## 减肥期间原则
- (暂无记录)`;
  }

  _getExerciseMd() {
    return `---
version: 1
---

# 运动情况

> 此文件由 AI 在对话中自动更新。当用户提到运动能力、运动限制时，AI 会写入此处。

## 当前能力
- (暂无记录)

## 限制
- (暂无记录)`;
  }

  _getLearnedHabitsMd() {
    return `---
version: 1
---

# AI 学习到的用户习惯

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

  _getIndexMd() {
    return `---
version: 3
---

# 轻伴文件索引

## 固定注入
- CLAUDE.md — AI 角色与行为规范
- PROFILE.md — 用户基础档案
- BODY_METRICS.md — 身体指标追踪
- rules/learned-habits.md — AI 学习到的用户习惯

## 规则文件
- rules/allergies.md — 过敏与忌口（待记录）
- rules/preferences.md — 饮食偏好（待记录）
- rules/exercise.md — 运动情况（待记录）

## 习惯打卡数据
- .meta/habits.json — 习惯列表（名称、单位、目标、图标）
- .meta/habit-checkins.json — 打卡记录（习惯ID、日期、数量、备注）

## 饮食记录
（暂无）

## 对话摘要
（暂无）

## 洞察与报告
（暂无）`;
  }

  // 内部：执行事务
  _tx(mode) {
    return this.db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  // read_file: 读取本地 MD 文件
  async readFile(path) {
    return new Promise((resolve, reject) => {
      const request = this._tx('readonly').get(path);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.content);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // write_file: 写入或覆盖 MD 文件
  async writeFile(path, content) {
    return new Promise((resolve, reject) => {
      const request = this._tx('readwrite').put({
        path,
        content,
        updatedAt: new Date().toISOString()
      });
      request.onsuccess = () => resolve(`Written ${content.length} chars to ${path}`);
      request.onerror = () => reject(request.error);
    });
  }

  // append_file: 追加内容到文件末尾
  async appendFile(path, content) {
    const existing = await this.readFile(path);
    if (existing === null) {
      return this.writeFile(path, content);
    }
    const newContent = existing + '\n' + content;
    return this.writeFile(path, newContent);
  }

  // search_files: 按文件名模式搜索（简单 glob 匹配）
  async searchFiles(pattern) {
    const all = await this.listFiles();
    const regex = this._globToRegex(pattern);
    const matched = all.filter(f => regex.test(f.path));
    return matched.map(f => f.path).join('\n');
  }

  // list_files: 列出所有文件
  async listFiles() {
    return new Promise((resolve, reject) => {
      const request = this._tx('readonly').getAll();
      request.onsuccess = () => {
        const files = request.result.map(r => ({
          path: r.path,
          updatedAt: r.updatedAt,
          size: r.content.length
        }));
        files.sort((a, b) => a.path.localeCompare(b.path));
        resolve(files);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // get_file_detail: 获取文件完整内容
  async getFileDetail(path) {
    return new Promise((resolve, reject) => {
      const request = this._tx('readonly').get(path);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // delete_file: 删除文件
  async deleteFile(path) {
    return new Promise((resolve, reject) => {
      const request = this._tx('readwrite').delete(path);
      request.onsuccess = () => resolve(`Deleted ${path}`);
      request.onerror = () => reject(request.error);
    });
  }

  // 清空所有文件（重置用）
  async clearAll() {
    return new Promise((resolve, reject) => {
      const request = this._tx('readwrite').clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 检测是否首次使用（通过 .meta/onboarded 标记文件）
  async isFirstTime() {
    const flag = await this.readFile('.meta/onboarded');
    return !flag;
  }

  // 标记已完成引导
  async markOnboarded() {
    await this.writeFile('.meta/onboarded', `completed at ${new Date().toISOString()}`);
  }

  // 简单 glob 转 regex（支持 * 通配符）
  _globToRegex(pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp('^' + escaped + '$');
  }

  // 获取文件树结构（用于 UI 展示）
  async getFileTree() {
    const files = await this.listFiles();
    const tree = { name: 'qingban', type: 'dir', children: {} };

    for (const file of files) {
      const parts = file.path.split('/');
      let current = tree.children;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const isLeaf = i === parts.length - 1;
        if (!current[part]) {
          current[part] = isLeaf
            ? { type: 'file', ...file }
            : { type: 'dir', name: part, children: {} };
        }
        if (!isLeaf) {
          current = current[part].children;
        }
      }
    }

    return tree;
  }
}
