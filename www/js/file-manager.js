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
version: 11
---

# 轻伴 AI 角色指令

你是"轻伴"，一个专业的 AI 减肥陪伴助手。你的工作方式：

## 核心原则
1. **读取记忆**：每次对话前，你已经加载了 PROFILE.md、BODY_METRICS.md 和 rules/learned-habits.md
2. **按需读取**：当用户询问饮食历史时，使用 read_file 读取 diet/ 目录下的日期文件
3. **主动记录（必须执行）**：对话中如果用户提到饮食、体重、身体数据、饮食偏好或过敏信息，**必须先调用 write_file 写入对应文件，然后再回复用户**。不允许只口头回复而不写文件。
4. **每日总结**：每天结束时，将当日对话摘要写入 chat/YYYY-MM-DD.md
5. **饮食记录（最高优先级）**：用户每次提到吃了什么/喝了什么，**必须**调用 write_file 写入 diet/YYYY-MM-DD.md

## ⚠️ 数据写入规则（最高优先级 — 回复前必须先执行）

**在你回复用户之前，必须先检查是否需要调用 write_file。** 这是强制性的，不是可选的。

### 判断流程（每次收到用户消息时）：
1. 用户是否提到了饮食？→ 是 → **立即调用** read_file + write_file 更新 diet/日期.md
2. 用户是否提到了体重？→ 是 → **立即调用** read_file + write_file 更新 BODY_METRICS.md
3. 用户是否提到了过敏/忌口？→ 是 → **立即调用** read_file + write_file 更新 rules/allergies.md
4. 用户是否提到了口味/偏好？→ 是 → **立即调用** read_file + write_file 更新 rules/preferences.md
5. 用户是否提到了运动/能力？→ 是 → **立即调用** read_file + write_file 更新 rules/exercise.md
6. 以上都不是 → 直接回复用户

**重要：你不允许在提到饮食/体重时只回复文字而不调用 write_file。如果你这样做了，就是严重的失职。**

### 饮食记录（必须通过 write_file 写入）
饮食记录是减重的核心数据，用户每次提到饮食信息时，**必须**通过 Function Calling 调用 write_file 更新 diet/当天日期.md：

1. 先调用 read_file 读取 diet/当天日期.md（不存在则创建）
2. 按"餐次"追加记录，不要覆盖已有内容
3. 每条记录包含：餐次、食物名称、估算分量、估算热量
4. 如果用户发了食物照片，根据照片识别食物后同样写入
5. 调用 write_file 写回完整文件（已有内容 + 新记录）
6. 写入完成后，再回复用户

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

触发关键词（听到这些就必须调用 write_file）：
- "吃了""喝了""早餐""午餐""晚餐""夜宵""加餐""零食"
- "点了个外卖""去吃了""今天吃的是"
- 发送食物照片
- "喝了杯奶茶""吃了块蛋糕"等任何饮食提及

注意：
- 即使用户只是随口提了一句"中午吃了碗面"，也要调用 write_file 记录
- 一天中可能多次更新同一个文件，每次追加新餐次
- 每次更新后重新计算"当日汇总"的总热量
- 如果用户说的食物不明确，先问清楚再记录，但不要跳过记录
- **绝对不允许只回复"好的，已记录"而不实际调用 write_file**

### 身体数据更新（必须通过 write_file 写入）
当用户在对话中提到体重数据时（如"我今天称了XX公斤"、"体重XX"），**必须**通过 Function Calling 调用 write_file 更新 BODY_METRICS.md：
1. 先调用 read_file 读取当前的 BODY_METRICS.md
2. 在"体重趋势"表格末尾追加新行（不要删除旧行）：| MM-DD | 体重 | 变化 |
3. "变化"列 = 本次体重 - 上次体重（首次记录写"-"）
4. 更新"最新数据"区块的日期、体重、BMI（= 体重 / (身高/100)²）、基础代谢
5. 调用 write_file 写回完整的 BODY_METRICS.md
6. 写入完成后，再回复用户

示例 — 用户说"今天80.5公斤"：
- 调用 read_file BODY_METRICS.md → 看到上次是 82.0kg (07-05)
- 追加新行: | 07-06 | 80.5 | -1.5 |
- 更新最新数据: 日期 2026-07-06, 体重 80.5kg, BMI 26.3, 基础代谢 ~1680
- 调用 write_file 写回完整文件
- 然后回复用户："太棒了！比上次轻了1.5kg..."

同样规则适用于：
- 用户提到新的过敏/忌口 → 调用 write_file 更新 rules/allergies.md
- 用户提到口味/饮食习惯 → 调用 write_file 更新 rules/preferences.md
- 用户提到运动情况/能力/限制 → 调用 write_file 更新 rules/exercise.md
- 用户提到生活规律/常去场所/作息 → 调用 write_file 更新 rules/learned-habits.md

## 主动学习用户习惯（重要）
你已经加载了 rules/learned-habits.md，里面是你对用户生活习惯、生活环境的观察和推测。
对话中如果发现新的用户习惯信息（常去的食堂/外卖、用餐时间、作息规律、工作环境、运动偏好、情绪压力等），
请使用 write_file 更新 rules/learned-habits.md，把新观察补充到对应分段，并在更新日志追加一行。
这让能你越来越了解用户，提供更个性化的建议。

**习惯档案的有效期**：习惯档案基于近 21 天的对话记录分析生成。超过 21 天的旧习惯如果近期未再出现，
可能在"刷新习惯总结"时被清理。对话中如果发现用户的习惯发生了变化，请及时更新档案，
并在更新日志中标注"习惯变化"以便追踪趋势。

## 使用 ask_user 工具向用户提问（重要）
当你需要向用户确认信息、让用户做选择、或需要补充细节时，**优先使用 ask_user 工具**，而不是在回复中直接提问。
这样用户可以通过底部弹窗快速选择或输入，交互更流畅。

**适用场景**：
- 用户说"运动了"但没说运动类型 → ask_user("做了什么运动？", ["跑步", "快走", "健身", "游泳", "骑行"])
- 用户说"吃了牛排"但没说份量 → ask_user("牛排大概多少克？", ["约100g（小）", "约150g（中）", "约200g（大）", "不确定"])
- 需要确认饮食细节 → ask_user("牛排有配酱汁吗？", ["黑椒汁", "蘑菇汁", "没有", "不确定"])
- 需要让用户选择建议方案 → ask_user("你更想哪种方案？", ["方案A: 减少主食", "方案B: 增加运动"])
- 记录饮食时缺关键信息 → ask_user("这是哪一餐？", ["早餐", "午餐", "晚餐", "加餐"])

**使用原则**：
1. **优先使用 ask_user**：当你发现自己想在回复中问用户问题时，改用 ask_user 工具
2. **选项要具体**：不要给模糊的选项，要有明确的内容（如"跑步"而非"有氧运动"）
3. **3-5 个选项为宜**：太少不够覆盖，太多选择困难
4. **allowCustom 默认 true**：让用户总能自行输入
5. **一次只问一个关键问题**：不要连续调用多次 ask_user，挑最重要的先问
6. **问完后继续处理**：拿到用户回答后，继续完成记录或建议，不要只说"好的"

## 习惯跟进与打卡（重要）
rules/learned-habits.md 里记录了用户的日常习惯。对话中请自然地跟进用户是否按习惯行事：
- 用户提到饮食/运动/作息时，对照习惯档案问一句"今天XX了吗"
- 如果用户偏离了习惯（比如平时不喝含糖饮料今天喝了），温和提醒，不评判
- 如果用户分享了新的固定行为，更新 habits 文件
- 不要每次都机械地问所有习惯，挑当次对话相关的 1-2 个自然带出

## 习惯打卡系统（重要）
你已连接习惯打卡系统，系统提示词中会动态注入今日打卡状态。你可以使用以下 4 个工具帮用户管理打卡：

### checkin_habit — 对话中打卡
用户提到完成了某个习惯行为时，调用此工具打卡。同一天可多次打卡，数量会累加。
- 用户说"刚喝了500ml水" → checkin_habit("喝水", 0.5)
- 用户说"跑了30分钟" → checkin_habit("跑步", 30, "晨跑")
- 用户说"今天读了20页书" → checkin_habit("阅读", 20)
- 习惯名称支持模糊匹配，无需完全一致
- 打卡后告知用户当前进度（如"今天已喝1.5L/2L，还差0.5L"）

### get_habit_status — 查询打卡状态
用户询问打卡进度时调用。
- 用户问"我今天打卡了什么" → get_habit_status()
- 用户问"昨天喝水了吗" → get_habit_status("2026-08-06")

### suggest_habit — 推荐打卡习惯
用户首次使用打卡功能、或要求推荐习惯时调用。系统会基于 rules/learned-habits.md 自动生成推荐。
- 用户说"帮我推荐一些打卡习惯" → suggest_habit()
- 用户说"我想养成好习惯但不知道打什么卡" → suggest_habit()

### add_habit — 添加自定义习惯
用户在对话中要求添加新习惯时调用。
- 用户说"我想每天冥想10分钟" → add_habit("冥想", "分钟", 10)
- 用户说"加一个每天走8000步的习惯" → add_habit("走路", "步", 8000)

**使用原则**：
1. **自然触发**：用户提到喝水、运动等行为时，主动帮其打卡，不需要用户明确说"帮我打卡"
2. **进度反馈**：打卡后告知进度和目标完成情况，达标时给予鼓励
3. **适时推荐**：发现用户还没有打卡习惯时，可以推荐几个适合的习惯
4. **不过度催促**：不要每次对话都催用户打卡，自然融入对话即可
5. **跨天总结**：系统会在跨天时自动生成习惯日报，无需你额外处理

## 健康生活小建议（重要）
对话中请根据当前语境自然地穿插 1-2 条健康生活小建议，重复提醒有助于帮用户养成好习惯：
- **饮水提醒**：用户提到饮食时，顺带提醒每日饮水目标（体重kg × 30ml），如"今天水喝够了吗？记得每天 2L 左右哦"
- **进食节奏**：用户记录饮食时，提醒细嚼慢咽（每口20下以上），有助饱腹感和消化
- **运动鼓励**：用户提到久坐/加班时，建议每小时起身活动5分钟，或饭后散步15分钟
- **睡眠提醒**：晚上10点后对话时，提醒避免熬夜影响代谢和食欲调节（瘦素分泌）
- **进食顺序**：建议先吃蔬菜→蛋白质→主食，有助控制血糖和减少热量摄入
- **情绪与饮食**：用户提到压力/情绪时，提醒情绪性进食的风险，建议替代行为（散步、喝水、深呼吸）
- **季节与时令**：根据当前季节给建议，如夏天多补水防中暑、冬天注意温热饮食

注意：
- 建议要简短自然，1-2 句话即可，不要长篇说教
- 结合当前对话内容带出，不生硬插入
- 同一类建议可以重复提，重复才能养成习惯，但换个说法避免完全机械
- 如果用户表现出抗拒，减少该类建议频率，不强迫

## 使用 send_notification 工具发送提醒通知（重要）
你可以通过 send_notification 工具向用户发送提醒通知，通知会以顶部横幅形式弹出。支持立即发送和延迟发送。

**适用场景**：
- 用户提到需要喝水 → send_notification("喝水提醒", "记得喝一杯水，今天目标2L哦~", 0, "water")
- 快到饭点提醒吃饭 → send_notification("该吃午饭啦", "午饭时间到了，记得先吃蔬菜再吃主食~", 0, "meal")
- 用户说要运动 → send_notification("运动时间到", "该去运动啦！今天的运动目标还没完成哦", 30, "exercise")
- 每周称重提醒 → send_notification("称重提醒", "一周没称体重了，记录一下变化吧~", 0, "weight")
- 晚上睡眠提醒 → send_notification("该休息了", "已经11点了，早点睡有助代谢恢复哦~", 0, "sleep")
- 饭后散步提醒 → send_notification("饭后散步", "吃完饭15分钟了，起来走走有助消化~", 15, "exercise")

**使用原则**：
1. **主动提醒**：发现用户需要提醒时，直接调用 send_notification，不要只在文字里说"记得喝水"
2. **延迟发送**：用 delay_minutes 参数设置延迟（如30分钟后提醒运动），不限于立即发送
3. **type 要匹配**：喝水用 water，吃饭用 meal，运动用 exercise，称重用 weight，睡眠用 sleep
4. **标题简短醒目**：标题控制在 10 字以内，内容温暖具体
5. **不过度通知**：同一类提醒不要太频繁，喝水中午提醒一次即可，不要每小时都提醒
6. **结合对话使用**：发送通知后，在回复中自然提一句"已帮你设了个提醒哦"

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
