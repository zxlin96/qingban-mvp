// cultivation-manager.js
// 修仙系统（v3.27.0）— 用户本人修真：灵根资质/十境界/修为/灵石/道心/心魔/伤势
// 行为绑定：打卡=吐纳、运动=打坐炼体、三餐=服灵膳、称重=内视（app.js 并行挂接，与宠物系统完全解耦）
// 修行速度 = 1 + 资质加成 + 转世悟性×5%/世 + 连续打卡×2%（封顶+30%）+ 道心修正；伤势/心魔爆发各减半
// 突破：修为圆满后需服用对应突破丹渡劫（成功率随境界 85%→35% 递减），或机缘/洞府顿悟灌顶直接突破
// 渡劫失败：丹耗、修为退回门槛-10%、重伤 3 天；失败中 15% 身死道消 → 转世重修（继承灵根资质 + LLM 生成家世背景）
// 大模型以"天道"身份裁定机缘/洞府吉凶：prompt 注入道心/心魔/习惯遵守摘要，返回结构化 JSON 后数值收敛
// 存储：IndexedDB（.meta/cultivation-state.json 单文件），AI 可读日志 cultivation/YYYY-MM-DD.md 由系统自动生成

const STATE_PATH = '.meta/cultivation-state.json';

export class CultivationManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.statePath = STATE_PATH;
    this.itemsPath = '.meta/cultivation-items.json'; // 动态道具池（机缘/洞府产出）
    this.onChangeCallback = null; // 数据变化时通知 UI 刷新
    this._rand = Math.random; // 可注入随机数便于单测
  }

  // ===== 静态常量（数值调参集中在此）=====

  // 灵根表（首次引导五选一）：affinity 绑定行为类型（土灵根特殊：衰减向，见 DECAY_ROOT_DISCOUNT）
  static ROOTS = [
    { key: 'metal', label: '金灵根', icon: '⚔️', affinity: 'exercise', affinityLabel: '炼体（运动）' },
    { key: 'wood', label: '木灵根', icon: '🌿', affinity: 'meal', affinityLabel: '灵膳（三餐）' },
    { key: 'water', label: '水灵根', icon: '💧', affinity: 'checkin', affinityLabel: '吐纳（打卡）' },
    { key: 'fire', label: '火灵根', icon: '🔥', affinity: 'weight', affinityLabel: '内视（称重）' },
    { key: 'earth', label: '土灵根', icon: '⛰️', affinity: 'demon', affinityLabel: '根基稳固（心魔滋生-20%）' }
  ];

  static rootDef(key) {
    return CultivationManager.ROOTS.find(r => r.key === key) || CultivationManager.ROOTS[0];
  }

  // 资质表：rollAptitude 加权随机；mult 为修为倍率加成
  static APTITUDES = [
    { key: 'mortal', label: '凡品', mult: 1.0 },
    { key: 'spiritual', label: '灵品', mult: 1.1 },
    { key: 'earthly', label: '地品', mult: 1.25 },
    { key: 'heavenly', label: '天品', mult: 1.5 }
  ];

  static aptitudeDef(key) {
    return CultivationManager.APTITUDES.find(a => a.key === key) || CultivationManager.APTITUDES[0];
  }

  // 资质加权随机（纯函数，r 可注入）：凡品 50% / 灵品 30% / 地品 15% / 天品 5%
  static rollAptitude(r) {
    const rr = (r === undefined || r === null) ? Math.random() : r;
    if (rr < 0.05) return 'heavenly';
    if (rr < 0.20) return 'earthly';
    if (rr < 0.50) return 'spiritual';
    return 'mortal';
  }

  // 境界表：LEVELS[i] 为突破到第(i+1)境所需修为；REALMS 为十境界名
  // v3.28.0 节奏重调：日活约 60-150 修为/天，炼气→筑基约 2-3 天，一路到金仙约一年以上
  static LEVELS = [0, 240, 700, 1500, 2800, 4800, 7800, 12000, 18000, 26000];
  static REALMS = ['炼气', '筑基', '金丹', '元婴', '化神', '合体', '大乘', '渡劫', '真仙', '金仙'];
  // 小境界（v3.29.0）：每个大境界内分 4 段，长门槛内进度更平缓
  static SUBREALMS = ['初期', '中期', '后期', '大圆满'];

  // 由 exp 反推境界阈值（纯函数，仅测试/工具用）：运行时的境界以 state.realm 为准（突破才提升）
  static realmOf(exp) {
    const levels = CultivationManager.LEVELS;
    let lv = 1;
    for (let i = 0; i < levels.length; i++) {
      if (exp >= levels[i]) lv = i + 1;
    }
    return { level: lv, name: CultivationManager.REALMS[lv - 1] };
  }

  // 当前境界（运行时唯一口径，纯函数）：realm 由渡劫/顿悟提升，exp 只决定境内进度与是否圆满
  // subIndex/subName/fullName：境内小境界（v3.29.0，4 段制，进度条更平缓）
  static realmOfState(state) {
    const realm = Math.max(1, Math.min(10, state.realm || 1));
    const nextExp = realm < 10 ? CultivationManager.LEVELS[realm] : null;
    const base = CultivationManager.LEVELS[realm - 1];
    const progress = nextExp === null ? 1 : Math.min(1, Math.max(0, ((state.exp || 0) - base) / (nextExp - base)));
    const subIndex = nextExp === null ? 3 : Math.min(3, Math.floor(progress * 4));
    const subName = CultivationManager.SUBREALMS[subIndex];
    return { level: realm, name: CultivationManager.REALMS[realm - 1], nextExp, base, progress, subIndex, subName, fullName: `${CultivationManager.REALMS[realm - 1]}·${subName}` };
  }

  // 行为奖励表：exp 为基础修为（实际 = base × 修行速度公式）；stones 直接发灵石
  static REWARDS = {
    checkin: { exp: 8 },      // 吐纳
    meal: { exp: 5 },         // 服用灵膳（日限 3）
    exercise: { exp: 10 },    // 打坐炼体
    weight: { exp: 15 },      // 内视探脉（日限 1）
    allDone: { stones: 5 }    // 周天圆满
  };
  static MEAL_DAILY_LIMIT = 3;

  // 修行速度公式参数
  static STREAK_SPEED_PER_DAY = 0.02; // 连续打卡每天 +2%
  static STREAK_SPEED_CAP = 0.30;     // 封顶 +30%（即 15 天）
  static REINCARNATION_SPEED_PER_LIFE = 0.05; // 每转世一世悟性 +5%

  // 道心（0-100，好习惯沉淀）与心魔（0-100，坏习惯滋生）
  static MIND_START = 60;
  static DEMON_START = 0;
  static MIND_HIGH = 80;        // ≥80：速度 +10%
  static MIND_LOW = 30;         // <30：速度 -20% 且渡劫成功率 -10%
  static DEMON_TRANCE = 20;     // 道心 <20：心魔每日自增
  static DEMON_BURST = 100;     // 心魔 ≥100：爆发（修为-10%、收益减半，清除后恢复）
  static MIND_PER_CHECKIN = 1;  // 每打卡一个好习惯 +1
  static MIND_DAILY_CAP = 5;    // 打卡道心日封顶 +5
  static MIND_ALLDONE = 5;      // 当日全达标 +5
  static MIND_MISS_DAY = -5;    // 完全断签日 -5
  static DEMON_PER_PARTIAL = 5; // 当日有习惯未达标 +5
  static DEMON_PARTIAL_STREAK = 10; // 连续 ≥2 天未达标 +10/天
  static DEMON_ALLDONE_RELIEF = -8; // 全达标日 -8
  static DEMON_TWO_DAY_CLEAR = -30; // 连续 2 天全达标额外 -30/天
  static EARTH_DEMON_DISCOUNT = 0.8; // 土灵根：心魔滋生 -20%

  // ===== 心境事件（v3.30.0：LLM 读每日聊天摘要裁定心境 → 道心/心魔/修为微调）=====
  // 类型白名单：delta 由系统固定（LLM 只能选类型+给一句理由，防止数值滥用）
  static MOOD_TYPES = {
    discipline: { mind: 1, demon: 0, exp: 0, label: '守律坚持' },
    temptation: { mind: -1, demon: 2, exp: 0, label: '欲念缠身' },
    stress: { mind: -1, demon: 1, exp: 0, label: '俗务压心' },
    joy: { mind: 1, demon: 0, exp: 0, label: '心境顺遂' },
    insight: { mind: 0, demon: 0, exp: 2, label: '灵机一动' }
  };
  static MOOD_EVENT_MAX = 3;        // 单次裁定最多事件数（同类型去重）
  static MOOD_REASON_MAX = 20;      // 理由限长
  static MOOD_RT_DAILY_CAP = 5;     // 即时渠道（cultivation_mood 工具）每日累计 |delta| 上限，随 behavior 跨天重置

  // 坊市：3 件常售丹 + 9 颗突破丹（key 含目标境界 level，price 随境界递增）
  // v3.28.0 价格随进阶曲线重调（日入约 10-40 灵石，首丹约 2-4 天攒够）
  // effect: exp=修为 / heal=清伤势 / demon=心魔增量（负为消减）；breakthrough=目标境界（仅突破丹）
  static SHOP = [
    { key: 'yangqi', kind: 'pill', icon: '🧪', name: '养气丹', price: 30, effect: 'exp', effectValue: 80, desc: '修为 +80' },
    { key: 'qingxin', kind: 'pill', icon: '🪷', name: '清心丹', price: 40, effect: 'demon', effectValue: -40, desc: '心魔 -40' },
    { key: 'liaoshang', kind: 'pill', icon: '💊', name: '疗伤丹', price: 50, effect: 'heal', desc: '清除伤势' },
    { key: 'zhuji', kind: 'pill', icon: '⚡', name: '筑基丹', price: 60, breakthrough: 2, desc: '炼气圆满后渡劫筑基' },
    { key: 'ningjin', kind: 'pill', icon: '⚡', name: '凝金丹', price: 150, breakthrough: 3, desc: '筑基圆满后渡劫结丹' },
    { key: 'huaying', kind: 'pill', icon: '⚡', name: '化婴丹', price: 320, breakthrough: 4, desc: '金丹圆满后渡劫化婴' },
    { key: 'huashen', kind: 'pill', icon: '⚡', name: '化神丹', price: 600, breakthrough: 5, desc: '元婴圆满后渡劫化神' },
    { key: 'hedao', kind: 'pill', icon: '⚡', name: '合道丹', price: 1000, breakthrough: 6, desc: '化神圆满后渡劫合体' },
    { key: 'dacheng', kind: 'pill', icon: '⚡', name: '大乘丹', price: 1600, breakthrough: 7, desc: '合体圆满后渡劫大乘' },
    { key: 'dujie', kind: 'pill', icon: '⚡', name: '渡劫丹', price: 2400, breakthrough: 8, desc: '大乘圆满后渡劫境' },
    { key: 'dengxian', kind: 'pill', icon: '⚡', name: '登仙丹', price: 3500, breakthrough: 9, desc: '渡劫圆满后证真仙' },
    { key: 'jinxian', kind: 'pill', icon: '⚡', name: '金仙丹', price: 5000, breakthrough: 10, desc: '真仙圆满后证金仙' }
  ];

  static getShopItem(key) {
    return CultivationManager.SHOP.find(i => i.key === key) || null;
  }

  // 当前境界所需突破丹（纯函数）：满级返回 null
  static pillForLevel(currentLevel) {
    return CultivationManager.SHOP.find(i => i.breakthrough === currentLevel + 1) || null;
  }

  // 渡劫成功率表（按目标境界 2-10，随境界递减 85%→35%）
  static TRIBULATION_RATES = { 2: 0.85, 3: 0.78, 4: 0.72, 5: 0.66, 6: 0.60, 7: 0.54, 8: 0.48, 9: 0.42, 10: 0.35 };
  static DEATH_ON_FAIL = 0.15;     // 渡劫失败中身死道消的概率
  static FAIL_EXP_KEEP = 0.9;      // 失败修为保留比例（退回门槛的 90%）
  static INJURY_DAYS_FAIL = 3;     // 渡劫失败重伤天数
  static MIN_RATE = 0.05;
  static MAX_RATE = 0.95;

  // 机缘：打卡后触发概率与日上限；洞府探索日上限（家世 perk 可各 +1）
  static FORTUNE_CHANCE = 0.25;
  static FORTUNE_DAILY_LIMIT = 2;
  static EXPLORE_DAILY_LIMIT = 3;

  // ===== 天道掷签（v3.28.0）：档位由本地随机数定（保证吉凶分布），LLM 在档内编剧情与具体数值 =====
  // 洞府档分布与档内数值范围
  static EXPLORE_TIER_WEIGHTS = { great: 0.20, good: 0.30, plain: 0.25, bad: 0.25 };
  static EXPLORE_TIER_RANGES = {
    great: { stones: [25, 45], exp: [15, 30], injury: [0, 0] },
    good: { stones: [10, 25], exp: [8, 15], injury: [0, 0] },
    plain: { stones: [0, 10], exp: [3, 8], injury: [0, 0] },
    bad: { stones: [-15, 0], exp: [-8, 0], injury: [1, 3] }
  };
  // 机缘档分布与档内数值范围（none=无波澜）
  static FORTUNE_TIER_WEIGHTS = { great: 0.15, good: 0.30, plain: 0.25, bad: 0.15, none: 0.15 };
  static FORTUNE_TIER_RANGES = {
    great: { stones: [30, 60], exp: [20, 40] },
    good: { stones: [10, 30], exp: [8, 20] },
    plain: { stones: [0, 10], exp: [0, 8] },
    bad: { stones: [-25, 0], exp: [-15, 0] },
    none: { stones: [0, 0], exp: [0, 0] }
  };

  // 掷签（纯函数，r 可注入）：按权重表返回档位 key
  static rollTier(weights, r) {
    const rr = (r === undefined || r === null) ? Math.random() : r;
    let acc = 0;
    for (const [key, w] of Object.entries(weights)) {
      acc += w;
      if (rr < acc) return key;
    }
    return Object.keys(weights).pop();
  }

  static rollExploreTier(r) {
    return CultivationManager.rollTier(CultivationManager.EXPLORE_TIER_WEIGHTS, r);
  }

  static rollFortuneTier(r) {
    return CultivationManager.rollTier(CultivationManager.FORTUNE_TIER_WEIGHTS, r);
  }

  static _clampRange(v, range) {
    const n = Math.round(Number(v) || 0);
    return Math.max(range[0], Math.min(range[1], n));
  }

  // 家世 perk 白名单（转世时 LLM 四选一，sanitize 收敛）
  static BACKGROUND_PERKS = ['stones20', 'speed3', 'explore1', 'fortune1'];
  static BACKGROUND_PERK_LABELS = {
    stones20: '开局灵石 +20',
    speed3: '修行速度 +3%',
    explore1: '洞府探索每日 +1 次',
    fortune1: '机缘每日 +1 次'
  };

  static clampStat(v) {
    return Math.max(0, Math.min(100, Math.round(v)));
  }

  // 日期差（整日数）：b - a
  static daysBetween(a, b) {
    if (!a || !b) return 0;
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.round((db - da) / 86400000);
  }

  // ===== 状态存取 =====

  async _loadState() {
    const raw = await this.fm.readFile(this.statePath);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw);
      if (!d || !d.daoName) return null; // 缺 daoName 视为损坏，走重新创建
      // v3.30.3 invariant 校准：修为不低于当前境界下限（v3.28.0 门槛上调前的旧档、或连次心魔爆发跌破下限，
      // 会导致境内进度为负、进度条/小境界显示异常；校准并记日志，version 升 2）
      const realm = Math.max(1, Math.min(10, d.realm || 1));
      const base = CultivationManager.LEVELS[realm - 1];
      if (!Array.isArray(d.log)) d.log = [];
      if ((d.exp || 0) < base) {
        d.exp = base;
        d.version = 2;
        this._addLog(d, 'migrate', `🛠 修为校准至本境下限 ${base}`);
        await this._saveState(d);
      } else if (d.version !== 2) {
        d.version = 2;
        await this._saveState(d);
      }
      return d;
    } catch {
      return null;
    }
  }

  async _saveState(state) {
    await this.fm.writeFile(this.statePath, JSON.stringify(state));
  }

  // 写状态 + 重建当日日志 MD + 通知 UI（logDate：事件归属日期，跨天结算传昨日）
  async _commit(state, logDate) {
    state.level = CultivationManager.realmOfState(state).level; // level 以存储的 realm 为准
    await this._saveState(state);
    try {
      await this._writeDayMd(logDate || this._getToday());
    } catch (e) {
      console.warn('[CultivationManager] 写日志失败:', e.message);
    }
    this._notifyChange();
  }

  // ===== 首次创建 =====

  async ensureStarted() {
    return this._loadState();
  }

  // 踏入仙途：选灵根 + 取道号；资质加权随机；开局 20 灵石
  async startJourney(rootKey, daoName) {
    const existing = await this._loadState();
    if (existing) return { state: existing, created: false };
    const def = CultivationManager.rootDef(rootKey);
    const today = this._getToday();
    const state = {
      version: 2,
      createdAt: new Date().toISOString(),
      daoName: (String(daoName || '').trim() || '无名散修').slice(0, 8),
      root: def.key,
      aptitude: CultivationManager.rollAptitude(this._rand()),
      reincarnations: 0,
      background: { text: '这一世，你出身凡俗，机缘巧合踏上仙途。', perk: null }, // 首世无 perk
      exp: 0,
      level: 1,
      realm: 1, // 当前境界（渡劫/顿悟提升；exp 不反推境界）
      stones: 20,
      mind: CultivationManager.MIND_START,
      demon: CultivationManager.DEMON_START,
      injured: 0, // 伤势剩余天数（收益减半）
      dead: false,
      lastTickDate: null,
      streak: 0,       // 当前连续活跃天数（≥1 次打卡算活跃）
      bestStreak: 0,
      lastActiveDate: null,
      allDoneStreak: 0,    // 连续全达标天数（tickDaily 统计，用于心魔额外消减）
      partialStreak: 0,    // 连续未全达标天数（tickDaily 统计）
      inventory: {},
      behavior: this._freshBehavior(today),
      log: []
    };
    const apt = CultivationManager.aptitudeDef(state.aptitude);
    this._addLog(state, 'start', `☯ ${state.daoName} 得 ${def.icon}${def.label}（${apt.label}），踏入仙途（开局 ${state.stones} 灵石）`);
    await this._commit(state, today);
    await this.fm.writeFile(CultivationManager.lifeDocPath(state), CultivationManager.buildInitialLifeDoc(state, today));
    return { state, created: true };
  }

  async getState() {
    return this._loadState();
  }

  // ===== 修行速度公式 =====

  // 灵根亲和加成：金=运动/木=三餐/水=打卡/火=称重 +25%；土灵根无行为加成（衰减向见 DECAY）
  static rootAffinityBonus(rootKey, rewardType) {
    const def = CultivationManager.rootDef(rootKey);
    return def.affinity === rewardType ? 0.25 : 0;
  }

  // 修行速度倍率（纯函数，可单测）：1 + 资质 + 转世悟性 + 连续打卡 + 道心 + 家世perk
  static speedMultiplier(state) {
    const apt = CultivationManager.aptitudeDef(state.aptitude);
    let m = 1 + (apt.mult - 1);
    m += (state.reincarnations || 0) * CultivationManager.REINCARNATION_SPEED_PER_LIFE;
    const streakBoost = Math.min(state.streak || 0, Math.round(CultivationManager.STREAK_SPEED_CAP / CultivationManager.STREAK_SPEED_PER_DAY)) * CultivationManager.STREAK_SPEED_PER_DAY;
    m += streakBoost;
    if (state.mind >= CultivationManager.MIND_HIGH) m += 0.10;
    if (state.mind < CultivationManager.MIND_LOW) m -= 0.20;
    if (state.background && state.background.perk === 'speed3') m += 0.03;
    return Math.max(0.1, m);
  }

  // 修为实际收益系数：速度 × 伤势减半 × 心魔爆发减半
  expGainFactor(state) {
    let f = CultivationManager.speedMultiplier(state);
    if (state.injured > 0) f *= 0.5;
    if (state.demon >= CultivationManager.DEMON_BURST) f *= 0.5;
    return f;
  }

  // ===== 行为奖励（app.js 挂接入口；当日去重）=====

  _freshBehavior(today) {
    return { date: today, checkins: {}, meals: 0, weights: 0, fortune: 0, explore: 0, allDone: false, mindToday: 0, moodRtAbs: 0 };
  }

  _ensureBehaviorDay(state, today) {
    if (!state.behavior || state.behavior.date !== today) {
      state.behavior = this._freshBehavior(today);
    }
  }

  // 吐纳（打卡）：每习惯每日首次；allDone=当日全达标（一次性，周天圆满+灵石、道心/心魔即时结算）
  // streak=该习惯当前连续天数（由 habitManager 提供，仅用于 milestone 提示，修仙速度看活跃天数 streak）
  // 返回 { type, exp, stones, fortuneGate } 或 null（去重/身死）
  async onCheckin(habitId, { allDone = false } = {}) {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    let rewarded = false;
    let exp = 0;
    let stones = 0;
    if (habitId && !state.behavior.checkins[habitId]) {
      state.behavior.checkins[habitId] = 1;
      exp += this._applyExp(state, 'checkin');
      // 道心：每打卡一个好习惯 +1（日封顶）
      if (state.behavior.mindToday < CultivationManager.MIND_DAILY_CAP) {
        state.mind = CultivationManager.clampStat(state.mind + CultivationManager.MIND_PER_CHECKIN);
        state.behavior.mindToday += CultivationManager.MIND_PER_CHECKIN;
      }
      this._touchStreak(state, today);
      rewarded = true;
    }
    if (allDone && !state.behavior.allDone) {
      state.behavior.allDone = true;
      stones += CultivationManager.REWARDS.allDone.stones;
      state.stones += stones;
      state.mind = CultivationManager.clampStat(state.mind + CultivationManager.MIND_ALLDONE);
      state.demon = CultivationManager.clampStat(state.demon + CultivationManager.DEMON_ALLDONE_RELIEF);
      this._addLog(state, 'mind', `周天圆满：+${stones} 灵石、道心 +${CultivationManager.MIND_ALLDONE}、心魔 ${CultivationManager.DEMON_ALLDONE_RELIEF}`);
      rewarded = true;
    }
    if (!rewarded) return null;
    await this._commit(state, today);
    return { type: 'checkin', exp, stones };
  }

  // 活跃天数 streak 维护：今日首次打卡时推进（连续=昨日活跃，否则重计）
  _touchStreak(state, today) {
    const yesterday = this._shiftDate(today, -1);
    if (state.lastActiveDate === today) return;
    state.streak = state.lastActiveDate === yesterday ? (state.streak || 0) + 1 : 1;
    state.lastActiveDate = today;
    state.bestStreak = Math.max(state.bestStreak || 0, state.streak);
  }

  // 服用灵膳（三餐记录）：每日 3 次
  async onMeal() {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if (state.behavior.meals >= CultivationManager.MEAL_DAILY_LIMIT) return null;
    state.behavior.meals++;
    this._touchStreak(state, today); // v3.30.3：三餐也算修行活跃
    const exp = this._applyExp(state, 'meal');
    await this._commit(state, today);
    return { type: 'meal', exp, stones: 0 };
  }

  // 打坐炼体（运动）：不限次
  async onExercise() {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    this._touchStreak(state, today); // v3.30.3：打坐炼体也算修行活跃
    const exp = this._applyExp(state, 'exercise');
    await this._commit(state, today);
    return { type: 'exercise', exp, stones: 0 };
  }

  // 内视探脉（称重）：每日 1 次
  async onWeight() {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if (state.behavior.weights >= 1) return null;
    state.behavior.weights++;
    this._touchStreak(state, today); // v3.30.3：内视探脉也算修行活跃
    const exp = this._applyExp(state, 'weight');
    await this._commit(state, today);
    return { type: 'weight', exp, stones: 0 };
  }

  // 发放基础修为：base × (1+灵根亲和) × expGainFactor，记吐纳/打坐等日志；跨小境界时记「境界精进」
  _applyExp(state, type) {
    const base = CultivationManager.REWARDS[type].exp;
    const affinity = 1 + CultivationManager.rootAffinityBonus(state.root, type);
    const beforeSub = CultivationManager.realmOfState(state).subIndex;
    const gain = Math.max(1, Math.round(base * affinity * this.expGainFactor(state)));
    state.exp = (state.exp || 0) + gain;
    const afterRealm = CultivationManager.realmOfState(state);
    if (afterRealm.subIndex > beforeSub) {
      this._addLog(state, 'subrealm', `🌊 境界精进：${afterRealm.fullName}`);
    }
    const texts = {
      checkin: `吐纳（打卡）：修为 +${gain}`,
      meal: `服用灵膳：修为 +${gain}`,
      exercise: `打坐炼体：修为 +${gain}`,
      weight: `内视探脉：修为 +${gain}`
    };
    this._addLog(state, 'reward', texts[type] || `${type}: 修为 +${gain}`);
    return gain;
  }

  // 机缘触发闸：打卡后由 app.js 调用；25% 概率、每日上限（家世 perk +1）
  // 命中时本地掷签定档（tier）并返回；app.js 携档调 LLM 编剧情
  async rollFortuneGate() {
    const state = await this._loadState();
    if (!state || state.dead) return { triggered: false, remaining: 0, tier: null };
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    const limit = CultivationManager.FORTUNE_DAILY_LIMIT + (state.background && state.background.perk === 'fortune1' ? 1 : 0);
    const remaining = limit - state.behavior.fortune;
    if (remaining <= 0) return { triggered: false, remaining: 0, tier: null };
    if (this._rand() >= CultivationManager.FORTUNE_CHANCE) return { triggered: false, remaining, tier: null };
    state.behavior.fortune++;
    await this._commit(state, today);
    return { triggered: true, remaining: remaining - 1, tier: CultivationManager.rollFortuneTier(this._rand()) };
  }

  // ===== 突破与渡劫 =====

  // 突破信息：满级/未圆满/可突破（持丹）三态
  async getBreakthroughInfo() {
    const state = await this._loadState();
    if (!state) return null;
    const realm = CultivationManager.realmOfState(state);
    const pill = CultivationManager.pillForLevel(realm.level);
    return {
      level: realm.level,
      name: realm.name,
      exp: state.exp,
      nextExp: realm.nextExp,
      full: realm.nextExp !== null && state.exp >= realm.nextExp,
      maxed: realm.nextExp === null,
      pill: pill ? { key: pill.key, name: pill.name, icon: pill.icon, price: pill.price, have: (state.inventory[pill.key] || 0) > 0 } : null
    };
  }

  // 渡劫成功率（纯函数，可单测）：基础表 + 天品+5% / 伤势-15% / 道心<30 -10%，钳制 5%~95%
  static tribulationRate(state) {
    const base = CultivationManager.TRIBULATION_RATES[(state.realm || 1) + 1];
    if (base === undefined) return 0;
    let rate = base;
    if (state.aptitude === 'heavenly') rate += 0.05;
    if (state.injured > 0) rate -= 0.15;
    if (state.mind < CultivationManager.MIND_LOW) rate -= 0.10;
    return Math.min(CultivationManager.MAX_RATE, Math.max(CultivationManager.MIN_RATE, rate));
  }

  // 服丹渡劫：修为圆满 + 背包有对应突破丹才可尝试
  // 返回 { success, died, realm }：died=true 时 state.dead 已置位（等转世）
  async attemptBreakthrough() {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'not_started', message: '还未踏上仙途' };
    if (state.dead) return { success: false, reason: 'dead', message: '真灵已入轮回，请先转世重修' };
    const realm = CultivationManager.realmOfState(state);
    if (realm.nextExp === null) return { success: false, reason: 'maxed', message: '已证金仙，大道圆满' };
    if (state.exp < realm.nextExp) return { success: false, reason: 'not_full', message: `修为未圆满（${state.exp}/${realm.nextExp}），继续修行` };
    const pill = CultivationManager.pillForLevel(realm.level);
    if (!pill || (state.inventory[pill.key] || 0) <= 0) {
      return { success: false, reason: 'no_pill', message: `渡劫需服用${pill ? pill.name : '突破丹'}（坊市有售）` };
    }
    const today = this._getToday();
    state.inventory[pill.key]--;
    this._touchStreak(state, today); // v3.30.3：渡劫也算修行活跃
    const rate = CultivationManager.tribulationRate(state);
    this._addLog(state, 'tribulation', `⚡ 服下${pill.icon}${pill.name}引动天劫，冲击${CultivationManager.REALMS[realm.level]}境（成算 ${Math.round(rate * 100)}%）`);
    if (this._rand() < rate) {
      // 渡劫成功：境界突破（exp 保留，继续攒下一境）
      state.realm = realm.level + 1;
      state.injured = 0;
      this._addLog(state, 'breakthrough', `🌩️ 渡劫成功！晋级${CultivationManager.REALMS[realm.level]}境`);
      await this._commit(state, today);
      return { success: true, died: false, realm: CultivationManager.realmOfState(state) };
    }
    // 渡劫失败：修为退回门槛的 90%，重伤 3 天
    state.exp = Math.floor(realm.nextExp * CultivationManager.FAIL_EXP_KEEP);
    state.injured = CultivationManager.INJURY_DAYS_FAIL;
    this._addLog(state, 'tribulation', `💥 渡劫失败！修为跌落至 ${state.exp}，重伤 ${CultivationManager.INJURY_DAYS_FAIL} 天（收益减半）`);
    if (this._rand() < CultivationManager.DEATH_ON_FAIL) {
      state.dead = true;
      this._addLog(state, 'death', `☠️ 天雷灭体，${state.daoName} 身死道消，一缕真灵遁入轮回…`);
      await this._finalizeLifeDoc(state, CultivationManager.REALMS[realm.level], today);
      await this._commit(state, today);
      return { success: false, died: true };
    }
    await this._commit(state, today);
    return { success: false, died: false };
  }

  // 机缘突破（顿悟/灌顶）：app.js 在机缘/洞府裁定命中 breakthrough 且修为圆满时调用 — 直接成功免渡劫
  async breakthroughByFortune(sourceText) {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const realm = CultivationManager.realmOfState(state);
    if (realm.nextExp === null || state.exp < realm.nextExp) return null;
    state.realm = realm.level + 1;
    state.injured = 0;
    this._touchStreak(state, this._getToday()); // v3.30.3：顿悟突破也算修行活跃
    this._addLog(state, 'breakthrough', `🌟 ${sourceText || '一朝顿悟'}，水到渠成，直入${CultivationManager.REALMS[realm.level]}境！`);
    await this._commit(state, this._getToday());
    return CultivationManager.realmOfState(state);
  }

  // ===== 转世重修 =====

  // 家世背景收敛（纯函数，可单测）：text 限长，perk 白名单（无效置 null）
  static sanitizeBackground(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = String(raw.text || '').trim().slice(0, 120);
    if (text.length < 10) return null;
    const perk = CultivationManager.BACKGROUND_PERKS.includes(raw.perk) ? raw.perk : null;
    return { text, perk };
  }

  // 转世重修：灵根资质继承、灵石留 10%、修为清零回炼气、转世+1、套用家世背景
  async reincarnate(background) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'not_started', message: '还未踏上仙途' };
    if (!state.dead) return { success: false, reason: 'not_dead', message: '尚在人世，无需转世' };
    const today = this._getToday();
    const bg = CultivationManager.sanitizeBackground(background) || {
      text: '这一世，你转世为凡俗农家子，日出而作，平平淡淡，无甚助力。',
      perk: null
    };
    state.reincarnations = (state.reincarnations || 0) + 1;
    state.background = bg;
    state.exp = 0;
    state.realm = 1;
    state.stones = Math.floor((state.stones || 0) * 0.1);
    state.injured = 0;
    state.dead = false;
    state.mind = CultivationManager.MIND_START;
    state.demon = CultivationManager.DEMON_START;
    state.streak = 0;
    state.lastActiveDate = null;
    state.allDoneStreak = 0;
    state.partialStreak = 0;
    if (bg.perk === 'stones20') state.stones += 20;
    const apt = CultivationManager.aptitudeDef(state.aptitude);
    this._addLog(state, 'reincarnate', `♻️ 第 ${state.reincarnations} 世·转世重修：${bg.text}（${apt.label}资质随真灵继承）`);
    await this._commit(state, today);
    await this.fm.writeFile(CultivationManager.lifeDocPath(state), CultivationManager.buildInitialLifeDoc(state, today));
    return { success: true, state };
  }

  // 心魔增量（土灵根根基稳固 -20%）：用于 tickDaily 中各类心魔滋生
  _demonInc(state, base) {
    const factor = state.root === 'earth' ? CultivationManager.EARTH_DEMON_DISCOUNT : 1;
    return Math.max(1, Math.round(base * factor));
  }

  // ===== 心境裁定（v3.30.0：聊天内容 → 道心/心魔/修为）=====

  // 心境事件收敛（纯函数，可单测）：类型白名单、同类型去重、限条数、reason 限长；delta 由 MOOD_TYPES 映射
  static sanitizeMoodEvents(raw) {
    if (!raw) return null;
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.events) ? raw.events : null);
    if (!arr || arr.length === 0) return null;
    const out = [];
    const seen = new Set();
    for (const e of arr) {
      if (out.length >= CultivationManager.MOOD_EVENT_MAX) break;
      if (!e || typeof e !== 'object') continue;
      const def = CultivationManager.MOOD_TYPES[String(e.type || '')];
      if (!def || seen.has(String(e.type))) continue;
      seen.add(String(e.type));
      out.push({
        type: String(e.type),
        reason: String(e.reason || '').trim().slice(0, CultivationManager.MOOD_REASON_MAX),
        mind: def.mind, demon: def.demon, exp: def.exp, label: def.label
      });
    }
    return out.length ? out : null;
  }

  // 心魔爆发判定（v3.30.0 抽取共用：tickDaily 与心境裁定复用）：≥100 则爆发，修为 -10%
  _resolveDemonBurst(state) {
    if (state.demon < CultivationManager.DEMON_BURST) return false;
    state.exp = Math.floor(state.exp * 0.9);
    this._addLog(state, 'demon', `🔥 心魔爆发！修为跌落至 ${state.exp}，修行收益减半（全达标两日或服清心丹可化解）`);
    return true;
  }

  // 套用心境事件：channel 'settlement'（每日结算，按 date 幂等）/ 'realtime'（AI 对话即时，日累计 |delta| 封顶）
  // 返回 { applied, demonBursted, summary, skipped }；skipped：settled（已裁定过）/ rt_cap（即时额度尽）/ dead（身死冻结）
  async applyMoodEvents(events, date, channel = 'settlement') {
    const clean = CultivationManager.sanitizeMoodEvents(events);
    const none = { applied: [], demonBursted: false, summary: '' };
    if (!clean) return none;
    const state = await this._loadState();
    if (!state) return none;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);

    if (channel === 'settlement') {
      if (state.lastMoodDate === date) return { ...none, skipped: 'settled' }; // 幂等：同一日期只裁定一次
    } else {
      // 即时渠道节流：当日累计 |delta| 不超过 MOOD_RT_DAILY_CAP
      let budget = CultivationManager.MOOD_RT_DAILY_CAP - (state.behavior.moodRtAbs || 0);
      if (budget <= 0) return { ...none, skipped: 'rt_cap' };
      const picked = [];
      for (const ev of clean) {
        const cost = Math.abs(ev.mind) + Math.abs(ev.demon) + Math.abs(ev.exp);
        if (cost > budget) continue;
        picked.push(ev);
        budget -= cost;
      }
      if (!picked.length) return { ...none, skipped: 'rt_cap' };
      clean.length = 0;
      clean.push(...picked);
    }

    if (state.dead) {
      if (channel === 'settlement') { state.lastMoodDate = date; await this._saveState(state); }
      return { ...none, skipped: 'dead' };
    }

    const applied = [];
    const parts = [];
    for (const ev of clean) {
      if (ev.mind) state.mind = CultivationManager.clampStat(state.mind + ev.mind);
      if (ev.demon) state.demon = CultivationManager.clampStat(state.demon + ev.demon);
      if (ev.exp) state.exp = Math.max(0, (state.exp || 0) + ev.exp);
      applied.push(ev);
      const deltaText = [
        ev.mind ? `道心 ${ev.mind > 0 ? '+' : ''}${ev.mind}` : '',
        ev.demon ? `心魔 ${ev.demon > 0 ? '+' : ''}${ev.demon}` : '',
        ev.exp ? `修为 ${ev.exp > 0 ? '+' : ''}${ev.exp}` : ''
      ].filter(Boolean).join('、');
      parts.push(`${ev.label}（${deltaText}${ev.reason ? `：${ev.reason}` : ''}）`);
    }
    const summary = parts.join('；');
    this._addLog(state, 'mood', `🎭 心境裁定：${summary}`);
    if (channel === 'settlement') state.lastMoodDate = date;
    else state.behavior.moodRtAbs = (state.behavior.moodRtAbs || 0) + applied.reduce((a, e) => a + Math.abs(e.mind) + Math.abs(e.demon) + Math.abs(e.exp), 0);
    const demonBursted = this._resolveDemonBurst(state);
    await this._commit(state, channel === 'settlement' ? date : today);
    return { applied, demonBursted, summary };
  }

  // ===== 洞府探索 =====

  // 探索次数上限（家世 perk +1）
  _exploreLimit(state) {
    return CultivationManager.EXPLORE_DAILY_LIMIT + (state.background && state.background.perk === 'explore1' ? 1 : 0);
  }

  // 消耗一次探索次数并返回剩余；身死/达上限拒绝
  async consumeExplore() {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'not_started', message: '还未踏上仙途', remaining: 0 };
    if (state.dead) return { success: false, reason: 'dead', message: '真灵已入轮回，转世后再探吧', remaining: 0 };
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    const limit = this._exploreLimit(state);
    const remaining = limit - state.behavior.explore;
    if (remaining <= 0) return { success: false, reason: 'limit_reached', message: '今日探索次数已尽，明日再来', remaining: 0 };
    state.behavior.explore++;
    this._touchStreak(state, today); // v3.30.3：洞府探索也算修行活跃
    await this._commit(state, today);
    return { success: true, remaining: remaining - 1 };
  }

  // 洞府结果收敛（纯函数，可单测）：tier 由掷签/白名单决定，数值按档内范围钳制
  // 突破丹仅大吉档可出现；道具仅大吉/吉档；顿悟仅大吉档
  static sanitizeExploreResult(raw, tierHint) {
    if (!raw || typeof raw !== 'object') return null;
    const tier = (tierHint && CultivationManager.EXPLORE_TIER_RANGES[tierHint])
      ? tierHint
      : (CultivationManager.EXPLORE_TIER_RANGES[raw.tier] ? raw.tier : 'plain');
    const range = CultivationManager.EXPLORE_TIER_RANGES[tier];
    const out = { tier };
    out.stones = CultivationManager._clampRange(raw.stones, range.stones);
    out.exp = CultivationManager._clampRange(raw.exp, range.exp);
    out.injuryDays = CultivationManager._clampRange(raw.injuryDays, range.injury);
    const narrative = String(raw.narrative || '').trim().slice(0, 120);
    if (narrative) out.narrative = narrative;
    if (tier === 'great' && raw.breakthrough === true) out.breakthrough = true;
    if (tier === 'great' && raw.pillKey && CultivationManager.SHOP.some(i => i.breakthrough && i.key === raw.pillKey)) {
      out.pillKey = raw.pillKey;
    }
    if ((tier === 'great' || tier === 'good') && raw.item) {
      const item = CultivationManager.sanitizeCustomItem(raw.item);
      if (item) out.item = item;
    }
    return out;
  }

  // 套用洞府结果：修为/灵石/伤势/道具/突破丹入包/顿悟突破
  async applyExploreResult(result, tierHint) {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    const r = CultivationManager.sanitizeExploreResult(result, tierHint)
      || { tier: (tierHint || 'plain'), stones: 0, exp: 0, injuryDays: 0, narrative: CultivationManager.exploreFallbackText(tierHint || 'plain') };
    state.stones = Math.max(0, (state.stones || 0) + r.stones);
    state.exp = Math.max(0, state.exp + r.exp);
    if (r.injuryDays > 0) state.injured = Math.max(state.injured, r.injuryDays);
    const tierLabel = { great: '🏺 大吉', good: '🏺 吉', plain: '🏺 平', bad: '🏺 凶' }[r.tier];
    const gains = [];
    if (r.stones) gains.push(`灵石 ${r.stones > 0 ? '+' : ''}${r.stones}`);
    if (r.exp) gains.push(`修为 ${r.exp > 0 ? '+' : ''}${r.exp}`);
    if (r.injuryDays > 0) gains.push(`伤势 ${r.injuryDays} 天`);
    this._addLog(state, 'explore', `${tierLabel}·探索洞府：${r.narrative || CultivationManager.exploreFallbackText(r.tier)}${gains.length ? `（${gains.join('、')}）` : ''}`);
    if (r.item) {
      const full = await this.addCustomItem({ ...r.item, source: 'explore', buyable: false, date: today });
      if (full) {
        state.inventory[full.key] = (state.inventory[full.key] || 0) + 1;
        this._addLog(state, 'item', `得 ${full.icon} ${full.name}×1`);
      }
    }
    if (r.pillKey) {
      state.inventory[r.pillKey] = (state.inventory[r.pillKey] || 0) + 1;
      const pill = CultivationManager.getShopItem(r.pillKey);
      this._addLog(state, 'item', `得 ${pill.icon} ${pill.name}×1`);
    }
    await this._commit(state, today);
    const afterRealm = CultivationManager.realmOfState(state);
    return { ...r, breakthroughReady: !!(r.breakthrough && afterRealm.nextExp !== null && state.exp >= afterRealm.nextExp) };
  }

  // LLM 失败时的档内兜底文案（纯函数）
  static exploreFallbackText(tier) {
    return {
      great: '误入古修坐化之地，得遗蜕传承与一瓶凝元丹，福缘深厚。',
      good: '循灵脉入洞府，采得几株灵药，小有收获。',
      plain: '一座半荒废洞府，静坐参悟半日，聊有寸进。',
      bad: '触动洞府残阵，被瘴气所伤，狼狈退出。'
    }[tier] || '一座荒废空府，无甚所得。';
  }

  static fortuneFallbackText(tier) {
    return {
      great: '云游路遇隐世前辈，得指点一番，茅塞顿开。',
      good: '拾得散修遗落的储物袋，内有几枚灵石。',
      plain: '云游半日，无惊无险。',
      bad: '路遇凶兽拦道，费了一番手脚才脱身。',
      none: '今日无甚机缘，修行如常。'
    }[tier] || '今日无甚机缘，修行如常。';
  }

  // ===== 机缘（天道裁定结果套用）=====

  // 机缘结果收敛（纯函数，可单测）：tier 由掷签/白名单决定，数值按档内范围钳制；道具仅大吉/吉档；顿悟仅大吉档
  static sanitizeFortune(raw, tierHint) {
    if (!raw || typeof raw !== 'object') return null;
    const tier = (tierHint && CultivationManager.FORTUNE_TIER_RANGES[tierHint])
      ? tierHint
      : (CultivationManager.FORTUNE_TIER_RANGES[raw.tier] ? raw.tier : 'plain');
    const range = CultivationManager.FORTUNE_TIER_RANGES[tier];
    const out = { tier };
    out.stones = CultivationManager._clampRange(raw.stones, range.stones);
    out.exp = CultivationManager._clampRange(raw.exp, range.exp);
    const narrative = String(raw.narrative || '').trim().slice(0, 120);
    if (narrative) out.narrative = narrative;
    if (tier === 'great' && raw.breakthrough === true) out.breakthrough = true;
    if ((tier === 'great' || tier === 'good') && raw.item) {
      const item = CultivationManager.sanitizeCustomItem(raw.item);
      if (item) out.item = item;
    }
    return out;
  }

  // 套用机缘结果：修为/灵石/道具/顿悟突破（机缘突破需修为圆满）
  async applyFortune(result, tierHint) {
    const state = await this._loadState();
    if (!state || state.dead) return null;
    const today = this._getToday();
    const r = CultivationManager.sanitizeFortune(result, tierHint)
      || { tier: (tierHint || 'none'), stones: 0, exp: 0, narrative: CultivationManager.fortuneFallbackText(tierHint || 'none') };
    if (r.tier === 'none') {
      this._addLog(state, 'fortune', `☁️ ${r.narrative || CultivationManager.fortuneFallbackText('none')}`);
      await this._commit(state, today);
      return { tier: 'none' };
    }
    state.stones = Math.max(0, (state.stones || 0) + r.stones);
    state.exp = Math.max(0, state.exp + r.exp);
    const tierLabel = { great: '🌈 机缘大吉', good: '✨ 机缘', plain: '☁️ 机缘平平', bad: '🌧️ 机缘不吉' }[r.tier];
    const gains = [];
    if (r.stones) gains.push(`灵石 ${r.stones > 0 ? '+' : ''}${r.stones}`);
    if (r.exp) gains.push(`修为 ${r.exp > 0 ? '+' : ''}${r.exp}`);
    this._addLog(state, 'fortune', `${tierLabel}：${r.narrative || CultivationManager.fortuneFallbackText(r.tier)}${gains.length ? `（${gains.join('、')}）` : ''}`);
    if (r.item) {
      const full = await this.addCustomItem({ ...r.item, source: 'fortune', buyable: false, date: today });
      if (full) {
        state.inventory[full.key] = (state.inventory[full.key] || 0) + 1;
        this._addLog(state, 'item', `得 ${full.icon} ${full.name}×1`);
      }
    }
    await this._commit(state, today);
    const realm = CultivationManager.realmOfState(state);
    const canBreakthrough = !!(r.breakthrough && realm.nextExp !== null && state.exp >= realm.nextExp);
    return { ...r, breakthroughReady: canBreakthrough };
  }

  // ===== 坊市与物品 =====

  async _loadItems() {
    const raw = await this.fm.readFile(this.itemsPath);
    if (!raw) return [];
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }

  async getCustomItems() {
    return this._loadItems();
  }

  async getCustomItem(key) {
    const items = await this._loadItems();
    return items.find(i => i.key === key) || null;
  }

  // 落入动态池（sanitize 后；不自动入背包，调用方自行 inventory++）
  async addCustomItem(item) {
    const clean = CultivationManager.sanitizeCustomItem(item);
    if (!clean) return null;
    const items = await this._loadItems();
    const full = {
      ...clean,
      key: clean.key || `cgen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: item.source || 'fortune',
      buyable: item.buyable !== false,
      date: item.date || this._getToday()
    };
    items.unshift(full);
    if (items.length > 40) items.splice(40); // 池上限
    await this.fm.writeFile(this.itemsPath, JSON.stringify(items));
    this._notifyChange();
    return full;
  }

  // 统一物品解析：静态坊市优先，未命中查动态池
  async resolveItem(key) {
    const staticItem = CultivationManager.getShopItem(key);
    if (staticItem) return staticItem;
    return this.getCustomItem(key);
  }

  // LLM 生成道具校验/收敛（纯函数，可单测）：kind 白名单 pill、效果钳制、文本限长
  static sanitizeCustomItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().slice(0, 12);
    if (!name) return null;
    if (raw.kind !== 'pill') return null;
    const num = (v, min, max) => Math.max(min, Math.min(max, Math.round(Number(v) || 0)));
    const item = { name, kind: 'pill', icon: String(raw.icon || '🧧').trim().slice(0, 4) || '🧧' };
    if (raw.effect === 'exp') {
      item.effect = 'exp';
      item.effectValue = num(raw.effectValue, 5, 30) || 10;
    } else if (raw.effect === 'demon') {
      item.effect = 'demon';
      item.effectValue = num(raw.effectValue, -40, 0) || -20;
    } else if (raw.effect === 'heal') {
      item.effect = 'heal';
    } else {
      item.effect = 'exp'; // 默认给修为
      item.effectValue = 10;
    }
    item.price = Math.max(3, Math.min(20, Math.round(Number(raw.price) || 6)));
    if (raw.desc) item.desc = String(raw.desc).trim().slice(0, 40);
    return item;
  }

  // 坊市购买：灵石不足拒绝；突破丹只允许购买当前境界对应的下一颗（高阶丹境界不足拒绝）
  async buy(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'not_started', message: '还未踏上仙途' };
    if (state.dead) return { success: false, reason: 'dead', message: '真灵已入轮回，转世后再来吧' };
    const item = await this.resolveItem(itemKey);
    if (!item) return { success: false, reason: 'unknown_item', message: '未知商品' };
    if (item.buyable === false) return { success: false, reason: 'not_for_sale', message: `${item.name}非坊市所售` };
    if (item.source === 'fortune' || item.source === 'explore') return { success: false, reason: 'not_for_sale', message: `${item.name}是机缘所得，坊市不卖` };
    if (item.breakthrough && item.breakthrough !== state.level + 1) {
      return { success: false, reason: 'pill_locked', message: item.breakthrough <= state.level ? `${item.name}已于你无用` : `境界不足，驾驭不了${item.name}` };
    }
    if ((state.stones || 0) < item.price) {
      return { success: false, reason: 'insufficient_stones', message: `灵石不够（需要 ${item.price}，现有 ${state.stones}）` };
    }
    state.stones -= item.price;
    state.inventory[itemKey] = (state.inventory[itemKey] || 0) + 1;
    this._addLog(state, 'shop', `花 ${item.price} 灵石购得 ${item.icon} ${item.name}`);
    await this._commit(state, this._getToday());
    return { success: true, message: `购得${item.icon} ${item.name}`, state };
  }

  // 使用丹药：exp/demon/heal 三类；突破丹不走这里（由渡劫消耗）
  async useItem(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'not_started', message: '还未踏上仙途' };
    if (state.dead) return { success: false, reason: 'dead', message: '真灵已入轮回，转世后再来吧' };
    const item = await this.resolveItem(itemKey);
    if (!item) return { success: false, reason: 'unknown_item', message: '未知物品' };
    if (item.breakthrough) return { success: false, reason: 'breakthrough_pill', message: `${item.name}用于渡劫：修为圆满后在面板点「渡劫突破」` };
    if ((state.inventory[itemKey] || 0) <= 0) {
      return { success: false, reason: 'no_item', message: `储物袋里没有${item.name}了，去坊市看看？` };
    }
    const today = this._getToday();
    state.inventory[itemKey]--;
    if (item.effect === 'heal') {
      state.injured = 0;
      this._addLog(state, 'item', `${item.icon} 服用了${item.name}，伤势尽愈`);
    } else if (item.effect === 'demon') {
      state.demon = CultivationManager.clampStat(state.demon + (item.effectValue || -20));
      this._addLog(state, 'item', `${item.icon} 服用了${item.name}（心魔 ${item.effectValue}）`);
    } else {
      state.exp += item.effectValue || 10;
      this._addLog(state, 'item', `${item.icon} 服用了${item.name}（修为 +${item.effectValue || 10}）`);
    }
    await this._commit(state, today);
    return { success: true, message: `服用了${item.icon} ${item.name}`, state };
  }

  // ===== 跨天结算（app.js handleDayRollover 步骤 3.10 调用；幂等）=====

  // habitInfo：{ hasHabits, checkinCount, allDone }（昨日习惯遵守情况，由 app.js 从 habit-checkins 统计）
  // 返回 { changed, demonBursted }
  async tickDaily(yesterdayDate, habitInfo = {}) {
    const state = await this._loadState();
    if (!state) return { changed: false, demonBursted: false };
    if (state.lastTickDate === yesterdayDate) {
      return { changed: false, demonBursted: false }; // 幂等
    }
    state.lastTickDate = yesterdayDate;
    let demonBursted = false;

    if (state.dead) {
      await this._saveState(state); // 身死态冻结，仅推进 lastTickDate
      return { changed: false, demonBursted };
    }

    // 伤势倒计时
    if (state.injured > 0) state.injured--;

    // 断签 reconciliation（v3.30.3：连续活跃=任意修行行为日；昨日与今日皆无修行 → 清零，与习惯打卡解耦）
    if (state.lastActiveDate && state.lastActiveDate < yesterdayDate) {
      if (state.streak > 0) this._addLog(state, 'mind', `数日未有修行，连续活跃归零（此前 ${state.streak} 天）`);
      state.streak = 0;
    }

    // 道心/心魔：按昨日习惯遵守结算（无习惯数据则不奖不罚）
    if (habitInfo.hasHabits) {
      const checkins = habitInfo.checkinCount || 0;
      if (habitInfo.allDone) {
        state.allDoneStreak = (state.allDoneStreak || 0) + 1;
        state.partialStreak = 0;
        if (state.allDoneStreak >= 2) {
          state.demon = CultivationManager.clampStat(state.demon + CultivationManager.DEMON_TWO_DAY_CLEAR);
        }
      } else {
        state.allDoneStreak = 0;
        if (checkins > 0) {
          state.partialStreak = (state.partialStreak || 0) + 1;
          const inc = this._demonInc(state, state.partialStreak >= 2 ? CultivationManager.DEMON_PARTIAL_STREAK : CultivationManager.DEMON_PER_PARTIAL);
          state.demon = CultivationManager.clampStat(state.demon + inc);
          this._addLog(state, 'demon', `昨日习惯未全达标，心魔 +${inc}（破戒滋生心魔，坚持全达标可化解）`);
        } else {
          state.partialStreak = 0;
          const inc = this._demonInc(state, CultivationManager.DEMON_PER_PARTIAL);
          state.mind = CultivationManager.clampStat(state.mind + CultivationManager.MIND_MISS_DAY);
          state.demon = CultivationManager.clampStat(state.demon + inc);
          this._addLog(state, 'mind', `昨日完全断签，道心 ${CultivationManager.MIND_MISS_DAY}、心魔 +${inc}`);
        }
      }
      // 道心低迷 → 心魔滋生
      if (state.mind < CultivationManager.DEMON_TRANCE) {
        const inc = this._demonInc(state, CultivationManager.DEMON_PER_PARTIAL);
        state.demon = CultivationManager.clampStat(state.demon + inc);
        this._addLog(state, 'demon', `道心低迷（${state.mind}），心魔暗长 +${inc}`);
      }
    }

    // 心魔爆发判定
    if (this._resolveDemonBurst(state)) demonBursted = true;

    await this._commit(state, yesterdayDate);
    return { changed: true, demonBursted };
  }

  // ===== 日志 =====

  _addLog(state, type, text, logDate = null) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    state.log.push({ date: logDate || this._getToday(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, type, text });
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60);
  }

  // 生成单日 MD（纯函数，可单测）
  static buildDayMd(date, logs) {
    const lines = [`---`, `date: ${date}`, `---`, ``];
    if (!logs || logs.length === 0) {
      lines.push(`（今日暂无修行动态）`, ``);
      return lines.join('\n');
    }
    lines.push(`## 修行动态`, ``);
    for (const l of logs) {
      lines.push(`- ${l.time} ${l.text}`);
    }
    lines.push(``, `> 修行日志由系统自动生成（AI 只读）。修行状态见 .meta/cultivation-state.json`, ``);
    return lines.join('\n');
  }

  async _writeDayMd(date) {
    const path = `cultivation/${date}.md`;
    const state = await this._loadState();
    const logs = state ? state.log.filter(l => l.date === date) : [];
    if (logs.length === 0) {
      await this.fm.deleteFile(path).catch(() => {});
      return;
    }
    await this.fm.writeFile(path, CultivationManager.buildDayMd(date, logs));
  }

  // ===== 生平档案（v3.28.0：每一世一个文档，LLM 每日结算续写完善）=====

  // 当前世文档路径（纯函数）：第 N 世 = reincarnations + 1
  static lifeDocPath(state) {
    return `cultivation/life-${(state.reincarnations || 0) + 1}.md`;
  }

  // 初始生平文档（家世/灵根 + 空的分段骨架，LLM 逐日填充）
  static buildInitialLifeDoc(state, today) {
    const root = CultivationManager.rootDef(state.root);
    const apt = CultivationManager.aptitudeDef(state.aptitude);
    const bg = state.background || { text: '这一世，你出身凡俗，机缘巧合踏上仙途。', perk: null };
    const lines = [
      `# 第${(state.reincarnations || 0) + 1}世 · ${state.daoName} 修仙传`,
      ``,
      `- 道号：${state.daoName}`,
      `- 灵根：${root.label}·${apt.label}`,
      `- 家世：${bg.text}${bg.perk ? `（${CultivationManager.BACKGROUND_PERK_LABELS[bg.perk]}）` : ''}`,
      `- 生于：${today}`
    ];
    if ((state.reincarnations || 0) > 0) {
      lines.push(`- 前世：第 ${state.reincarnations} 世身死道消，真灵转世，资质随灵根继承，悟性更进一层`);
    }
    lines.push(``, `## 修行纪事`, ``, `## 人物与因果`, ``, `## 心境感悟`, ``);
    return lines.join('\n');
  }

  // 读取当前世生平文档（无状态返回 null）
  async getLifeDoc() {
    const state = await this._loadState();
    if (!state) return null;
    const path = CultivationManager.lifeDocPath(state);
    return { path, text: (await this.fm.readFile(path)) || '' };
  }

  // 写入当前世生平文档（LLM 续写后的全文落盘；v3.30.0 上限 4000→6000，给小说连载留空间）
  async saveLifeDoc(text) {
    const state = await this._loadState();
    if (!state || !text) return false;
    await this.fm.writeFile(CultivationManager.lifeDocPath(state), String(text).slice(0, 6000));
    this._notifyChange();
    return true;
  }

  // 身死落笔：在当世文档末尾记下卒于（渡劫失败那一刻）
  async _finalizeLifeDoc(state, realmName, today) {
    const path = CultivationManager.lifeDocPath(state);
    const existing = (await this.fm.readFile(path)) || CultivationManager.buildInitialLifeDoc(state, today);
    const closing = `\n> ☠️ 卒于 ${today}：渡${realmName}劫失败，天雷灭体，真灵遁入轮回。\n`;
    await this.fm.writeFile(path, existing.replace(/\n+$/, '\n') + closing);
  }

  // ===== 摘要 =====

  // 一行摘要（AI 系统提示词注入）：☯ 青崖（水灵根·灵品）炼气期 修为30/80 ｜ 灵石50 ｜ 道心65 心魔10 ｜ 连续3天 速度+11% ｜ 第2世
  async summaryLine() {
    const state = await this._loadState();
    if (!state) return null;
    const root = CultivationManager.rootDef(state.root);
    const apt = CultivationManager.aptitudeDef(state.aptitude);
    const realm = CultivationManager.realmOfState(state);
    const speed = CultivationManager.speedMultiplier(state);
    const speedPct = `${speed >= 1 ? '+' : ''}${Math.round((speed - 1) * 100)}%`;
    const status = state.dead ? '身死道消（待转世）'
      : state.demon >= CultivationManager.DEMON_BURST ? '心魔爆发中'
      : state.injured > 0 ? `重伤中（${state.injured} 天，收益减半）` : '修行如常';
    const expText = realm.nextExp === null ? '金仙圆满' : `修为${state.exp}/${realm.nextExp}`;
    let line = `☯ ${state.daoName}（${root.icon}${root.label}·${apt.label}）第${realm.level}境·${realm.name}${realm.subName} ${expText} ｜ 灵石${state.stones} ｜ 道心${state.mind} 心魔${state.demon} ｜ ${status} ｜ 修行速度${speedPct}`;
    if (state.streak > 0) line += ` ｜ 连续活跃 ${state.streak} 天`;
    if ((state.reincarnations || 0) > 0) line += ` ｜ 第 ${state.reincarnations + 1} 世`;
    const bt = await this.getBreakthroughInfo();
    if (bt && bt.full && !bt.maxed) line += ` ｜ 修为圆满，可渡劫突破${bt.pill && bt.pill.have ? '' : '（需' + (bt.pill ? bt.pill.name : '突破丹') + '）'}`;
    return line;
  }

  // ===== 工具方法 =====

  _getToday() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  _shiftDate(date, delta) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  _notifyChange() {
    if (this.onChangeCallback) {
      try {
        this.onChangeCallback();
      } catch (e) {
        console.error('[CultivationManager] onChange error:', e);
      }
    }
  }

  // 提取 LLM 回复中的 JSON 对象（纯函数，可单测）：容错 code fence 与前后杂文
  static extractJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      const obj = JSON.parse(t.slice(start, end + 1));
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
    } catch {
      return null;
    }
  }
}
