// pet-manager.js
// 虚拟宠物养成模块（对标 QQ 宠物）— 状态四维/行为奖励/轻币商店/成长等级/跨天衰减与生病
// 存储：IndexedDB（.meta/pet-state.json 单文件），AI 可读日志 pet/YYYY-MM-DD.md 由系统自动生成
// 设计定位：宠物 = 减肥行为的情感激励层。打卡/记饮食/运动/称重 → 实时奖励（轻币/物品掉落/exp/状态加成）；
//           跨天结算统一衰减 + 生病判定；连续生病 7 天不管 → 离家出走（不死，接回家即恢复）。
//           所有互动/购买在出走态下拒绝（reason: 'ran_away'）。

const PET_STATE_PATH = '.meta/pet-state.json';

export class PetManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this.statePath = PET_STATE_PATH;
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

  // 轻币商店（全部为消耗品；玩具/清洁/药品共用 useItem）
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
    { key: 'medicine', kind: 'care', icon: '💊', name: '感冒药', price: 12, heal: true }
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
    return { date: today, checkins: {}, meals: 0, weights: 0, freePlays: 0, allDone: false, milestoneStreaks: {} };
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
    const item = PetManager.getItem(itemKey);
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
    const item = PetManager.getItem(itemKey);
    if (!item) return { success: false, reason: 'unknown_item', message: '未知商品' };
    if ((state.coins || 0) < item.price) {
      return { success: false, reason: 'insufficient_coins', message: `轻币不够（需要 ${item.price}，现有 ${state.coins}）` };
    }
    state.coins -= item.price;
    state.inventory[itemKey] = (state.inventory[itemKey] || 0) + 1;
    this._addLog(state, 'shop', `花 ${item.price} 轻币买了 ${item.icon} ${item.name}`);
    await this._commit(state, this._getToday());
    return { success: true, message: `买到了${item.icon} ${item.name}`, state };
  }

  // ===== 跨天结算（app.js handleDayRollover 调用；幂等）=====

  // 返回 { changed, becameSick, ranAway } 供 app.js 发通知；未变/已结算过返回 changed:false
  async tickDaily(yesterdayDate) {
    const state = await this._loadState();
    if (!state) return { changed: false, becameSick: false, ranAway: false };
    if (state.lastTickDate === yesterdayDate) {
      return { changed: false, becameSick: false, ranAway: false }; // 幂等：断点续跑不重复衰减
    }
    state.lastTickDate = yesterdayDate;
    const events = { becameSick: false, ranAway: false };
    const s = state.stats;

    if (state.ranAway) {
      await this._saveState(state); // 出走态冻结，仅推进 lastTickDate
      return { changed: false, ...events };
    }

    // 自然衰减
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

  // 生成单日 MD（纯函数，可单测）。logs: 当日事件数组（时间正序）
  static buildDayMd(date, logs) {
    const lines = [`---`, `date: ${date}`, `---`, ``];
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

  // 单日 MD 重建：当日无事件删文件（与 exercise-manager._writeDayMd 同模式）
  async _writeDayMd(date) {
    const path = `pet/${date}.md`;
    const state = await this._loadState();
    const logs = state ? state.log.filter(l => l.date === date) : [];
    if (logs.length === 0) {
      await this.fm.deleteFile(path).catch(() => {});
      return;
    }
    await this.fm.writeFile(path, PetManager.buildDayMd(date, logs));
  }

  // ===== 给 AI / 悬浮球的摘要 =====

  // 一行摘要（buildSystemPrompt 动态注入用）：球球（🐤小鸡 Lv.3）饱食70 清洁55 心情80 健康100 | 轻币120 | 背包: 苹果×2
  static summaryLine(state) {
    const def = PetManager.speciesDef(state.species);
    const s = state.stats;
    const status = state.ranAway ? '已离家出走' : state.sick ? '生病中' : '状态正常';
    const inv = Object.entries(state.inventory || {}).filter(([, n]) => n > 0)
      .map(([k, n]) => `${PetManager.getItem(k)?.name || k}×${n}`).join('、');
    return `${state.name}（${def.icon}${def.label} Lv.${state.level}）${status} ｜ 饱食${s.hunger} 清洁${s.clean} 心情${s.mood} 健康${s.health} ｜ 轻币${state.coins}${inv ? ` ｜ 背包: ${inv}` : ' ｜ 背包空'}`;
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
