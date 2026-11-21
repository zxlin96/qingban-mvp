// pet-manager.js
// 虚拟宠物养成模块（对标 QQ 宠物）— 状态四维/行为奖励/轻币商店/成长等级/跨天衰减与生病
// 存储：IndexedDB（.meta/pet-state.json 单文件），AI 可读日志 pet/YYYY-MM-DD.md 由系统自动生成
// 设计定位：宠物 = 减肥行为的情感激励层。打卡/记饮食/运动/称重 → 实时奖励（轻币/物品掉落/exp/状态加成）；
//           跨天结算统一衰减 + 生病判定；连续生病 7 天不管 → 离家出走（不死，接回家即恢复）。
//           所有互动/购买在出走态下拒绝（reason: 'ran_away'）。
//           旅行玩法（v3.24.0，旅行青蛙式）：Lv.5 解锁 → 收拾行李（食物定时长）→ 跨天出发（随机目的地）
//           → 旅行中暂停衰减、随机寄明信片 → 归期回家结算（特产 + 行为达标加成）。明信片独立存
//           .meta/pet-postcards.json（文案由跨天结算的 LLM 生成，失败降级模板）。

const PET_STATE_PATH = '.meta/pet-state.json';

export class PetManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.statePath = PET_STATE_PATH;
    this.postcardsPath = '.meta/pet-postcards.json'; // 明信片（滚动保留）
    this.itemsPath = '.meta/pet-items.json'; // 动态物品池（v3.26.0：LLM 生成的每日特供/AI 制作/旅行特产）
    this.onChangeCallback = null; // 数据变化时通知 UI 刷新
  }

  // ===== 静态常量（数值调参集中在此）=====

  // 物种表（首次引导四选一）
  static SPECIES = [
    { key: 'chick', label: '小鸡', icon: '🐤' },
    { key: 'penguin', label: '企鹅', icon: '🐧' },
    { key: 'hamster', label: '仓鼠', icon: '🐹' },
    { key: 'cat', label: '小猫', icon: '🐱' }
  ];

  static speciesDef(key) {
    return PetManager.SPECIES.find(s => s.key === key) || PetManager.SPECIES[0];
  }

  // 等级表：LEVELS[i] 为升到 Lv(i+1) 所需 exp；等级名对应减肥旅程阶段
  static LEVELS = [0, 30, 80, 160, 280, 450, 700, 1050, 1550, 2200];
  static LEVEL_NAMES = ['破壳', '蹒跚', '活泼', '元气', '轻盈', '健步', '活力', '健将', '传奇', '传说'];

  // 由 exp 计算等级信息（纯函数）：{ level, name, nextExp, progress }
  // progress 为 0-1 的当前等级内进度；满级 nextExp=null、progress=1
  static levelOf(exp) {
    const levels = PetManager.LEVELS;
    let lv = 1;
    for (let i = 0; i < levels.length; i++) {
      if (exp >= levels[i]) lv = i + 1;
    }
    const nextExp = lv < levels.length ? levels[lv] : null;
    const base = levels[lv - 1];
    const progress = nextExp === null ? 1 : Math.min(1, Math.max(0, (exp - base) / (nextExp - base)));
    return { level: lv, name: PetManager.LEVEL_NAMES[lv - 1], nextExp, progress };
  }

  // 轻币商店（全部为消耗品；玩具/清洁/药品共用 useItem；onlyTravel 为旅行限定特产，商店不售）
  static SHOP = [
    { key: 'apple', kind: 'food', icon: '🍎', name: '苹果', price: 3, hunger: 15, mood: 2 },
    { key: 'carrot', kind: 'food', icon: '🥕', name: '胡萝卜', price: 3, hunger: 15, mood: 2 },
    { key: 'riceball', kind: 'food', icon: '🍙', name: '饭团', price: 6, hunger: 30, mood: 4 },
    { key: 'cake', kind: 'food', icon: '🍰', name: '蛋糕', price: 10, hunger: 25, mood: 12 },
    { key: 'bento', kind: 'food', icon: '🍱', name: '大餐', price: 15, hunger: 50, mood: 15 },
    { key: 'yarn', kind: 'toy', icon: '🧶', name: '毛线球', price: 8, mood: 15 },
    { key: 'ball', kind: 'toy', icon: '⚽', name: '皮球', price: 10, mood: 20 },
    { key: 'soap', kind: 'care', icon: '🧼', name: '香皂', price: 5, clean: 30 },
    { key: 'bath', kind: 'care', icon: '🛁', name: '泡泡浴', price: 12, clean: 60, mood: 5 },
    { key: 'medicine', kind: 'care', icon: '💊', name: '感冒药', price: 12, heal: true },
    { key: 'dango', kind: 'food', icon: '🍡', name: '三色团子', price: 8, hunger: 20, mood: 8, onlyTravel: true },
    { key: 'tea', kind: 'food', icon: '🍵', name: '高山茶', price: 8, hunger: 10, mood: 10, onlyTravel: true },
    { key: 'windchime', kind: 'toy', icon: '🎐', name: '风铃', price: 12, mood: 18, onlyTravel: true },
    { key: 'stone', kind: 'toy', icon: '🪨', name: '纪念石', price: 10, mood: 10, onlyTravel: true }
  ];

  static getItem(key) {
    return PetManager.SHOP.find(i => i.key === key) || null;
  }

  // 行为奖励表：coins=轻币 exp=成长值 hunger/clean/mood=状态加成 drop=物品掉落
  static REWARDS = {
    checkin: { coins: 2, mood: 5, exp: 8, drop: 'apple' },
    meal: { coins: 2, hunger: 10, exp: 5 },
    exercise: { coins: 5, mood: 10, exp: 10, clean: -10, drop: 'carrot' },
    weight: { coins: 5, exp: 15 },
    allDone: { coins: 5, mood: 10 },
    milestone: { exp: 30 }, // 币按 streak 档另发
    freePlay: { mood: 4 }   // 免费互动（每日限次）
  };

  // streak 里程碑档位 → 轻币奖励
  static MILESTONE_COINS = { 7: 10, 21: 20, 50: 50, 100: 100 };
  static FREE_PLAY_DAILY_LIMIT = 3; // 免费互动每日次数
  static MEAL_DAILY_LIMIT = 3;      // 三餐奖励每日次数

  static milestoneCoins(streak) {
    return PetManager.MILESTONE_COINS[streak] || 0;
  }

  // 跨天自然衰减（行为奖励是实时发放的，已对冲衰减）
  static DECAY = { hunger: -28, clean: -22, mood: -14 };

  // 生病阈值：结算后 hunger 低于此值（低水位持续 2 天）或 clean 低于此值 → 生病
  static SICK_HUNGER_BELOW = 20;
  static SICK_CLEAN_BELOW = 15;
  static SICK_LOW_DAYS = 2;       // 低水位连续天数 → 生病
  static SICK_HEALTH_DROP = 20;   // 生病期间每日健康流失
  static SICK_RUNAWAY_DAYS = 7;   // 连续生病天数 → 离家出走
  static COMEBACK_STATS = { hunger: 40, clean: 40, mood: 40, health: 60 }; // 接回家恢复值

  // ===== 旅行（v3.24.0 旅行青蛙式）=====
  // 解锁：Lv.5「轻盈」；装行李（食物定时长）→ 跨天出发 → 旅行中暂停衰减、随机寄明信片 → 归期回家结算
  static TRAVEL_UNLOCK_LEVEL = 5;
  static POSTCARD_CHANCE = 0.6;    // 旅行中每天寄明信片的概率
  static POSTCARD_MAX = 30;        // 明信片滚动保留上限

  // 旅行目的地表（跨天出发时随机）
  static DESTINATIONS = [
    { key: 'park', name: '城市公园', icon: '🌳', hint: '草地、长椅和遛弯的人' },
    { key: 'seaside', name: '海边', icon: '🌊', hint: '浪花、贝壳和咸咸的风' },
    { key: 'mountain', name: '山顶', icon: '⛰️', hint: '云海、日出和一路的石阶' },
    { key: 'ancient', name: '古镇', icon: '🏮', hint: '石板路、小桥和冒着热气的点心铺' },
    { key: 'sunflower', name: '向日葵田', icon: '🌻', hint: '一整片金黄，蜜蜂嗡嗡地飞' },
    { key: 'ricefield', name: '稻田', icon: '🌾', hint: '稻香、蛙声和慢慢转动的风车' },
    { key: 'hotspring', name: '山间温泉', icon: '♨️', hint: '雾气、温泉蛋和泡得通红的脸' },
    { key: 'greenway', name: '骑行绿道', icon: '🚴', hint: '林荫、下坡的风和一队列的骑友' },
    { key: 'trail', name: '登山步道', icon: '🥾', hint: '台阶、蝉鸣和半山亭子' },
    { key: 'market', name: '老街市集', icon: '🎏', hint: '吆喝声、糖画和琳琅的小摊' }
  ];

  static getDestination(key) {
    return PetManager.DESTINATIONS.find(d => d.key === key) || PetManager.DESTINATIONS[0];
  }

  // 旅行限定特产 key 集合（回家随机带回 1-2 件）
  static TRAVEL_SOUVENIRS = ['dango', 'tea', 'windchime', 'stone'];

  static isTravelUnlockedState(state) {
    return !!(state && PetManager.levelOf(state.exp).level >= PetManager.TRAVEL_UNLOCK_LEVEL);
  }

  // 行李件数 → 旅行天数（纯函数，r 为外部传入的随机数便于单测）：1 件 1-2 天，2 件以上 2-3 天
  static rollTripDays(bagCount, r) {
    const rr = (r === undefined || r === null) ? Math.random() : r;
    if (bagCount >= 2) return rr < 0.5 ? 2 : 3;
    return rr < 0.6 ? 1 : 2;
  }

  // 当日是否寄明信片（纯函数，r 可注入）：概率 POSTCARD_CHANCE
  static rollPostcard(r) {
    const rr = (r === undefined || r === null) ? Math.random() : r;
    return rr < PetManager.POSTCARD_CHANCE;
  }

  // 目的地随机（纯函数，r 可注入）
  static pickDestination(r) {
    const rr = (r === undefined || r === null) ? Math.random() : r;
    return PetManager.DESTINATIONS[Math.min(PetManager.DESTINATIONS.length - 1, Math.floor(rr * PetManager.DESTINATIONS.length))];
  }

  // 明信片降级模板文案（LLM 失败时用）
  static buildPostcardTemplate(destKey, tripDay, allDone) {
    const dest = PetManager.getDestination(destKey);
    const pre = allDone ? '听说你昨天全都做到了，真棒！' : '';
    const bodies = {
      1: `今天到了${dest.name}，${dest.hint}。你也要记得按时吃饭呀。`,
      2: `在${dest.name}走了好多路，${dest.hint}。有点想你了，回去给你讲这里的事。`,
      3: `要准备回家啦！${dest.name}的${dest.hint}都看遍了，给你带了点东西。`
    };
    return `${pre}${bodies[tripDay] || bodies[2]}`;
  }

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
      return (d && d.name) ? d : null; // 缺 name 视为损坏，走重新创建
    } catch {
      return null;
    }
  }

  async _saveState(state) {
    await this.fm.writeFile(this.statePath, JSON.stringify(state));
  }

  // 写状态 + 重建当日日志 MD + 通知 UI（logDate：事件归属日期，跨天结算传昨日）
  async _commit(state, logDate) {
    state.level = PetManager.levelOf(state.exp).level; // level 以 exp 计算为准
    await this._saveState(state);
    try {
      await this._writeDayMd(logDate || this._getToday());
    } catch (e) {
      console.warn('[PetManager] 写日志失败:', e.message);
    }
    this._notifyChange();
  }

  // ===== 首次创建 =====

  // 无宠物返回 null（UI 走首次引导）；有宠物返回状态
  async ensureCreated() {
    return this._loadState();
  }

  async createPet(species, name) {
    const existing = await this._loadState();
    if (existing) return { state: existing, created: false };
    const def = PetManager.speciesDef(species);
    const today = this._getToday();
    const state = {
      version: 1,
      createdAt: new Date().toISOString(),
      name: (String(name || '').trim() || '球球').slice(0, 8),
      species: def.key,
      exp: 0,
      level: 1,
      coins: 10, // 开局轻币，够买首个物品引导商店体验
      stats: { hunger: 80, clean: 80, mood: 80, health: 100 },
      sick: false,
      sickSince: null,
      lowSince: null, // 饿/脏低水位起始日（连续 2 天 → 生病）
      ranAway: false,
      lastTickDate: null,
      inventory: {},
      behavior: this._freshBehavior(today),
      travel: this._freshTravel(),
      diary: null, // 今日心声 { date, text }（v3.25.0 LLM 生成，宁缺毋滥）
      hideFloat: false,
      log: []
    };
    this._addLog(state, 'birth', `${def.icon} ${state.name}（${def.label}）来到你身边啦`);
    await this._commit(state, today);
    return { state, created: true };
  }

  async getState() {
    return this._loadState();
  }

  // ===== 行为奖励（app.js 挂接入口；当日去重）=====

  _freshBehavior(today) {
    return { date: today, checkins: {}, meals: 0, weights: 0, freePlays: 0, crafts: 0, allDone: false, milestoneStreaks: {} };
  }

  _ensureBehaviorDay(state, today) {
    if (!state.behavior || state.behavior.date !== today) {
      state.behavior = this._freshBehavior(today);
    }
  }

  // 打卡奖励：每习惯每日首次；allDone=当日全部习惯达标（一次性）；streak=该习惯当前连续天数（里程碑奖励）
  // 一次调用可能连发多段奖励（打卡+全达标+里程碑），levelUp 取各段中的最高升级结果
  async onCheckin(habitId, { allDone = false, streak = 0 } = {}) {
    const state = await this._loadState();
    if (!state || state.ranAway) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    let rewarded = false;
    let coins = 0;
    let levelUp = null;
    if (habitId && !state.behavior.checkins[habitId]) {
      state.behavior.checkins[habitId] = 1;
      this._applyReward(state, 'checkin');
      coins += this._lastReward.coins;
      levelUp = this._lastReward.levelUp || levelUp;
      rewarded = true;
    }
    if (allDone && !state.behavior.allDone) {
      state.behavior.allDone = true;
      this._applyReward(state, 'allDone');
      coins += this._lastReward.coins;
      levelUp = this._lastReward.levelUp || levelUp;
      rewarded = true;
    }
    const milestoneCoins = PetManager.milestoneCoins(streak);
    if (milestoneCoins > 0 && !state.behavior.milestoneStreaks[streak]) {
      state.behavior.milestoneStreaks[streak] = 1;
      this._applyReward(state, 'milestone', milestoneCoins);
      this._addLog(state, 'milestone', `🏆 连续 ${streak} 天里程碑！+${milestoneCoins} 轻币、成长 +30`);
      coins += this._lastReward.coins;
      levelUp = this._lastReward.levelUp || levelUp;
      rewarded = true;
    }
    if (!rewarded) return null;
    await this._commit(state, today);
    return { type: 'checkin', coins, exp: 0, drop: null, levelUp };
  }

  // 三餐记录奖励：每日最多 3 次
  async onMeal() {
    const state = await this._loadState();
    if (!state || state.ranAway) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if (state.behavior.meals >= PetManager.MEAL_DAILY_LIMIT) return null;
    state.behavior.meals++;
    this._applyReward(state, 'meal');
    await this._commit(state, today);
    return this._lastReward;
  }

  // 运动奖励：不限次（每次运动都算）
  async onExercise() {
    const state = await this._loadState();
    if (!state || state.ranAway) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    this._applyReward(state, 'exercise');
    await this._commit(state, today);
    return this._lastReward;
  }

  // 称重奖励：每日一次
  async onWeight() {
    const state = await this._loadState();
    if (!state || state.ranAway) return null;
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if (state.behavior.weights >= 1) return null;
    state.behavior.weights++;
    this._applyReward(state, 'weight');
    await this._commit(state, today);
    return this._lastReward;
  }

  // 奖励发放（纯逻辑）：coins/exp/状态 clamp/掉落入包/日志/升级检测；结果存 this._lastReward
  _applyReward(state, type, extraCoins = 0) {
    const r = PetManager.REWARDS[type];
    if (!r) return;
    const before = PetManager.levelOf(state.exp).level;
    if (r.coins || extraCoins) state.coins = (state.coins || 0) + (r.coins || 0) + extraCoins;
    if (r.exp) state.exp = (state.exp || 0) + r.exp;
    for (const k of ['hunger', 'clean', 'mood']) {
      if (typeof r[k] === 'number') state.stats[k] = PetManager.clampStat(state.stats[k] + r[k]);
    }
    if (r.drop) {
      state.inventory[r.drop] = (state.inventory[r.drop] || 0) + 1;
      const item = PetManager.getItem(r.drop);
      this._addLog(state, 'reward', `掉落 ${item.icon} ${item.name}×1`);
    }
    // 当日奖励聚合（v3.25.0）：AI 经 pet_status 读取后可自然播报；跨日自动重置
    const today = this._getToday();
    if (!state.rewardsToday || state.rewardsToday.date !== today) {
      state.rewardsToday = { date: today, coins: 0, exp: 0, drops: [] };
    }
    state.rewardsToday.coins += (r.coins || 0) + (extraCoins || 0);
    state.rewardsToday.exp += r.exp || 0;
    if (r.drop) state.rewardsToday.drops.push(r.drop);
    const texts = {
      checkin: `打卡奖励：+${r.coins} 轻币、心情 +${r.mood}`,
      meal: `好好吃饭奖励：+${r.coins} 轻币、饱食 +${r.hunger}`,
      exercise: `运动奖励：+${r.coins} 轻币、心情 +${r.mood}（出汗了，清洁 -10）`,
      weight: `称重奖励：+${r.coins} 轻币、成长 +${r.exp}`,
      allDone: `今日习惯全达标：+${r.coins} 轻币、心情 +${r.mood}`,
      milestone: `里程碑奖励：+${extraCoins} 轻币、成长 +${r.exp}`,
      freePlay: `摸摸头：心情 +${r.mood}`
    };
    this._addLog(state, 'reward', texts[type] || type);
    const after = PetManager.levelOf(state.exp).level;
    if (after > before) {
      this._addLog(state, 'levelup', `🎉 升到 Lv.${after}（${PetManager.LEVEL_NAMES[after - 1]}）`);
    }
    this._lastReward = { type, coins: (r.coins || 0) + extraCoins, exp: r.exp || 0, drop: r.drop || null, levelUp: after > before ? after : null };
  }

  // ===== 互动（消耗背包物品）=====

  // 使用物品：food→喂食、toy→玩耍、care soap/bath→清洁、medicine→治病
  // 出走态拒绝；生病时喂食/玩耍收益减半（没胃口/没精神），治病必须用药
  async useItem(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (state.ranAway) return { success: false, reason: 'ran_away', message: `${state.name} 出走了，先接它回家吧` };
    if (state.travel && state.travel.status === 'traveling') return { success: false, reason: 'traveling', message: `${state.name} 正在旅行中，等它回家吧` };
    const item = await this.resolveItem(itemKey); // 静态表优先，未命中查动态物品池（v3.26.0）
    if (!item) return { success: false, reason: 'unknown_item', message: '未知物品' };
    if ((state.inventory[itemKey] || 0) <= 0) {
      return { success: false, reason: 'no_item', message: `背包里没有${item.name}了，去商店看看？` };
    }
    const today = this._getToday();
    const s = state.stats;

    if (item.heal) {
      if (!state.sick) return { success: false, reason: 'not_sick', message: `${state.name} 没有生病，不用吃药` };
      state.inventory[itemKey]--;
      state.sick = false;
      state.sickSince = null;
      state.lowSince = null;
      s.health = PetManager.clampStat(s.health + 50);
      this._addLog(state, 'care', `${item.icon} 吃了${item.name}，病好多了（健康 +50）`);
      await this._commit(state, today);
      return { success: true, message: `${state.name} 吃了${item.name}，病好多了！`, state };
    }

    if (item.kind === 'food') {
      if (s.hunger >= 100) return { success: false, reason: 'not_hungry', message: `${state.name} 已经很饱了` };
      state.inventory[itemKey]--;
      const factor = state.sick ? 0.5 : 1;
      s.hunger = PetManager.clampStat(s.hunger + item.hunger * factor);
      if (item.mood) s.mood = PetManager.clampStat(s.mood + item.mood * factor);
      this._addLog(state, 'care', `${item.icon} 吃了${item.name}（饱食 +${Math.round(item.hunger * factor)}）`);
    } else if (item.kind === 'toy') {
      if (s.mood >= 100) return { success: false, reason: 'not_bored', message: `${state.name} 已经很开心了` };
      state.inventory[itemKey]--;
      const gain = state.sick ? Math.round(item.mood / 2) : item.mood;
      s.mood = PetManager.clampStat(s.mood + gain);
      this._addLog(state, 'care', `${item.icon} 玩了${item.name}（心情 +${gain}）`);
    } else if (item.clean) {
      if (s.clean >= 100) return { success: false, reason: 'not_dirty', message: `${state.name} 已经很干净了` };
      state.inventory[itemKey]--;
      s.clean = PetManager.clampStat(s.clean + item.clean);
      if (item.mood) s.mood = PetManager.clampStat(s.mood + item.mood);
      this._addLog(state, 'care', `${item.icon} ${item.name}（清洁 +${item.clean}）`);
    } else {
      return { success: false, reason: 'unknown_item', message: '这个物品不知道怎么用' };
    }
    await this._commit(state, today);
    return { success: true, message: `用了${item.icon} ${item.name}`, state };
  }

  // 免费互动"摸摸头"：每日 FREE_PLAY_DAILY_LIMIT 次，每次心情小幅回升
  async freePlay() {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (state.ranAway) return { success: false, reason: 'ran_away', message: `${state.name} 出走了，先接它回家吧` };
    if (state.travel && state.travel.status === 'traveling') return { success: false, reason: 'traveling', message: `${state.name} 正在旅行中，摸不到它啦` };
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if (state.behavior.freePlays >= PetManager.FREE_PLAY_DAILY_LIMIT) {
      return { success: false, reason: 'limit_reached', message: `今天已经摸过 ${PetManager.FREE_PLAY_DAILY_LIMIT} 次啦，明天再来` };
    }
    state.behavior.freePlays++;
    state.stats.mood = PetManager.clampStat(state.stats.mood + PetManager.REWARDS.freePlay.mood);
    this._addLog(state, 'care', `被摸了摸头（心情 +${PetManager.REWARDS.freePlay.mood}）`);
    await this._commit(state, today);
    return { success: true, message: `${state.name} 被摸了摸头，很开心`, state };
  }

  // 商店购买：轻币不足拒绝（reason: 'insufficient_coins'）
  async buy(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (state.ranAway) return { success: false, reason: 'ran_away', message: `${state.name} 出走了，先接它回家吧` };
    const item = await this.resolveItem(itemKey); // 静态表优先，未命中查动态物品池（v3.26.0）
    if (!item) return { success: false, reason: 'unknown_item', message: '未知商品' };
    if (item.onlyTravel) return { success: false, reason: 'not_for_sale', message: `${item.name}是旅行限定特产，商店不卖哦` };
    if (item.buyable === false) return { success: false, reason: 'not_for_sale', message: `${item.name}不可购买` };
    if (item.source === 'daily' && item.date && PetManager.daysBetween(item.date, this._getToday()) > 2) {
      return { success: false, reason: 'off_shelf', message: `${item.name} 已下架（特供只上架 3 天）` };
    }
    if ((state.coins || 0) < item.price) {
      return { success: false, reason: 'insufficient_coins', message: `轻币不够（需要 ${item.price}，现有 ${state.coins}）` };
    }
    state.coins -= item.price;
    state.inventory[itemKey] = (state.inventory[itemKey] || 0) + 1;
    this._addLog(state, 'shop', `花 ${item.price} 轻币买了 ${item.icon} ${item.name}`);
    await this._commit(state, this._getToday());
    return { success: true, message: `买到了${item.icon} ${item.name}`, state };
  }

  // ===== 旅行（v3.24.0 旅行青蛙式）=====

  _freshTravel() {
    return { status: 'home', bag: {}, departDate: null, days: null, destination: null, tripLog: [] };
  }

  // 容错取旅行字段：v3.23.0 老存档无 travel 字段时自动补齐（免迁移）
  _travelOf(state) {
    if (!state.travel || typeof state.travel !== 'object') state.travel = this._freshTravel();
    if (!state.travel.bag) state.travel.bag = {};
    if (!Array.isArray(state.travel.tripLog)) state.travel.tripLog = [];
    return state.travel;
  }

  _bagCount(travel) {
    return Object.values(travel.bag || {}).reduce((a, b) => a + (b || 0), 0);
  }

  // 装行李：从背包把食物移入宠物行李包；装入即 ready（下次跨天出发）
  async packBag(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (state.ranAway) return { success: false, reason: 'ran_away', message: `${state.name} 出走了，先接它回家吧` };
    if (!PetManager.isTravelUnlockedState(state)) {
      return { success: false, reason: 'locked', message: `升到 Lv.${PetManager.TRAVEL_UNLOCK_LEVEL}（${PetManager.LEVEL_NAMES[PetManager.TRAVEL_UNLOCK_LEVEL - 1]}）就解锁旅行啦` };
    }
    const travel = this._travelOf(state);
    if (travel.status === 'traveling') return { success: false, reason: 'traveling', message: `${state.name} 正在旅行中，回来再收拾吧` };
    const item = await this.resolveItem(itemKey); // 静态表优先，未命中查动态物品池（v3.26.0）
    if (!item) return { success: false, reason: 'unknown_item', message: '未知物品' };
    if (item.kind !== 'food') return { success: false, reason: 'not_food', message: '行李只能装食物（便当才走得远）' };
    if ((state.inventory[itemKey] || 0) <= 0) return { success: false, reason: 'no_item', message: `背包里没有${item.name}了` };
    state.inventory[itemKey]--;
    travel.bag[itemKey] = (travel.bag[itemKey] || 0) + 1;
    travel.status = 'ready';
    this._addLog(state, 'travel', `🎒 把${item.icon} ${item.name}装进了行李`);
    await this._commit(state, this._getToday());
    return { success: true, message: `装好了${item.icon} ${item.name}，行李就绪`, bagCount: this._bagCount(travel), state };
  }

  // 取出行李（取空自动回 home）
  async unpackBag(itemKey) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    const travel = this._travelOf(state);
    if (travel.status === 'traveling') return { success: false, reason: 'traveling', message: `${state.name} 正在旅行中` };
    if ((travel.bag[itemKey] || 0) <= 0) return { success: false, reason: 'no_item', message: '行李里没有这件东西' };
    const item = PetManager.getItem(itemKey);
    travel.bag[itemKey]--;
    if (travel.bag[itemKey] <= 0) delete travel.bag[itemKey];
    if (item) state.inventory[itemKey] = (state.inventory[itemKey] || 0) + 1;
    if (this._bagCount(travel) === 0) travel.status = 'home';
    this._addLog(state, 'travel', `从行李里取出了${item ? `${item.icon} ${item.name}` : itemKey}`);
    await this._commit(state, this._getToday());
    return { success: true, message: `取出了${item ? item.name : itemKey}`, bagCount: this._bagCount(travel), state };
  }

  // 旅行状态摘要（UI / AI pet_status / pet_travel 共用）
  async getTravelStatus() {
    const state = await this._loadState();
    if (!state) return null;
    const travel = this._travelOf(state);
    const dest = travel.destination ? PetManager.getDestination(travel.destination) : null;
    const tripDay = travel.status === 'traveling' && travel.departDate
      ? PetManager.daysBetween(travel.departDate, this._getToday())
      : null;
    return {
      unlocked: PetManager.isTravelUnlockedState(state),
      unlockLevel: PetManager.TRAVEL_UNLOCK_LEVEL,
      status: travel.status,
      destination: dest ? { key: dest.key, name: dest.name, icon: dest.icon } : null,
      tripDay,
      tripDays: travel.days,
      bag: { ...travel.bag },
      bagCount: this._bagCount(travel),
      postcardCount: (await this.getPostcards()).length
    };
  }

  // ===== 明信片（.meta/pet-postcards.json，滚动保留 POSTCARD_MAX 张）=====

  async _loadPostcards() {
    const raw = await this.fm.readFile(this.postcardsPath);
    if (!raw) return [];
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }

  async getPostcards() {
    return this._loadPostcards();
  }

  // 新明信片插到最前；返回保存的卡片
  async addPostcard({ destination, icon, text, date }) {
    const list = await this._loadPostcards();
    const card = {
      id: `postcard-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: date || this._getToday(),
      destination,
      icon,
      text: String(text || '').trim()
    };
    list.unshift(card);
    if (list.length > PetManager.POSTCARD_MAX) list.splice(PetManager.POSTCARD_MAX);
    await this.fm.writeFile(this.postcardsPath, JSON.stringify(list));
    this._notifyChange();
    return card;
  }

  // ===== 跨天结算（app.js handleDayRollover 调用；幂等）=====

  // 返回 { changed, becameSick, ranAway, departed, postcardIntent, returned, travelSummary }
  // postcardIntent：{ destination, tripDay, tripDays, allDone } — 明信片文案由 app.js 调 LLM 生成（失败降级模板）
  async tickDaily(yesterdayDate) {
    const state = await this._loadState();
    if (!state) return { changed: false, becameSick: false, ranAway: false, departed: false, returned: false, postcardIntent: null, travelSummary: null };
    if (state.lastTickDate === yesterdayDate) {
      return { changed: false, becameSick: false, ranAway: false, departed: false, returned: false, postcardIntent: null, travelSummary: null }; // 幂等：断点续跑不重复衰减
    }
    state.lastTickDate = yesterdayDate;
    const events = { becameSick: false, ranAway: false, departed: false, returned: false, postcardIntent: null, travelSummary: null };
    const s = state.stats;

    if (state.ranAway) {
      await this._saveState(state); // 出走态冻结，仅推进 lastTickDate
      return { changed: false, ...events };
    }

    const travel = this._travelOf(state);

    // 旅行中：暂停衰减与生病判定（吃便当呢），心情回升；记录昨日达标；随机寄卡；归期回家
    if (travel.status === 'traveling') {
      const dest = PetManager.getDestination(travel.destination);
      s.mood = PetManager.clampStat(s.mood + 5);
      const allDone = !!(state.behavior && state.behavior.date === yesterdayDate && state.behavior.allDone);
      travel.tripLog.push({ date: yesterdayDate, allDone });
      const tripDay = travel.departDate ? PetManager.daysBetween(travel.departDate, yesterdayDate) : 1;
      this._addLog(state, 'travel', `${dest.icon} 旅行第 ${tripDay} 天（${dest.name}）${allDone ? '，听说主人昨天全达标，玩得更开心了' : ''}`, yesterdayDate);
      if (PetManager.rollPostcard()) {
        events.postcardIntent = { destination: travel.destination, tripDay, tripDays: travel.days, allDone };
      }
      if (tripDay >= travel.days) {
        return this._settleReturn(state, yesterdayDate, events);
      }
      await this._commit(state, yesterdayDate);
      return { changed: true, ...events };
    }

    // 行李就绪：出发（目的地随机、时长由行李件数决定）
    if (travel.status === 'ready') {
      travel.status = 'traveling';
      travel.departDate = yesterdayDate;
      travel.days = PetManager.rollTripDays(this._bagCount(travel));
      travel.destination = PetManager.pickDestination().key;
      travel.tripLog = [];
      const dest = PetManager.getDestination(travel.destination);
      this._addLog(state, 'travel', `🎒 背上行囊出发去${dest.name}了（约 ${travel.days} 天）`, yesterdayDate);
      events.departed = true;
      events.destination = travel.destination;
      await this._commit(state, yesterdayDate);
      return { changed: true, ...events };
    }

    // home：自然衰减
    for (const k of Object.keys(PetManager.DECAY)) {
      s[k] = PetManager.clampStat(s[k] + PetManager.DECAY[k]);
    }
    this._addLog(state, 'decay', '过了漫长的一天，有点饿也有点无聊', yesterdayDate);

    if (state.sick) {
      // 生病持续：健康流失 + 出走判定（连续 SICK_RUNAWAY_DAYS 天未治）
      s.health = PetManager.clampStat(s.health - PetManager.SICK_HEALTH_DROP);
      const sickDays = PetManager.daysBetween(state.sickSince, yesterdayDate) + 1;
      if (sickDays >= PetManager.SICK_RUNAWAY_DAYS) {
        state.ranAway = true;
        events.ranAway = true;
        this._addLog(state, 'ranaway', `😢 病了太久没人管，${state.name} 留了张字条出走了……`, yesterdayDate);
        await this._commit(state, yesterdayDate);
        return { changed: true, ...events };
      }
      this._addLog(state, 'sick', `还在生病（第 ${sickDays} 天），健康 -${PetManager.SICK_HEALTH_DROP}`, yesterdayDate);
    } else {
      // 低水位连续计数：连续 SICK_LOW_DAYS 天饿肚子/太脏 → 生病
      const low = s.hunger < PetManager.SICK_HUNGER_BELOW || s.clean < PetManager.SICK_CLEAN_BELOW;
      if (low) {
        if (!state.lowSince) state.lowSince = yesterdayDate;
        const lowDays = PetManager.daysBetween(state.lowSince, yesterdayDate) + 1;
        if (lowDays >= PetManager.SICK_LOW_DAYS) {
          state.sick = true;
          state.sickSince = yesterdayDate;
          events.becameSick = true;
          this._addLog(state, 'sick', `🤒 一直饿肚子/脏兮兮的，${state.name} 生病了`, yesterdayDate);
        }
      } else {
        state.lowSince = null;
      }
    }
    await this._commit(state, yesterdayDate);
    return { changed: true, ...events };
  }

  // 回家结算：成长加成（全达标天数 ×15 exp/×3 币）+ 特产意图（v3.26.0 起特产由 app.js 调 LLM 按目的地现编，失败降级静态随机）
  async _settleReturn(state, yesterdayDate, events) {
    const travel = this._travelOf(state);
    const dest = PetManager.getDestination(travel.destination);
    const allDoneDays = travel.tripLog.filter(t => t.allDone).length;

    // 成长结算：基础 +30 exp/+10 币，全达标每天额外 +15 exp/+3 币
    const before = PetManager.levelOf(state.exp).level;
    const bonusExp = allDoneDays * 15;
    const bonusCoins = allDoneDays * 3;
    state.exp = (state.exp || 0) + 30 + bonusExp;
    state.coins = (state.coins || 0) + 10 + bonusCoins;
    const after = PetManager.levelOf(state.exp).level;
    if (after > before) {
      this._addLog(state, 'levelup', `🎉 升到 Lv.${after}（${PetManager.LEVEL_NAMES[after - 1]}）`);
    }

    const tripCount = Math.max(travel.tripLog.length, 1);
    const tripDays = travel.days;
    const bonusNote = allDoneDays > 0
      ? `（旅行期间 ${allDoneDays}/${tripCount} 天全达标：+${bonusExp} 成长、+${bonusCoins} 币）`
      : '';
    this._addLog(state, 'travel', `🏠 从${dest.name}回来了！${bonusNote}`, yesterdayDate);

    // 重置旅行字段
    travel.status = 'home';
    travel.bag = {};
    travel.departDate = null;
    travel.days = null;
    travel.destination = null;
    travel.tripLog = [];

    events.returned = true;
    events.souvenirIntent = { destination: dest.key }; // 特产由 app.js LLM 现编后 grantItem 落包
    events.travelSummary = { destination: dest.key, destinationName: dest.name, tripDays, allDoneDays, tripCount, bonusExp, bonusCoins };
    await this._commit(state, yesterdayDate);
    return { changed: true, ...events };
  }

  // 特产落包（v3.26.0）：LLM 生成的动态物品或静态降级物品统一由此入包 + 日志
  async grantItem(key, count = 1) {
    const state = await this._loadState();
    if (!state) return false;
    state.inventory[key] = (state.inventory[key] || 0) + count;
    const item = await this.resolveItem(key);
    this._addLog(state, 'travel', `🧧 旅行的特产：${item ? `${item.icon} ${item.name}×${count}` : key}`);
    await this._commit(state, this._getToday());
    return true;
  }

  // 接出走宠物回家：状态恢复到 COMEBACK_STATS，生病清零
  async comeBack() {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (!state.ranAway) return { success: false, reason: 'not_away', message: `${state.name} 在家里呢` };
    state.ranAway = false;
    state.sick = false;
    state.sickSince = null;
    state.lowSince = null;
    state.stats = { ...PetManager.COMEBACK_STATS };
    this._addLog(state, 'comeback', `🏠 你把 ${state.name} 接回了家，它扑进了你怀里`);
    await this._commit(state, this._getToday());
    return { success: true, message: `${state.name} 回家啦！`, state };
  }

  // ===== 日志 =====

  // logDate：事件归属日期（默认今天；跨天结算产生的衰减/生病/出走记昨日）
  _addLog(state, type, text, logDate = null) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    state.log.push({ date: logDate || this._getToday(), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, type, text });
    if (state.log.length > 60) state.log.splice(0, state.log.length - 60); // 只留最近 60 条
  }

  // 生成单日 MD（纯函数，可单测）。logs: 当日事件数组（时间正序）；diary: 今日心声（v3.25.0 LLM 生成）
  static buildDayMd(date, logs, diary = null) {
    const lines = [`---`, `date: ${date}`, `---`, ``];
    if (diary && diary.text) {
      lines.push(`## 今日心声`, ``, diary.text, ``);
    }
    if (!logs || logs.length === 0) {
      lines.push(`（今日暂无宠物动态）`, ``);
      return lines.join('\n');
    }
    lines.push(`## 宠物动态`, ``);
    for (const l of logs) {
      lines.push(`- ${l.time} ${l.text}`);
    }
    lines.push(``, `> 宠物日志由系统自动生成（AI 只读）。宠物状态见 .meta/pet-state.json`, ``);
    return lines.join('\n');
  }

  // 单日 MD 重建：当日无事件且无心声删文件（与 exercise-manager._writeDayMd 同模式）
  async _writeDayMd(date) {
    const path = `pet/${date}.md`;
    const state = await this._loadState();
    const logs = state ? state.log.filter(l => l.date === date) : [];
    const diary = (state && state.diary && state.diary.date === date) ? state.diary : null;
    if (logs.length === 0 && !diary) {
      await this.fm.deleteFile(path).catch(() => {});
      return;
    }
    await this.fm.writeFile(path, PetManager.buildDayMd(date, logs, diary));
  }

  // 保存今日心声（v3.25.0 LLM 生成）+ 重建当日 MD（心声段在动态前，AI 与面板共同消费）
  async saveDiary(date, text) {
    const state = await this._loadState();
    if (!state) return false;
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    state.diary = { date, text: trimmed };
    await this._saveState(state);
    try {
      await this._writeDayMd(date);
    } catch (e) {
      console.warn('[PetManager] 写心声日志失败:', e.message);
    }
    this._notifyChange();
    return true;
  }

  // ===== 动态物品池（v3.26.0：LLM 生成的每日特供/AI 制作/旅行特产）=====

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

  // 落入动态池（sanitize 后；不自动入背包，调用方自行 inventory++）；失效返回 null
  async addCustomItem(item) {
    const clean = PetManager.sanitizeCustomItem(item);
    if (!clean) return null;
    const items = await this._loadItems();
    const full = {
      ...clean,
      key: clean.key || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      source: item.source || 'craft',
      buyable: item.buyable !== false,
      date: item.date || this._getToday()
    };
    items.unshift(full);
    if (items.length > 60) items.splice(60); // 池上限，最旧的先淘汰
    await this.fm.writeFile(this.itemsPath, JSON.stringify(items));
    this._notifyChange();
    return full;
  }

  // 统一物品解析：静态 SHOP 优先，未命中查动态池（LLM 生成物品）
  async resolveItem(key) {
    const staticItem = PetManager.getItem(key);
    if (staticItem) return staticItem;
    return this.getCustomItem(key);
  }

  // 今日特供摘要（商店限时货架 + pet_status 可见）：近 3 天上架的 daily 物品
  async getSpecials() {
    const today = this._getToday();
    const items = await this._loadItems();
    return items
      .filter(i => i.source === 'daily' && i.buyable && PetManager.daysBetween(i.date, today) <= 2)
      .map(i => ({ key: i.key, name: i.name, icon: i.icon, price: i.price, desc: i.desc || '' }));
  }

  // LLM 生成物品校验/收敛（纯函数，可单测）：kind 白名单（heal 不开放）、效果按 kind clamp、
  // 价格 clamp 3-20、文本限长；无效返回 null。每个 kind 保证主效果存在（useItem 依赖字段判断）
  static sanitizeCustomItem(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = String(raw.name || '').trim().slice(0, 12);
    if (!name) return null;
    const kind = ['food', 'toy', 'care'].includes(raw.kind) ? raw.kind : null;
    if (!kind) return null;
    const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    const item = { name, kind, icon: String(raw.icon || '🎁').trim().slice(0, 4) || '🎁' };
    if (kind === 'food') {
      item.hunger = num(raw.hunger, 50) || 15;
      if (num(raw.mood, 10)) item.mood = num(raw.mood, 10);
    } else if (kind === 'toy') {
      item.mood = num(raw.mood, 25) || 12;
    } else {
      item.clean = num(raw.clean, 60) || 25;
      if (num(raw.mood, 5)) item.mood = num(raw.mood, 5);
    }
    item.price = Math.max(3, Math.min(20, Math.round(Number(raw.price) || 6)));
    if (raw.desc) item.desc = String(raw.desc).trim().slice(0, 40);
    return item;
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

  // 解析心声/性格 LLM 返回（纯函数，可单测）：字段过短视为缺失
  static parseVoiceReply(text) {
    const obj = PetManager.extractJson(text);
    if (!obj) return null;
    return {
      diary: (typeof obj.diary === 'string' && obj.diary.trim().length >= 10) ? obj.diary.trim() : null,
      personalityMd: (typeof obj.personalityMd === 'string' && obj.personalityMd.trim().length >= 20) ? obj.personalityMd.trim() : null
    };
  }

  // 解析每日特供 LLM 返回（纯函数，可单测）：提取 specials 数组逐个 sanitize，至多 2 个
  static parseItemsReply(text) {
    const obj = PetManager.extractJson(text);
    if (!obj || !Array.isArray(obj.specials)) return [];
    return obj.specials.map(r => PetManager.sanitizeCustomItem(r)).filter(Boolean).slice(0, 2);
  }

  // AI 现场制作（v3.26.0）：LLM 参数即作品。每日 2 次限 + 5 轻币材料费；成品直接进背包
  static CRAFT_DAILY_LIMIT = 2;
  static CRAFT_COST = 5;

  async craftItem(raw) {
    const state = await this._loadState();
    if (!state) return { success: false, reason: 'no_pet', message: '还没有宠物' };
    if (state.ranAway) return { success: false, reason: 'ran_away', message: `${state.name} 出走了，先接它回家吧` };
    if (state.travel && state.travel.status === 'traveling') return { success: false, reason: 'traveling', message: `${state.name} 正在旅行中，回来再做吧` };
    const today = this._getToday();
    this._ensureBehaviorDay(state, today);
    if ((state.behavior.crafts || 0) >= PetManager.CRAFT_DAILY_LIMIT) {
      return { success: false, reason: 'limit_reached', message: `今天已经做了 ${PetManager.CRAFT_DAILY_LIMIT} 件啦，材料也要休息，明天再来` };
    }
    if ((state.coins || 0) < PetManager.CRAFT_COST) {
      return { success: false, reason: 'insufficient_coins', message: `轻币不够（材料费 ${PetManager.CRAFT_COST}，现有 ${state.coins}）` };
    }
    const item = PetManager.sanitizeCustomItem(raw);
    if (!item) return { success: false, reason: 'invalid_item', message: '这个做法不太对，描述一下名字/类型/效果再试试' };
    state.coins -= PetManager.CRAFT_COST;
    state.behavior.crafts = (state.behavior.crafts || 0) + 1;
    const full = await this.addCustomItem({ ...item, source: 'craft', buyable: false, date: today });
    if (!full) return { success: false, reason: 'invalid_item', message: '制作失败了，换个描述再试试' };
    state.inventory[full.key] = (state.inventory[full.key] || 0) + 1;
    this._addLog(state, 'craft', `🔨 亲手做了 ${full.icon} ${full.name}×1`);
    await this._commit(state, today);
    return { success: true, message: `做好了${full.icon} ${full.name}×1，已放进背包`, item: full, state };
  }

  // ===== 给 AI / 悬浮球的摘要 =====

  // 一行摘要（实例版，背包里的动态物品名可解析）：球球（🐤小鸡 Lv.3）饱食70 清洁55 心情80 健康100 | 轻币120 | 背包: 苹果×2（旅行状态非 home 时追加旅行段）
  async summaryLine() {
    const state = await this._loadState();
    if (!state) return null;
    const customItems = await this._loadItems();
    const nameOf = (key) => {
      const st = PetManager.getItem(key);
      if (st) return st.name;
      const c = customItems.find(i => i.key === key);
      return c ? c.name : null;
    };
    const def = PetManager.speciesDef(state.species);
    const s = state.stats;
    const status = state.ranAway ? '已离家出走' : state.sick ? '生病中' : '状态正常';
    const inv = Object.entries(state.inventory || {}).filter(([, n]) => n > 0)
      .map(([k, n]) => `${nameOf(k) || k}×${n}`).join('、');
    let line = `${state.name}（${def.icon}${def.label} Lv.${state.level}）${status} ｜ 饱食${s.hunger} 清洁${s.clean} 心情${s.mood} 健康${s.health} ｜ 轻币${state.coins}${inv ? ` ｜ 背包: ${inv}` : ' ｜ 背包空'}`;
    const t = state.travel;
    if (t && t.status === 'traveling') {
      const dest = PetManager.getDestination(t.destination);
      line += ` ｜ 旅行中: 去${dest.name}（共 ${t.days} 天）`;
    } else if (t && t.status === 'ready') {
      const bagCount = Object.values(t.bag || {}).reduce((a, b) => a + b, 0);
      line += ` ｜ 行李已收拾好（${bagCount} 件食物），明天出发去旅行`;
    }
    return line;
  }

  // ===== 周报宠物段（v3.25.0）=====

  // 本周宠物动态统计（从 log + postcards 汇总）
  async getWeeklyDigest(startDate, endDate) {
    const state = await this._loadState();
    if (!state) return null;
    const logs = (state.log || []).filter(l => l.date >= startDate && l.date <= endDate);
    const inRange = (type, kw) => logs.filter(l => l.type === type && (!kw || l.text.includes(kw))).length;
    const postcards = (await this._loadPostcards()).filter(c => c.date >= startDate && c.date <= endDate);
    return {
      name: state.name,
      level: state.level,
      departures: inRange('travel', '出发'),
      returns: inRange('travel', '回来了'),
      sickCount: inRange('sick'),
      levelUps: inRange('levelup'),
      postcards: postcards.length
    };
  }

  // 周报文本段（纯函数，可单测）
  static buildWeeklyDigestText(digest) {
    if (!digest) return '（本周宠物无动态）';
    if (digest.departures === 0 && digest.postcards === 0 && digest.levelUps === 0 && digest.sickCount === 0) {
      return `（本周${digest.name}安静地待在家里，当前 Lv.${digest.level}）`;
    }
    const parts = [];
    if (digest.departures > 0) parts.push(`出行 ${digest.departures} 次`);
    if (digest.postcards > 0) parts.push(`寄回明信片 ${digest.postcards} 张`);
    if (digest.levelUps > 0) parts.push(`升级 ${digest.levelUps} 次`);
    if (digest.sickCount > 0) parts.push(`生病 ${digest.sickCount} 次`);
    return `- ${digest.name}：${parts.join('、')}（当前 Lv.${digest.level}）`;
  }

  // ===== 工具方法 =====

  _getToday() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  _notifyChange() {
    if (this.onChangeCallback) {
      try {
        this.onChangeCallback();
      } catch (e) {
        console.error('[PetManager] onChange error:', e);
      }
    }
  }
}
