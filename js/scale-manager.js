// scale-manager.js
// 蓝牙体脂秤直连 — 蚂蚁阿福 AFU-BH-TZ-B1（沃莱代工）
// 分两层：
//   1. AfuB1：纯协议层（帧构造/解析/CRC/体成分公式），零依赖可单测
//   2. ScaleManager：BLE 会话状态机（扫描→连接→订阅→称重→提交），走
//      window.Capacitor.Plugins.BluetoothLe 桥接（@capacitor-community/bluetooth-le），
//      仅 APK 原生环境可用，浏览器 Web 版自动降级提示。
// 协议与体脂率/体成分公式依据 openScale 项目（GPL-3.0）公开的逆向成果
// （AfuB1Lib/AfuB1Handler，抓包自官方阿福 App）按字节规范重新实现；
// 金标准测试用例（test/scale-manager.test.js）与 openScale 的抓包帧逐字节对齐。
//
// 会话流程（对应 openScale AfuB1Handler 的逆向结论）：
//   握手（时间同步+2x sync-request，过早发 profile 会把秤切进称重模式并阻塞历史导出）
//   → 空闲时 0x8e 导出全部历史（逐条 ACK）
//   → 上秤 0x51 实时流 → 锁定位=1 后 ACK
//   → 等秤静默 2s（人已下秤）→ 重新 sync + getWeighAgain(0x4b/0x5b)+chunk 请求
//   → 秤推送新的 0x54 存储记录（体重+阻抗）→ 计算/落盘/断开
// 注意：秤只吐「体重+阻抗」，体脂率/水分/肌肉/骨量/内脏脂肪/蛋白质全部是
// App 端用官方公式算出来的（下方 bodyFatPercent/bodyComposition）。

// ===== AFU B1 协议常量 =====

export const AFU = {
  // 广播携带的 GATT service（扫描过滤用），蓝牙名含 "AFU"
  SERVICE_UUID: '0000fc50-0000-1000-8000-00805f9b34fb',
  // 写通道：特征 af000002（挂在与特征同 UUID 前缀的 service 下，连接后从 GATT 树定位）
  WRITE_SERVICE: 'af000000-9f2d-4c8a-8d6f-6a7b45f90000',
  WRITE_CHARACTERISTIC: 'af000002-9f2d-4c8a-8d6f-6a7b45f90000',
  FRAME_SIZE: 20,
  // 帧类型（raw[18]）
  WIRE_STORED_RECORD: 0x54,   // 秤→手机：存储/历史记录
  WIRE_IMPEDANCE_RESULT: 0x52, // 秤→手机：单次阻抗结果
  WIRE_LIVE_WEIGHT: 0x51,      // 秤→手机：实时体重
  WIRE_CONTROL: 0x5f,          // 双向：控制帧（0x12 ACK / 0x14 chunk / 0x16 时间同步）
  WIRE_SYNC_REQUEST: 0x62,     // 手机→秤
  WIRE_USER_PROFILE: 0x61,     // 手机→秤
  // 子命令（raw[2]）
  CMD_TIME_SYNC: 0x16,
  CMD_SYNC_REQUEST: 0x04,
  CMD_ACK: 0x12,
  CMD_BODY_COMP_CHUNK: 0x14,
  CMD_HISTORY_DUMP: 0x8e,
  // profile 变体（raw[2] of 0x61），openByte 为抓包原样的 af XX 字节
  PROFILE_VARIANTS: {
    INITIAL: { code: 0x3f, openByte: 0xb6 },
    GET_WEIGH_AGAIN_1: { code: 0x4b, openByte: 0xb6 },
    GET_WEIGH_AGAIN_2: { code: 0x5b, openByte: 0xd9 },
    FINAL: { code: 0x68, openByte: 0xd9 }
  },
  // 体重存储在（字节交换后的）标志字低 18 位，单位克
  WEIGHT_G_MASK: 0x3ffff,
  // 会话时序（毫秒）
  IDLE_DELAY_MS: 2000,     // 秤静默多久算「人已下秤」
  IDLE_POLL_MS: 250,
  COMMIT_TIMEOUT_MS: 15000, // 提交后等新 0x54 的上限，超时回退实时锁定值
  SCAN_TIMEOUT_MS: 30000,   // 扫描窗口；秤常需踩一下才广播，留足唤醒时间
  CONNECT_TIMEOUT_MS: 15000
};

// ===== 工具 =====

const f32 = Math.fround; // 对应 Kotlin Float（单精度）；f64 中间值按 fround 边界还原

// 32 位字节反转（官方 App 的 ConvertIntEndian）
function convertIntEndian(v) {
  return (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) | 0;
}

function le16(b, off) {
  return (b[off] | (b[off + 1] << 8)) & 0xffff;
}

function le32(b, off) {
  return ((b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) | 0) >>> 0;
}

function be32(b, off) {
  return (((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) | 0) >>> 0;
}

// Kotlin: Math.rint —— 四舍六入五成双（此处输入恒为正）
function rint(x) {
  const fl = Math.floor(x);
  const d = x - fl;
  if (d === 0.5) return fl % 2 === 0 ? fl : fl + 1;
  return d < 0.5 ? fl : fl + 1;
}

export function bytesToHex(bytes) {
  return Array.from(bytes).map(n => n.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

// ===== 调试日志（三路输出） =====
// 1. console（chrome://inspect / adb logcat 看 [Scale] 前缀）
// 2. 内存环形缓冲（弹窗「复制调试日志」按钮一键带走）
// 3. .meta/scale-log.md（防抖持久化，记忆面板可直接查看/导出）
// 出问题时按「会话横幅 → 错误行 → 前后若干帧 hex」即可定位收敛。

const SCALE_LOG_KEY = '.meta/scale-log.md';
const SCALE_LOG_MAX_ENTRIES = 400;   // 缓冲条数上限（超出丢最旧）
const SCALE_LOG_MAX_CHARS = 24000;   // 持久化文件字符上限（环形保留尾部）
const _logBuffer = [];
const _hexRing = [];                 // 最近原始帧 hex（错误现场用）
const _HEX_RING_MAX = 60;
let _logFm = null;                   // 由 ScaleManager 构造时注入
let _persistTimer = null;
let _sessionSeq = 0;

function _ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

// level: 'I' 信息 / 'D' 调试 / 'W' 警告 / 'E' 错误；data 可选（对象/数组，安全 JSON 化）
export function scaleLog(level, msg, data) {
  let line = `${_ts()} [${level}] ${msg}`;
  if (data !== undefined) {
    try {
      const s = JSON.stringify(data);
      if (s !== undefined) line += ' ' + s;
    } catch (_) { /* 循环引用等，直接丢 data */ }
  }
  _logBuffer.push(line);
  if (_logBuffer.length > SCALE_LOG_MAX_ENTRIES) _logBuffer.splice(0, _logBuffer.length - SCALE_LOG_MAX_ENTRIES);
  const c = level === 'E' ? console.error : level === 'W' ? console.warn : console.log;
  try { c.call(console, '[Scale]', line); } catch (_) {}
  _schedulePersist();
}

// 最近原始帧 hex 入环形队列（诊断「秤发了但解析不了」类问题）
function logHexRing(hex) {
  _hexRing.push(hex);
  if (_hexRing.length > _HEX_RING_MAX) _hexRing.shift();
}

// 错误现场：返回最近 N 条日志 + 原始帧 hex
export function getScaleDump() {
  return {
    recent: _logBuffer.slice(-30),
    recentFramesHex: _hexRing.slice(-20)
  };
}

export function getScaleLog() {
  return `轻伴体脂秤调试日志（滚动最近 ${_logBuffer.length} 条）\n` + _logBuffer.join('\n');
}

function _schedulePersist() {
  if (!_logFm || _persistTimer) return;
  _persistTimer = setTimeout(async () => {
    _persistTimer = null;
    try {
      const header = `# 体脂秤调试日志（环形保留最近 ${SCALE_LOG_MAX_CHARS} 字符；最新会话在后）\n\n`;
      let text = header + _logBuffer.join('\n');
      if (text.length > SCALE_LOG_MAX_CHARS) text = header + '\n…（更早日志已滚动丢弃）\n' + text.slice(-SCALE_LOG_MAX_CHARS);
      await _logFm.writeFile(SCALE_LOG_KEY, text + '\n');
    } catch (_) { /* IndexedDB 不可用时仅保留 console/内存两路 */ }
  }, 1500);
  if (typeof _persistTimer.unref === 'function') _persistTimer.unref(); // 不阻塞 node 退出（测试环境）
}

// 会话状态快照（错误/结束时落一行，收敛问题用）
function sessionSnapshot(session) {
  if (!session) return null;
  const s = {
    stage: session.stage || '?',
    deviceId: session.deviceId,
    flags: {
      handshakeSent: session.handshakeSent, profileSent: session.profileSent,
      historyDumpSent: session.historyDumpSent, liveSeen: session.liveSeen,
      weightFinal: session.weightFinal, commitInProgress: session.commitInProgress,
      committedSeen: session.committedSeen
    },
    lastLiveWeightG: session.lastLiveWeightG,
    weighMs: session.weighStartedAt ? Date.now() - session.weighStartedAt : 0,
    idleMs: session.lastFrameAt ? Date.now() - session.lastFrameAt : -1,
    framesByType: session.framesByType || {},
    writes: {
      ok: session.writesOk || 0, fail: session.writesFail || 0
    },
    historyRecords: (session.historyRecords || []).length,
    notifyChars: (session.notifyChars || []).length,
    writeService: session.writeService
  };
  return s;
}

function logSessionEnd(session, outcome, extra) {
  scaleLog(outcome === 'ok' ? 'I' : 'W', `── 会话结束 #${session.seq}：${outcome}`, {
    ...sessionSnapshot(session),
    recentFramesHex: _hexRing.slice(-20),
    ...(extra || {})
  });
}

// ===== 协议层（纯函数） =====

export const AfuB1 = {

  convertIntEndian,

  // CRC：raw[2..18] 求和取低 5 位
  crc(bytes) {
    let sum = 0;
    for (let i = 2; i < 19; i++) sum += bytes[i] & 0xff;
    return sum & 0x1f;
  },

  crcValid(bytes) {
    return this.crc(bytes) === (bytes[19] & 0x1f);
  },

  // 帧组装：AF 45 [子命令] [15字节body] [帧类型] [CRC]
  buildFrame(cmd, wireType, body) {
    if (!Array.isArray(body) || body.length !== 15) throw new Error('AFU frame body must be 15 bytes');
    const b = new Array(AFU.FRAME_SIZE).fill(0);
    b[0] = 0xaf; b[1] = 0x45; b[2] = cmd & 0xff;
    for (let i = 0; i < 15; i++) b[3 + i] = body[i] & 0xff;
    b[18] = wireType & 0xff;
    b[19] = this.crc(b) & 0xff;
    return b;
  },

  // 时间戳槽：ConvertIntEndian(now) 按大端字节序铺 4 字节（存储记录里却是小端 LE32，原样保留）
  _time4(nowEpochSeconds) {
    const v = convertIntEndian(nowEpochSeconds >>> 0);
    return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  },

  buildTimeSync(nowEpochSeconds) {
    return this.buildFrame(AFU.CMD_TIME_SYNC, AFU.WIRE_CONTROL,
      [...this._time4(nowEpochSeconds), 0x20, ...new Array(10).fill(0)]);
  },

  // 两次 sync-request 的 body 字节抓包自官方 App（openByte/计数器字节可能与会话相关）
  buildSyncRequest(variant) {
    const body = variant === 'SECOND'
      ? [0x01, 0x03, 0xa5, 0xf8, 0x11, 0x1d, 0x02, 0x00, 0x04, 0xb4, 0xc6, 0x1b, 0x1d, 0x01, 0x00]
      : [0x00, 0x01, 0xaf, 0xb6, 0x17, 0x1d, 0x01, 0x00, 0x02, 0xb4, 0xc6, 0x1b, 0x56, 0x01, 0x00];
    return this.buildFrame(AFU.CMD_SYNC_REQUEST, AFU.WIRE_SYNC_REQUEST, body);
  },

  buildUserProfile(variantName, nowEpochSeconds, user, age, sex, targetKg) {
    const variant = AFU.PROFILE_VARIANTS[variantName];
    const targetX100 = Math.round(targetKg * 100) & 0xffff;
    const body = [
      ...this._time4(nowEpochSeconds), 0x00, user & 0xff,
      0xaf, variant.openByte, 0x17, age & 0xff, sex & 0xff,
      targetX100 & 0xff, (targetX100 >>> 8) & 0xff, 0x03, 0x00
    ];
    return this.buildFrame(variant.code, AFU.WIRE_USER_PROFILE, body);
  },

  buildHistoryDumpRequest(nowEpochSeconds, user, age, sex, targetKg) {
    const targetX100 = Math.round(targetKg * 100) & 0xffff;
    const body = [
      ...this._time4(nowEpochSeconds), 0x00, user & 0xff,
      0xaf, 0xde, 0x17, age & 0xff, sex & 0xff,
      targetX100 & 0xff, (targetX100 >>> 8) & 0xff, 0x03, 0x00
    ];
    return this.buildFrame(AFU.CMD_HISTORY_DUMP, AFU.WIRE_USER_PROFILE, body);
  },

  buildAck(replyWireType, correlationIndex = 0) {
    return this.buildFrame(AFU.CMD_ACK, AFU.WIRE_CONTROL,
      [replyWireType & 0xff, 0x00, correlationIndex & 0xff, ...new Array(12).fill(0)]);
  },

  buildChunkRequest() {
    return this.buildFrame(AFU.CMD_BODY_COMP_CHUNK, AFU.WIRE_CONTROL, new Array(15).fill(0));
  },

  // 解析一帧（Uint8Array/数组）。非 AFU 帧（长度/头/CRC/方向不符）返回 null。
  parse(raw) {
    if (!raw || raw.length !== AFU.FRAME_SIZE) return null;
    if ((raw[0] & 0xff) !== 0xaf || (raw[1] & 0xff) !== 0x45) return null;
    if (!this.crcValid(raw)) return null;
    const cmd = raw[2] & 0xff;
    const wire = raw[18] & 0xff;

    if (wire === AFU.WIRE_STORED_RECORD) {
      const flags = convertIntEndian(be32(raw, 7));
      return {
        type: 'stored',
        historyType: cmd & 0x03,
        sequence: (cmd >>> 2) & 0x3f,
        timestampEpochSeconds: le32(raw, 3),
        weightGrams: flags & AFU.WEIGHT_G_MASK,
        hasElectrode: !!((flags >>> 24) & 1),
        hasHeartRate: !!((flags >>> 25) & 1),
        locked: !!((flags >>> 31) & 1),
        resistanceOhms: le16(raw, 13),
        wireType: wire, ackReplyByte: AFU.WIRE_STORED_RECORD
      };
    }
    if (wire === AFU.WIRE_LIVE_WEIGHT) {
      const flags = convertIntEndian(be32(raw, 2));
      return {
        type: 'live',
        weightGrams: flags & AFU.WEIGHT_G_MASK,
        mode: raw[6] & 0xff,
        locked: !!((flags >>> 31) & 1),
        wireType: wire, ackReplyByte: AFU.WIRE_LIVE_WEIGHT
      };
    }
    if (wire === AFU.WIRE_IMPEDANCE_RESULT) {
      return {
        type: 'impedance',
        valid: cmd === 0x01,
        adcOhms: le16(raw, 4),
        wireType: wire, ackReplyByte: AFU.WIRE_IMPEDANCE_RESULT
      };
    }
    if (wire === AFU.WIRE_CONTROL) {
      if (cmd === AFU.CMD_BODY_COMP_CHUNK) {
        return { type: 'chunk', chunkIndex: raw[3] & 0xff, payload: Array.from(raw.slice(4, 18)), wireType: wire, ackReplyByte: AFU.CMD_BODY_COMP_CHUNK };
      }
      if (cmd === AFU.CMD_ACK) {
        return { type: 'ack', replyCmd: raw[3] & 0xff, replyOp: raw[4] & 0xff, wireType: wire, ackReplyByte: 0 };
      }
      return { type: 'control', cmd, wireType: wire, ackReplyByte: 0 };
    }
    return null; // 0x61/0x62 是手机→秤方向，秤不会发
  },

  // ===== 体成分公式（移植自官方 App 逆向；fround 边界与原实现一致，不可省） =====

  // 体脂率 %：sex 1=男 0=女；阻抗 0 → null；结果裁剪到 [5,80] 并四舍六入五成双保留 1 位
  bodyFatPercent(weightKg, heightCm, age, sex, impedanceOhm) {
    if (impedanceOhm === 0) return null;
    const h = f32(heightCm / 100.0);
    const hd = +h;
    const h2 = hd * hd;
    let r;
    if (sex === 1) {
      const h2f = +f32(h * f32(h * -486583.0));
      r = 1625303.0 / impedanceOhm / impedanceOhm;
      r += 9.146 * weightKg / h2 / impedanceOhm;
      r += h2f / weightKg / impedanceOhm + 61.8;
      r += -251.193 * h2 / weightKg / age;
      r += impedanceOhm * -0.0139;
      r += age * 0.05975;
    } else {
      const h2f = +f32(h * f32(h * -382280.0));
      r = -186.422 * h2 / weightKg + 58.82;
      r += h2f / weightKg / impedanceOhm;
      r += 128.005 * weightKg / hd / impedanceOhm;
      r += -0.0728 * weightKg / hd;
      r += 7816.359 / hd / impedanceOhm;
      r += -3.333 * weightKg / h2 / age;
    }
    const clamped = Math.min(80, Math.max(5, f32(r)));
    return rint(clamped * 10.0) / 10.0;
  },

  // 由 体重+体脂率 推其余成分；输入超出验证范围返回 null
  bodyComposition(sex, age, heightCm, weightKg, bodyFatPercent) {
    if (sex > 1 || age < 10 || age > 99) return null;
    if (heightCm < 90 || heightCm > 240 || weightKg < 10 || weightKg > 200) return null;

    const bf = +bodyFatPercent;
    const w = +weightKg;
    const h = +heightCm;

    if ((bf <= 4.0 && bf <= 3.999) || (bf >= 75.0 && (bf <= 74.999 || bf > 75.001))) return null;
    const bandLow = bf <= 4.0;
    const bandHigh = bf >= 75.0;

    const bmi = f32(w * 10000.0 / f32(h * h));

    // 由 BMI+实测体脂率反解内部脂肪率
    let num, denom;
    if (sex === 0) {
      if (age <= 15) {
        num = +f32(f32(f32(-556421.0 / bmi) + 17387.0));
        denom = bf - 44.19;
      } else {
        num = +f32(f32(f32(-518695.0 / bmi) + 15802.0));
        denom = bf - 42.86 + age * -0.057;
      }
    } else {
      if (age <= 15) {
        num = +f32(f32(f32(-506791.0 / bmi) + 12009.0));
        denom = bf - 63.25 + age * 1.121;
      } else {
        num = +f32(f32(f32(-460857.0 / bmi) + 10645.0));
        denom = bf - 37.74 + age * -0.0511;
      }
    }
    const recomputedBf = f32(num / denom);

    let c0;
    if (bandLow) c0 = f32(sex === 0 ? 66.5 : 66.0);
    else if (bandHigh) c0 = f32(sex === 0 ? 18.0 : 15.0);
    else if (sex === 0) {
      let s2 = f32(3752.4 * h); s2 = f32(s2 * h);
      let s3 = f32(444.93 + f32(556707.0 / recomputedBf));
      s2 = f32(s2 / recomputedBf); s3 = f32(s3 / weightKg); s2 = f32(s2 / 10000.0);
      const sa = f32(10276.0 / recomputedBf);
      s2 = f32(s3 + s2);
      c0 = f32(24.305 + f32(s2 - sa));
    } else {
      let s2 = f32(3705.3 * h); s2 = f32(s2 * h);
      let s3 = f32(299.43 + f32(696819.0 / recomputedBf));
      s2 = f32(s2 / recomputedBf); s3 = f32(s3 / weightKg); s2 = f32(s2 / 10000.0);
      const sa = f32(10770.0 / recomputedBf);
      s2 = f32(s3 + s2);
      c0 = f32(29.61 + f32(s2 - sa));
    }
    const c4 = f32(c0 * w / 100.0);

    // 骨量
    const boneMassKg = (bandLow || bandHigh)
      ? f32(w * (bandLow ? (sex === 0 ? 5.8 : 5.0) : (sex === 0 ? 1.6 : 1.3)) / 100.0)
      : f32(+f32(w * (sex === 0 ? 0.061 : 0.052)) * +f32(100.0 - bf) / 100.0);

    // 骨骼肌率 s1 与总肌肉率 s4
    let s1, s4;
    if (bandLow) {
      s1 = f32(sex === 0 ? 56.6 : 59.0);
      s4 = f32(sex === 0 ? 90.2 : 91.0);
    } else if (bandHigh) {
      s1 = f32(sex === 0 ? 15.1 : 17.9);
      s4 = f32(sex === 0 ? 23.4 : 23.7);
    } else {
      s1 = sex === 0 ? f32(f32(c0 * 0.857) - 0.36) : f32(c0 * 0.895);
      const mf = f32(sex === 0 ? 0.939 : 0.948);
      s4 = f32(mf * f32(100.0 - bf));
    }
    // Kotlin 原式为 ((s1 * w).toFloat() / 100.0).toFloat() * 100.0 / w —— 末段在 Double 上进行
    const skeletalMusclePercent = f32(f32(s1 * w) / 100.0) * 100.0 / w;

    const muscleKg = f32(f32(s4 * w) / 100.0);
    const proteinRate = f32((muscleKg - c4) * 100.0 / w);

    // 内脏脂肪指数
    let vfal;
    if (bandLow) vfal = 1;
    else if (bandHigh) vfal = 30;
    else if (sex === 1) {
      const bf64 = +recomputedBf;
      let acc = 77.216 / bf64 + 0.068;
      acc *= w;
      const d17 = acc + 0.5;
      let d5 = +f32(-5489.0 / recomputedBf) + 2.8;
      d5 *= h; d5 *= h;
      let d6 = d17 + d5 / 10000.0;
      d6 += 6096.3 / bf64;
      const raw = Math.trunc(-1.22 + (d6 + 0.1668 * age));
      vfal = raw <= 0 ? 1 : (raw > 30 ? 30 : raw);
    } else {
      const bf64 = +recomputedBf;
      let acc = 71.92 / bf64 + 0.0876;
      acc *= w;
      const d17 = acc + 0.5;
      let d5 = +f32(-1261.7 / +recomputedBf) - 2.88;
      d5 *= h; d5 *= h;
      let d6 = d17 + d5 / 10000.0;
      d6 += -1545.6 / bf64;
      const raw = Math.trunc(5.9 + (d6 + 0.068 * age));
      vfal = raw <= 0 ? 1 : (raw > 30 ? 30 : raw);
    }

    const bonePct = boneMassKg * 100.0 / w;
    const fatFreeMassKg = f32(w + f32(f32(w * bf) / -100.0));

    return {
      waterPercent: 100.0 - bf - bonePct - proteinRate,
      skeletalMusclePercent,
      boneMassKg,
      visceralFatIndex: vfal,
      proteinPercent: proteinRate,
      fatFreeMassKg
    };
  }
};

// ===== Welland 27 协议（AFU-WL-TZ-A1 · 蚂蚁阿福 A1，沃莱标准 0xAC 帧） =====
// 与 B1（阿福 App 私有协议）不同：A1 走沃莱标准 GATT——
//   service FFB0 / 写特征 FFB1（writeWithoutResponse）/ 通知特征 FFB2
// 连接后启用 FFB2 通知 → 向 FFB1 写一次用户资料帧 → 秤推 0xD5 实时体重帧（锁定位=bit31），
// 测阻抗后推 0xD6 ADC 帧（内含阻抗列表 ± 体重）即完成。字节序：数值字段大端。
// 帧构造/解析按 Mzdyl/ant-afu-welland-scale-android（Scale27Protocol）与
// tonyupup/ha-afu-scale 公开实现移植；体成分用 Segal(1988) BIA 公式估算。

export const Welland27 = {
  SERVICE: '0000ffb0-0000-1000-8000-00805f9b34fb',
  WRITE_CHARACTERISTIC: '0000ffb1-0000-1000-8000-00805f9b34fb',
  NOTIFY_CHARACTERISTIC: '0000ffb2-0000-1000-8000-00805f9b34fb',
  PACKET_WEIGHT: 213, // 0xD5
  PACKET_ADC: 214,    // 0xD6

  // 广播里解析 deviceType/协议版本（厂商数据/服务数据 0x27AC，payload 首字节 0xAC）
  // 返回 {flags, protocolVer, ok} 或 null；ok=false 表示非体脂秤类目
  parseAdvertisement(manufacturerData, serviceData) {
    const cands = [];
    for (const [idStr, hex] of Object.entries(manufacturerData || {})) {
      const idNum = parseInt(idStr, 10);
      if (!Number.isFinite(idNum) || typeof hex !== 'string') continue;
      const prefix = [idNum & 0xff, (idNum >> 8) & 0xff].map(b => b.toString(16).padStart(2, '0')).join('');
      cands.push(prefix + hex);
      if (hex.startsWith('ac')) cands.push(hex);
    }
    for (const [uuid, hex] of Object.entries(serviceData || {})) {
      const u16hex = String(uuid).slice(4, 8);
      if (!/ac/i.test(u16hex)) continue;
      const u16 = parseInt(u16hex, 16);
      if (!Number.isFinite(u16)) continue;
      const prefix = [u16 & 0xff, (u16 >> 8) & 0xff].map(b => b.toString(16).padStart(2, '0')).join('');
      cands.push(prefix + hex);
    }
    const uniq = [...new Set(cands)];
    const pick = uniq.length === 2 ? [uniq[1]] : uniq;
    const ac = pick.map(h => hexToBytes(h)).find(b => b.length >= 2 && b[0] === 0xac);
    if (!ac) return null;
    const flags = ac[1];
    return {
      flags,
      category: (flags >> 4) & 0x07,
      subtype: flags & 0x0f,
      protocolVer: ac.length > 8 ? ac[8] : 1,
      ok: ((flags >> 4) & 0x07) === 2 && (flags & 0x0f) === 7
    };
  },

  // 用户资料帧（20 字节）：AC deviceType 时间4BE 时区刻度 单位 用户号 身高 体重2BE 年龄 性别 0(2BE) 功能位 0 D0 + 校验和
  // sex: 1=男 2=女；unit: 0=kg；返回 number[]
  buildUserInfo({ deviceType = 0x27, nowEpochSeconds, utcQuarters = 32, unit = 0, user = 1, heightCm, age, sex, targetWeightX100 = 0 }) {
    const be4 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    const be2 = (v) => [(v >> 8) & 0xff, v & 0xff];
    const p = [
      0xac, deviceType & 0xff, ...be4(nowEpochSeconds >>> 0), utcQuarters & 0xff,
      unit & 0xff, user & 0xff, heightCm & 0xff, ...be2(targetWeightX100),
      age & 0xff, sex & 0xff, ...be2(0), 0x03, 0x00, 0xd0
    ];
    while (p.length < 19) p.push(0);
    let sum = 0;
    for (let i = 2; i < 19; i++) sum += p[i] & 0xff;
    p.push(sum & 0xff);
    return p;
  },

  // 解析一帧通知（20 字节）→ [{type:'weight'|'adc',...}]；非法帧返回 []
  decode(raw) {
    if (!raw || raw.length < 20) return [];
    const first = raw[1] & 0xff;
    if (first & 0x80) return []; // bit7 置位：加密/非本协议
    const body = raw.slice(2, 20);
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += body[i] & 0xff;
    if ((sum & 0x1f) !== (body[17] & 0x1f)) return []; // CRC

    const packetType = body[16] & 0xff;
    const payload = [first, ...body.slice(0, 16), (body[17] & 0xe0) >> 5];

    if (packetType === this.PACKET_WEIGHT) {
      const encoded = this._u32(payload, 1);
      const f = this.weightFields(encoded);
      return [{ type: 'weight', weightKg: f.weightKg, stable: f.stable, algType: payload[payload.length - 2] & 0xff }];
    }
    if (packetType === this.PACKET_ADC) {
      const count = payload[1] & 0xff;
      let offset = 3;
      const adcs = [];
      for (let i = 0; i < count; i++) {
        if (offset + 2 > payload.length) return [];
        adcs.push(this._u16(payload, offset));
        offset += 2;
      }
      if (offset >= payload.length) return [];
      const mode = payload[offset] & 0xff;
      offset += 1;
      let weightKg = null, stable = false;
      if (mode === 1 && offset + 4 <= payload.length) {
        const f = this.weightFields(this._u32(payload, offset));
        weightKg = f.weightKg;
        stable = f.stable;
      }
      const algType = payload[payload.length - 2] & 0xff;
      return [{
        type: 'adc', adcs, impedances: this.normalizeImpedances(adcs, weightKg),
        weightKg, stable, algType
      }];
    }
    return [];
  },

  // 体重编码字段：低 18 位 = 克，bits18-20 = 分度，bit31 = 稳定
  weightFields(encoded) {
    encoded = encoded >>> 0;
    const grams = encoded & 0x3ffff;
    const kgDivision = (encoded & 0x1c0000) >>> 18;
    const precision = [0, 1, 2].includes(kgDivision) ? 2 : 1;
    return { weightKg: this.g2kg(grams, kgDivision, precision), stable: !!((encoded >>> 31) & 1) };
  },

  // 阻抗规整：5 频率重排；≥1500 的原始值按体重修正
  normalizeImpedances(adcs, weightKg) {
    if (adcs.length === 5) {
      return [adcs[4], adcs[0], adcs[1], adcs[2], adcs[3]].map(v => Math.round(v * 100) / 100);
    }
    return adcs.map(v => {
      let adjusted = v;
      if (adjusted >= 1500 && (weightKg || 0) > 0) {
        adjusted = (((adjusted - 1000) + ((weightKg * 10) * -0.4)) / 0.6) / 10;
      }
      return Math.round(adjusted * 100) / 100;
    });
  },

  // 克 → kg（按分度取整到秤的显示精度），与参考实现的整数运算一致
  g2kg(grams, division, precision) {
    return this._gunit(grams / 1000, division, precision);
  },
  _getInt(v) {
    const whole = Math.trunc(v);
    return (Math.trunc(v * 10) % 10) >= 9 ? whole + 1 : whole;
  },
  _gunit(value, division, precision) {
    switch (division) {
      case 0: return Math.trunc((this._getInt(value * 1000) + 5) / 10) / 100;
      case 1: {
        let raw = this._getInt(value * 1000);
        if (raw % 10 === 9) raw += 10;
        let scaled = Math.trunc(raw / 10);
        if (scaled % 2 !== 0) scaled += 1;
        return scaled / 100;
      }
      case 2: {
        const raw = Math.trunc((this._getInt(value * 1000) + 20) / 10);
        const scaled = (raw % 10) >= 5 ? (Math.trunc(raw / 10) * 10) + 5 : Math.trunc(raw / 10) * 10;
        return scaled / 100;
      }
      case 3: return Math.trunc((this._getInt(value * 100) + 5) / 10) / 10;
      case 4: {
        let raw = this._getInt(value * 100);
        if (raw % 10 === 9) raw += 10;
        let scaled = Math.trunc(raw / 10);
        if (scaled % 2 !== 0) scaled += 1;
        return scaled / 10;
      }
      default: return parseFloat(value.toFixed(precision));
    }
  },
  _u16(b, o) { return ((b[o] & 0xff) << 8) | (b[o + 1] & 0xff); },
  _u32(b, o) { return (((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff)) >>> 0; },

  // ===== 体成分（Segal 1988 BIA 公式估算，与 ant-afu-scale 系实现一致） =====
  // impedances 里取第一落在 100~1500Ω 的值；无有效阻抗 → Deurenberg BMI 公式兜底
  estimateBodyComposition(weightKg, heightCm, age, isMale, impedances) {
    if (!(weightKg > 0) || !(heightCm > 0) || !(age > 0)) return null;
    const resistance = (impedances || []).find(z => z >= 100 && z <= 1500);
    let baseBodyFat, model, ffm;
    if (resistance != null) {
      const seg = this._segalFfm(weightKg, heightCm, age, isMale, resistance);
      ffm = Math.min(Math.max(seg.ffm, weightKg * 0.35), weightKg * 0.97);
      baseBodyFat = 100 * (weightKg - ffm) / weightKg;
      model = seg.model;
    } else {
      const bmi = weightKg / ((heightCm / 100) * (heightCm / 100));
      const sexValue = isMale ? 1 : 0;
      baseBodyFat = (1.20 * bmi) + (0.23 * age) - (10.8 * sexValue) - 5.4;
      model = 'deurenberg_bmi_fallback';
      ffm = weightKg * (1 - baseBodyFat / 100);
    }
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const bodyFat = clamp(baseBodyFat, isMale ? 3 : 8, 60);
    const lean = 100 - bodyFat;
    const r1 = (v) => Math.round(v * 10) / 10;
    const kg = (p) => r1(weightKg * p / 100);
    const musclePercent = clamp(100 - bodyFat - (isMale ? 4.5 : 4.0), 20, 95);
    const bodyFatR = r1(bodyFat);
    const ffmR = r1(weightKg - weightKg * bodyFat / 100);
    return {
      model,
      resistanceOhm: resistance != null ? Math.round(resistance) : null,
      bodyFatPercent: bodyFatR,
      fatFreeMassKg: ffmR,
      musclePercent: r1(musclePercent),
      muscleMassKg: kg(musclePercent),
      waterPercent: r1(clamp(lean * 0.70, 25, 80)),
      proteinPercent: r1(clamp(lean * 0.238, 5, 35)),
      bonePercent: r1(isMale ? 4.5 : 4.0),
      boneMassKg: kg(isMale ? 4.5 : 4.0),
      skeletalMusclePercent: r1(clamp(musclePercent * 0.527, 10, 70)),
      subcutaneousFatPercent: r1(clamp(bodyFat * 0.72, 1, bodyFat)),
      visceralFatIndex: null // Segal 估算不含内脏脂肪，BODY_METRICS 相应行会跳过
    };
  },

  _segalFfm(weightKg, heightCm, age, isMale, resistance) {
    const h2 = heightCm * heightCm;
    const fatOf = (ffm) => 100 * (weightKg - ffm) / weightKg;
    if (isMale) {
      let ffm = 9.33285 + 0.00066360 * h2 - 0.02117 * resistance + 0.62854 * weightKg - 0.12380 * age;
      if (fatOf(ffm) < 20) return { ffm, model: 'segal_3a_male_lt20' };
      ffm = 14.52435 + 0.00088580 * h2 - 0.02999 * resistance + 0.42688 * weightKg - 0.07002 * age;
      return { ffm, model: 'segal_3b_male_ge20' };
    }
    let ffm = 10.43485 + 0.00064602 * h2 - 0.01397 * resistance + 0.42087 * weightKg;
    if (fatOf(ffm) < 30) return { ffm, model: 'segal_3c_female_lt30' };
    ffm = 9.37938 + 0.00091186 * h2 - 0.01466 * resistance + 0.29990 * weightKg - 0.07012 * age;
    return { ffm, model: 'segal_3d_female_ge30' };
  }
};

// ===== PROFILE.md 解析（秤 profile 帧 + 体成分 + BMR 都需要） =====

// 宽容解析；缺项用默认值（男/30岁/170cm/目标65kg）
export function parseProfileMd(md) {
  const out = { sex: 1, age: 30, heightCm: 170, targetKg: 65, name: '' };
  if (!md) return out;
  const pick = (re) => {
    const m = md.match(re);
    return m ? m[1] : null;
  };
  const gender = pick(/性别[：:]\s*(男|女)/);
  if (gender) out.sex = gender === '男' ? 1 : 0;
  const age = pick(/年龄[：:]\s*(\d{1,3})/);
  if (age) out.age = Math.min(120, Math.max(10, parseInt(age, 10)));
  const height = pick(/身高[：:]\s*(\d{2,3})/);
  if (height) out.heightCm = Math.min(250, Math.max(90, parseInt(height, 10)));
  const target = pick(/目标体重[：:]\s*(\d{2,3}(?:\.\d+)?)/) || pick(/初始体重[：:]\s*(\d{2,3}(?:\.\d+)?)/);
  if (target) out.targetKg = Math.min(200, Math.max(25, parseFloat(target)));
  const name = pick(/昵称[：:]\s*([^\n]+)/);
  if (name) out.name = name.trim();
  return out;
}

// ===== BODY_METRICS.md 落盘 =====

// 把一次称重写入 BODY_METRICS.md：体重趋势表追加一行 + 重写「最新数据」区。
// 与 AI 的写入格式完全一致（CLAUDE.md 规范：| MM-DD | 体重 | 变化 |），
// AI 每轮对话都会被注入该文件内容，落盘即对 AI 可见。
// now: Date（可注入测试时间）。historyRecords: 会话开始时导出的历史记录（可选，补表用）。
export async function recordBodyMeasurement(fm, measurement, profile, now = new Date(), historyRecords = []) {
  const existing = await fm.readFile('BODY_METRICS.md') || '';
  const md = measurement.timestamp ? new Date(measurement.timestamp * 1000) : now;
  const mmdd = `${String(md.getMonth() + 1).padStart(2, '0')}-${String(md.getDate()).padStart(2, '0')}`;
  const yyyy = String(md.getFullYear()).padStart(4, '0');
  const weightKg = measurement.weightKg;
  const kg1 = Math.round(weightKg * 10) / 10;

  // 解析现有趋势行（与 stats-manager 同口径）
  const rowRe = /^\s*\|\s*(\d{2}-\d{2})\s*\|\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤)?\s*\|.*$/gm;
  const rows = [];
  let m;
  while ((m = rowRe.exec(existing)) !== null) rows.push({ md: m[1], weight: parseFloat(m[2]) });
  const dup = rows.some(r => r.md === mmdd && Math.abs(r.weight - kg1) < 0.05);

  // 组装新表体：旧行 + 补历史 + 本次（变化列随后统一重算）
  const tableRows = rows.map(r => `| ${r.md} | ${r.weight.toFixed(1)} |`);
  for (const rec of historyRecords) {
    const d = rec.timestampEpochSeconds ? new Date(rec.timestampEpochSeconds * 1000) : now;
    const rd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rk = Math.round((rec.weightGrams / 1000) * 10) / 10;
    if (!tableRows.some(t => t.startsWith(`| ${rd} |`) && t.includes(`| ${rk.toFixed(1)}`))) {
      tableRows.push(`| ${rd} | ${rk.toFixed(1)} |`);
    }
  }
  // 变化基准 = 补录历史之后的实际上一行（新增行之前）
  const prevWeight = tableRows.length > 0
    ? parseFloat(tableRows[tableRows.length - 1].match(/\|\s*\d{2}-\d{2}\s*\|\s*(\d+(?:\.\d+)?)\s*\|/)[1])
    : null;
  if (!dup) tableRows.push(`| ${mmdd} | ${kg1.toFixed(1)} |`);
  const diff = prevWeight === null ? null : Math.round((kg1 - prevWeight) * 10) / 10;

  // 体重变化列：与 AI 写法一致（相对上一行），重算每行变化
  const finalRows = [];
  let lastW = null;
  for (const line of tableRows) {
    const wm = line.match(/^\|\s*(\d{2}-\d{2})\s*\|\s*(\d+(?:\.\d+)?)\s*\|/);
    if (!wm) continue;
    const w = parseFloat(wm[2]);
    const c = lastW === null ? '-' : `${(Math.round((w - lastW) * 10) / 10) > 0 ? '+' : ''}${(Math.round((w - lastW) * 10) / 10).toFixed(1)}`;
    finalRows.push(`| ${wm[1]} | ${w.toFixed(1)} | ${c} |`);
    lastW = w;
  }

  // 最新数据区（含体成分时一并写入，AI 可直接读到）
  const bmi = (weightKg / Math.pow(profile.heightCm / 100, 2)).toFixed(1);
  const bmr = profile.sex === 1
    ? Math.round(10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age + 5)
    : Math.round(10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age - 161);
  const dateStr = `${yyyy}-${mmdd}`;
  const lines = [
    `- 日期: ${dateStr}`,
    `- 体重: ${kg1.toFixed(1)}kg`,
    `- BMI: ${bmi}`,
    `- 基础代谢: ~${bmr} kcal`
  ];
  if (measurement.impedanceOhm) lines.push(`- 阻抗: ${Math.round(measurement.impedanceOhm)}Ω（体脂秤测量）`);
  if (measurement.bodyFatPercent != null) {
    lines.push(`- 体脂率: ${measurement.bodyFatPercent.toFixed(1)}%（体脂秤）`);
    const c = measurement.composition;
    if (c) {
      lines.push(`- 骨骼肌率: ${c.skeletalMusclePercent.toFixed(1)}%`);
      lines.push(`- 体水分率: ${c.waterPercent.toFixed(1)}%`);
      lines.push(`- 蛋白质率: ${c.proteinPercent.toFixed(1)}%`);
      lines.push(`- 骨量: ${c.boneMassKg.toFixed(2)}kg`);
      if (c.visceralFatIndex != null) lines.push(`- 内脏脂肪指数: ${c.visceralFatIndex}`);
    }
  }
  const latestBlock = `## 最新数据\n${lines.join('\n')}`;

  // 重建文件：替换「最新数据」区 + 「体重趋势」表（其他区原样保留）
  const tableBlock = `## 体重趋势\n| 日期 | 体重 | 变化 |\n|------|------|------|\n${finalRows.map(r => r + '\n').join('')}`.trimEnd();
  let content;
  if (existing) {
    content = existing
      .replace(/## 最新数据[\s\S]*?(?=\n## |\n*$)/, latestBlock)
      .replace(/## 体重趋势\n\|[^\n]*\|\n\|[-\s|]*\|\n(?:\|.*\n?)*/, tableBlock);
    // 表体替换失败（AI 写法偏差等）→ 整节重建；节缺失 → 追加到文件末尾
    if (!dup && !content.includes(`| ${mmdd} | ${kg1.toFixed(1)} |`)) {
      content = content.replace(/## 体重趋势[\s\S]*?(?=\n## |\n*$)/, tableBlock);
      if (!content.includes('## 体重趋势')) {
        content = content.trimEnd() + '\n\n' + tableBlock + '\n';
      }
    }
  } else {
    content = `---\nupdated: ${dateStr}\n---\n\n# 身体指标追踪\n\n${latestBlock}\n\n${tableBlock}\n`;
  }

  await fm.writeFile('BODY_METRICS.md', content.trimEnd() + '\n');
  scaleLog('I', `BODY_METRICS.md 已更新: ${dateStr} ${kg1.toFixed(1)}kg（上次 ${prevWeight === null ? '无' : prevWeight.toFixed(1) + 'kg'}，${dup ? '同日同重跳过追加' : `diff=${diff === null ? '-' : diff}，新增趋势行`}，历史补录 ${historyRecords.length} 条）`);
  return { prevWeight, diff, bmi, bmr, addedRow: !dup, dateStr };
}

// ===== BLE 会话管理 =====

export class ScaleManager {
  constructor(fileManager) {
    this.fm = fileManager;
    this._session = null;
    _logFm = fileManager; // 调试日志持久化注入
  }

  // 原生蓝牙插件（Web 环境无桥接返回 null）
  static plugin() {
    return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins
      && window.Capacitor.Plugins.BluetoothLe) || null;
  }

  isAvailable() {
    return !!ScaleManager.plugin();
  }

  // 会话进行中（防重复开称）
  isBusy() {
    return !!(this._session && !this._session.done);
  }

  // 主流程：扫描 → 连接 → 订阅 → 握手 → 等称重 → 提交 → 返回结果
  // hooks: { onStatus(stage, detail), onLiveWeight(kg), onHistory(count) }
  async startSession(hooks = {}) {
    if (this.isBusy()) throw new Error('已有称重进行中');
    const ble = ScaleManager.plugin();
    if (!ble) throw new Error('此功能需要安装版 App（浏览器不支持蓝牙），请使用轻伴 APK');

    const session = {
      ble, hooks, done: false,
      seq: ++_sessionSeq, stage: 'init',
      deviceId: null, listeners: [], writeService: null,
      // 状态机标志（对应 openScale AfuB1Handler）
      handshakeSent: false, profileSent: false, historyDumpSent: false,
      liveSeen: false, weightFinal: false, commitInProgress: false, commitStartedAt: 0,
      committedSeen: false, lastLiveWeightG: null,
      lastFrameAt: 0, weighStartedAt: 0,
      historyRecords: [], profile: null, timers: [],
      // 协议与沃莱会话状态
      protocol: null, wlDeviceType: null, wlProtocolVer: null, wlWriteMode: 'write', wlStableWeight: null,
      // 调试计数
      framesByType: {}, writesOk: 0, writesFail: 0, scanCandidates: 0,
      _lastLoggedLiveG: null, _lastLoggedLiveKg: null, _lastLoggedLiveAt: 0
    };
    // 结果 promise 在会话创建时就挂好（通知可能早于后续步骤到达）
    session.resultPromise = new Promise((resolve, reject) => {
      session.resultResolve = resolve;
      session.resultReject = reject;
    });
    // 早退路径（连接失败等）由 startSession 直接抛错，这里的空 catch 只防未处理 rejection 告警
    session.resultPromise.catch(() => {});
    session.writeChain = Promise.resolve(); // GATT 写串行化（并发写会交错）
    this._session = session;
    const status = (stage, detail) => { try { hooks.onStatus && hooks.onStatus(stage, detail); } catch (_) {} };

    try {
      const platform = (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.getPlatform)
        ? window.Capacitor.getPlatform() : 'unknown';
      scaleLog('I', `═══ 会话 #${session.seq} 开始（平台 ${platform}，插件桥接 ${!!ble}）`);
      status('init', '请求蓝牙权限…');
      await ble.initialize({ androidNeverForLocation: true });
      scaleLog('I', '蓝牙权限/初始化通过');
      // 诊断：Android<12 扫描结果依赖系统定位服务开启
      try {
        const loc = await ble.isLocationEnabled();
        scaleLog('I', `系统定位服务: ${loc && loc.value ? '开' : '关'}（Android 11 及以下扫描需要开启）`);
      } catch (_) {}
      session.stage = 'check-enabled';
      const enabled = await ble.isEnabled();
      scaleLog('I', `蓝牙开关状态: ${enabled && enabled.value ? '开' : '关'}`);
      if (!enabled || !enabled.value) {
        status('enable', '蓝牙未开启，请求开启…');
        try {
          await ble.requestEnable();
          scaleLog('I', 'requestEnable 返回（用户已同意或已开启）');
        } catch (e) {
          scaleLog('E', '蓝牙未开启且请求开启失败', { msg: e && e.message });
          throw new Error('蓝牙未开启');
        }
      }

      // ---- 扫描 ----
      session.stage = 'scan';
      status('scan', '正在搜索体脂秤…请确认秤已唤醒（轻踩一下激活）');
      const device = await this._scanForScale(session);
      session.deviceId = device.deviceId;
      session.wlDeviceType = device.wlDeviceType;
      session.wlProtocolVer = device.wlProtocolVer;
      scaleLog('I', `选定目标秤: ${device.name || '(无名)'} ${device.deviceId}`);
      session.stage = 'connect';
      status('connect', `找到 ${device.name || device.deviceId}，连接中…`);

      // ---- 连接（Android 侧连接后自动做服务发现） ----
      await this._withTimeout(ble.connect({ deviceId: session.deviceId }), AFU.CONNECT_TIMEOUT_MS, '连接超时');
      scaleLog('I', `GATT 已连接（${session.deviceId}）`);
      session.stage = 'services';
      const gatt = await ble.getServices({ deviceId: session.deviceId });
      this._setupChannels(session, gatt);

      // 用户档案（体成分计算与 profile 帧都要用）
      const profileMd = await this.fm.readFile('PROFILE.md');
      session.profile = parseProfileMd(profileMd);
      scaleLog('I', 'PROFILE.md 解析', {
        sex: session.profile.sex, age: session.profile.age,
        heightCm: session.profile.heightCm, targetKg: session.profile.targetKg,
        source: profileMd ? 'exists' : 'missing(用默认值)'
      });

      // ---- 订阅数据特征 ----
      session.stage = 'subscribe';
      for (const ch of session.notifyChars) {
        const key = `notification|${session.deviceId}|${ch.service}|${ch.characteristic}`;
        const handle = await ble.addListener(key, (event) => this._onNotify(session, event));
        session.listeners.push(handle);
        await ble.startNotifications({ deviceId: session.deviceId, service: ch.service, characteristic: ch.characteristic });
        scaleLog('I', `已订阅 ${ch.characteristic}`);
      }

      if (session.protocol === 'welland') {
        // 沃莱 27 协议：订阅成功后写一次用户资料，秤即进入测量状态
        session.stage = 'handshake';
        const p = session.profile;
        const dt = session.wlDeviceType != null ? session.wlDeviceType : 0x27;
        const quarters = Math.round(-new Date().getTimezoneOffset() * 60 / 900) & 0xff;
        await this._writeFrame(session, Welland27.buildUserInfo({
          deviceType: dt,
          nowEpochSeconds: Math.floor(Date.now() / 1000),
          utcQuarters: quarters,
          unit: 0, user: 1,
          heightCm: p.heightCm, age: p.age,
          sex: p.sex === 1 ? 1 : 2
        }), 'wl-userInfo');
        scaleLog('I', `沃莱用户资料已写（deviceType=0x${dt.toString(16)} 身高${p.heightCm} 年龄${p.age} 性别${p.sex === 1 ? 1 : 2} 时区刻度${quarters}）`);
        session.stage = 'ready';
        status('ready', '已连接 ✓ 请赤脚站上秤，保持站立直到测量完成');
      } else {
        // ---- B1 握手：时间同步 + 2x sync-request；随后请求历史导出 ----
        session.stage = 'handshake';
        session.lastFrameAt = Date.now();
        await this._sendHandshake(session);
        await this._requestHistoryDump(session);
        scaleLog('I', '握手完成：timeSync + 2x sync + historyDump(0x8e) 已发');
        session.stage = 'ready';
        status('ready', '已连接 ✓ 轻站上秤开始测量');
      }

      // 总超时兜底：3 分钟内未完成则报错
      this._armOverallTimeout(session, 180000);
      return await session.resultPromise;
    } catch (err) {
      scaleLog('E', `会话 #${session.seq} 异常退出: ${err && err.message ? err.message : err}`, sessionSnapshot(this._session));
      await this.stopSession('error');
      throw err;
    }
  }

  // 扫描 AFU 秤：全量扫描（不做 service 硬件过滤——部分秤广播不带 0xfc50 service UUID，
  // 硬件过滤会滤成 0 结果，v3.18.3 真机已踩坑），回调里按「名字含 AFU」匹配
  // （openScale 的判定法），广播带 fc50 serviceData 的无名设备作兜底候选；
  // 每个候选设备留痕进日志，便于按名字/厂商数据识别秤
  _scanForScale(session) {
    const { ble } = session;
    return new Promise(async (resolve, reject) => {
      let settled = false;
      const seen = new Map(); // deviceId -> {name, rssi}
      const cleanup = async () => {
        try { await ble.stopLEScan(); } catch (e) {
          scaleLog('W', `stopLEScan 失败: ${e && e.message}`);
        }
        try { if (session._scanHandle) await session._scanHandle.remove(); } catch (_) {}
      };
      const timer = setTimeout(async () => {
        if (settled) return;
        settled = true;
        await cleanup();
        const cand = [...seen.values()];
        scaleLog('E', `扫描超时（${AFU.SCAN_TIMEOUT_MS / 1000}s）：共见 ${cand.length} 个广播设备`, {
          candidates: cand.slice(0, 10),
          recentFramesHex: _hexRing.slice(-20)
        });
        if (cand.length === 0) {
          reject(new Error(`${AFU.SCAN_TIMEOUT_MS / 1000} 秒内未收到任何蓝牙广播：请确认手机系统「位置信息」开关已打开（Android 11 及以下扫描必需）、蓝牙已重启，再踩一下秤后重试`));
        } else {
          const named = cand.filter(c => c.name).slice(0, 4)
            .map(c => `"${c.name}"(${c.rssi}dBm)`).join('、');
          reject(new Error(`未找到名字含 AFU 的秤（附近有 ${cand.length} 个蓝牙设备${named ? '：' + named : ''}）。请踩秤唤醒后重试；仍失败请点「复制调试日志」反馈`));
        }
      }, AFU.SCAN_TIMEOUT_MS);

      try {
        session._scanHandle = await ble.addListener('onScanResult', async (result) => {
          const dev = result && (result.device || result);
          const id = dev && (dev.deviceId || dev.id);
          if (!id) return;
          const name = (result && result.localName) || (dev && dev.name) || '';
          const rssi = (result && result.rssi) != null ? result.rssi : (dev && dev.rssi);
          const sdKeys = (result && result.serviceData) ? Object.keys(result.serviceData) : [];
          const mfKeys = (result && result.manufacturerData) ? Object.keys(result.manufacturerData) : [];
          if (!seen.has(id)) {
            seen.set(id, { name, rssi });
            if (seen.size <= 20) {
              scaleLog('D', `广播 #${seen.size}: name="${name}" id=${id} rssi=${rssi} mf=[${mfKeys}] sd=[${sdKeys.map(k => k.slice(4, 8))}]`);
            }
          }
          // 匹配：名字含 AFU（主判据）；无名但 serviceData 带 fc50 的作兜底
          const nameHit = String(name).toUpperCase().includes('AFU');
          const sdHit = sdKeys.some(k => String(k).toLowerCase().includes('fc50'));
          if (!nameHit && !sdHit) return;
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          // 广播里解析沃莱协议 deviceType（0x27AC 厂商/服务数据，payload 首字节 0xAC）
          let wlDeviceType = null, wlProtocolVer = null;
          try {
            const adv = Welland27.parseAdvertisement(result.manufacturerData, result.serviceData);
            if (adv) {
              wlDeviceType = adv.ok ? adv.flags : null;
              wlProtocolVer = adv.protocolVer;
              scaleLog('I', `广播协议数据: flags=0x${adv.flags.toString(16)} category=${adv.category} subtype=${adv.subtype} protocolVer=${adv.protocolVer}${adv.ok ? '' : '（类目不符，用默认 deviceType）'}`);
            } else {
              scaleLog('W', '广播中无 0xAC 协议数据（厂商/服务数据缺失），deviceType 用默认 0x27');
            }
          } catch (e) {
            scaleLog('W', `广播协议数据解析异常: ${e && e.message}`);
          }
          await cleanup();
          scaleLog('I', `匹配到体脂秤: name="${name}" id=${id} rssi=${rssi}（依据：${nameHit ? '名字含AFU' : 'serviceData含fc50'}）`);
          resolve({ deviceId: id, name, wlDeviceType, wlProtocolVer });
        });
        // scanMode 2 = SCAN_MODE_LOW_LATENCY（前台高占空比，找秤更快）
        await ble.requestLEScan({ allowDuplicates: false, scanMode: 2 });
        scaleLog('I', 'LE 扫描已启动（全量无过滤 + LOW_LATENCY，回调内按 名字AFU/serviceData-fc50 匹配）');
      } catch (e) {
        if (!settled) {
          settled = true; clearTimeout(timer); await cleanup();
          scaleLog('E', `启动扫描失败: ${e && e.message}`);
          reject(e);
        }
      }
    });
  }

  // 从 GATT 树定位协议与通道：
  //   有 FFB0/FFB1/FFB2 → 沃莱 27 协议（AFU-WL-A1）；有 af000002 → 阿福 B1 私有协议
  _setupChannels(session, gattResult) {
    const services = (gattResult && gattResult.services) || [];
    let writeService = null;
    const notifyChars = [];
    const gattMap = []; // 调试：完整 GATT 树快照
    let wlSvc = null, wlWrite = false, wlWriteNoResp = false, wlNotify = false;
    for (const svc of services) {
      const svcUuid = String(svc.uuid || '').toLowerCase();
      for (const ch of svc.characteristics || []) {
        const uuid = String(ch.uuid || '').toLowerCase();
        const props = ch.properties || {};
        gattMap.push({ s: svcUuid.slice(4, 8), c: uuid.slice(4, 8), p: props });
        if (uuid === AFU.WRITE_CHARACTERISTIC) writeService = svcUuid || AFU.WRITE_SERVICE;
        if (svcUuid === Welland27.SERVICE) {
          if (uuid === Welland27.WRITE_CHARACTERISTIC) {
            wlSvc = svcUuid; wlWrite = true; wlWriteNoResp = !!props.writeWithoutResponse;
          }
          if (uuid === Welland27.NOTIFY_CHARACTERISTIC) wlNotify = true;
        }
        if (props.notify || props.indicate) {
          notifyChars.push({ service: svcUuid, characteristic: uuid });
        }
      }
    }
    scaleLog('I', `GATT 树 ${services.length} 个 service（短码 s/c 为 UUID 第 5-8 位）`, gattMap);

    if (wlSvc && wlWrite && wlNotify) {
      // 沃莱 27 协议（AFU-WL-TZ-A1）：只订阅 FFB2，命令写 FFB1
      session.protocol = 'welland';
      session.writeService = wlSvc;
      session.wlWriteMode = wlWriteNoResp ? 'writeWithoutResponse' : 'write';
      session.notifyChars = [{ service: wlSvc, characteristic: Welland27.NOTIFY_CHARACTERISTIC }];
      scaleLog('I', `协议识别：沃莱27（A1）— 写 ${wlWriteNoResp ? 'FFB1(no-response)' : 'FFB1(with-response)'} / 订阅 FFB2`);
      return;
    }
    if (writeService) {
      session.protocol = 'afu-b1';
      session.writeService = writeService;
      session.notifyChars = notifyChars;
      scaleLog('I', `协议识别：阿福B1 — 写=${writeService.slice(4, 8)}/${AFU.WRITE_CHARACTERISTIC.slice(4, 8)} 订阅=${notifyChars.length} 个`,
        notifyChars.map(c => `${c.service.slice(4, 8)}/${c.characteristic.slice(4, 8)}`));
      if (notifyChars.length === 0) {
        scaleLog('E', 'GATT 树中没有任何 notify/indicate 特征，秤无法回报数据', getScaleDump());
        throw new Error('体脂秤未提供数据通道（特征订阅失败）');
      }
      return;
    }
    scaleLog('E', 'GATT 树既无沃莱 FFB0/FFB1/FFB2 也无 af000002 写通道——未知协议', getScaleDump());
    throw new Error('这台秤的蓝牙协议暂不支持（详见调试日志）');
  }

  // 写帧（串行：ACK/握手/提交可能并发触发，GATT 写必须排队）；label 用于日志定位
  _writeFrame(session, frameBytes, label = 'frame') {
    const { ble } = session;
    const hex = bytesToHex(frameBytes);
    const method = session.wlWriteMode === 'writeWithoutResponse' ? 'writeWithoutResponse' : 'write';
    const run = async () => {
      try {
        await ble[method]({
          deviceId: session.deviceId,
          service: session.writeService,
          characteristic: session.protocol === 'welland' ? Welland27.WRITE_CHARACTERISTIC : AFU.WRITE_CHARACTERISTIC,
          value: hex
        });
        session.writesOk++;
        scaleLog('D', `TX ${label}: ${hex}`);
      } catch (e) {
        session.writesFail++;
        scaleLog('W', `TX ${label} 失败: ${e && e.message}（${hex}）`);
        throw e;
      }
    };
    session.writeChain = session.writeChain.then(run, run);
    return session.writeChain;
  }

  // 握手：时间同步 + 2x sync-request（不能先发 profile，否则秤切进称重模式阻塞历史）
  async _sendHandshake(session) {
    const now = Math.floor(Date.now() / 1000);
    await this._writeFrame(session, AfuB1.buildTimeSync(now), 'timeSync');
    await this._writeFrame(session, AfuB1.buildSyncRequest('FIRST'), 'syncReq-1');
    await this._writeFrame(session, AfuB1.buildSyncRequest('SECOND'), 'syncReq-2');
    session.handshakeSent = true;
  }

  async _sendSyncPair(session) {
    await this._writeFrame(session, AfuB1.buildSyncRequest('FIRST'), 'syncReq-1');
    await this._writeFrame(session, AfuB1.buildSyncRequest('SECOND'), 'syncReq-2');
  }

  async _sendProfile(session, variantName) {
    const p = session.profile;
    await this._writeFrame(session, AfuB1.buildUserProfile(
      variantName, Math.floor(Date.now() / 1000), 1, p.age, p.sex, p.targetKg), `profile-${variantName}`);
  }

  async _requestHistoryDump(session) {
    const p = session.profile;
    await this._writeFrame(session, AfuB1.buildHistoryDumpRequest(
      Math.floor(Date.now() / 1000), 1, p.age, p.sex, p.targetKg), 'historyDump-0x8e');
  }

  // 通知回调（hex → 帧 → 状态机）
  _onNotify(session, event) {
    const hexStr = event && event.value;
    if (typeof hexStr !== 'string' || !hexStr) {
      scaleLog('W', `RX 空通知（event=${JSON.stringify(event && event.value)}）`);
      return;
    }
    logHexRing(hexStr);
    if (session.protocol === 'welland') {
      this._onWellandNotify(session, hexStr);
      return;
    }
    let frame;
    try { frame = AfuB1.parse(hexToBytes(hexStr)); } catch (e) {
      scaleLog('W', `RX 解析异常: ${e && e.message}（${hexStr}）`);
      return;
    }
    if (!frame) {
      // 标注拒因，便于区分「非 AFU 帧」与「CRC 坏帧」（后者多见于蓝牙丢包/MTU 问题）
      const b = hexToBytes(hexStr);
      const why = b.length !== AFU.FRAME_SIZE ? `len=${b.length}`
        : (b[0] !== 0xaf || b[1] !== 0x45) ? 'header'
        : `crc(raw[19]=${(b[19] || 0) & 0x1f},calc=${AfuB1.crc(b)})`;
      scaleLog('D', `RX 非 AFU 帧（${why}）: ${hexStr}`);
      return;
    }
    session.framesByType[frame.type] = (session.framesByType[frame.type] || 0) + 1;
    session.lastFrameAt = Date.now();

    switch (frame.type) {
      case 'live': this._onLive(session, frame, hexStr); break;
      case 'stored': this._onStored(session, frame, hexStr); break;
      case 'impedance':
        scaleLog('I', `RX 0x52 阻抗结果: valid=${frame.valid} adc=${frame.adcOhms}Ω（${hexStr}）`);
        this._writeFrame(session, AfuB1.buildAck(frame.ackReplyByte, 0), 'ack-0x52').catch(() => {});
        break;
      case 'chunk': // 加密报告分片，内容不可解；必须 ACK 否则秤会重发卡住流程
        scaleLog('D', `RX 0x14 报告分片 #${frame.chunkIndex}（丢弃，仅 ACK）`);
        this._writeFrame(session, AfuB1.buildAck(frame.ackReplyByte, 0), 'ack-chunk').catch(() => {});
        break;
      case 'ack':
        scaleLog('D', `RX ACK reply_cmd=0x${frame.replyCmd.toString(16)} op=0x${frame.replyOp.toString(16)}`);
        break;
      default:
        scaleLog('D', `RX 控制帧 cmd=0x${frame.cmd.toString(16)}（${hexStr}）`);
        break;
    }
  }

  // ===== 沃莱 27 协议事件处理（AFU-WL-A1） =====
  // 流程：0xD5 实时体重帧（bit31=稳定）→ 稳定后秤测阻抗 → 0xD6 ADC 帧即完成
  _onWellandNotify(session, hexStr) {
    let events;
    try { events = Welland27.decode(hexToBytes(hexStr)); } catch (e) {
      scaleLog('W', `沃莱帧解析异常: ${e && e.message}（${hexStr}）`);
      return;
    }
    if (events.length === 0) {
      // 非 0xAC 数据帧（如加密分片）——留痕即可
      scaleLog('D', `RX 非数据帧: ${hexStr}`);
      return;
    }
    session.lastFrameAt = Date.now();
    for (const ev of events) {
      session.framesByType[ev.type] = (session.framesByType[ev.type] || 0) + 1;
      if (ev.type === 'weight') this._onWlWeight(session, ev, hexStr);
      else this._onWlAdc(session, ev, hexStr);
    }
  }

  _onWlWeight(session, ev, hexStr) {
    session.stage = 'live';
    if (!session.weighStartedAt) {
      session.weighStartedAt = Date.now();
      scaleLog('I', `上秤：首次体重帧 ${ev.weightKg}kg（${hexStr}）`);
    }
    session.lastLiveWeightG = Math.round(ev.weightKg * 1000);
    try { session.hooks.onLiveWeight && session.hooks.onLiveWeight(ev.weightKg); } catch (_) {}

    const now = Date.now();
    if (session._lastLoggedLiveKg === null
      || Math.abs(ev.weightKg - session._lastLoggedLiveKg) > 0.05
      || now - session._lastLoggedLiveAt > 2000) {
      scaleLog('D', `RX 0xD5 体重 ${ev.weightKg}kg ${ev.stable ? '稳定' : '测量中'} alg=${ev.algType}`);
      session._lastLoggedLiveKg = ev.weightKg;
      session._lastLoggedLiveAt = now;
    }

    if (ev.stable && !session.weightFinal) {
      session.weightFinal = true;
      session.wlStableWeight = ev.weightKg;
      session.stage = 'locked';
      scaleLog('I', `体重稳定 ${ev.weightKg}kg → 等待阻抗帧 0xD6（15s 无阻抗则按仅体重收尾）`);
      try { session.hooks.onStatus && session.hooks.onStatus('locked', '体重已锁定，请保持站立测量体脂…'); } catch (_) {}
      // 兜底：稳定后 15s 仍无 ADC（穿鞋/快速称重）→ 仅体重收尾
      session.timers.push(setTimeout(() => {
        if (!session.done && !session.committedSeen && session.wlStableWeight != null) {
          scaleLog('W', '稳定体重后 15s 未收到阻抗帧 → 按仅体重收尾（无体脂率）');
          this._finishWl(session, session.wlStableWeight, null);
        }
      }, 15000));
    }
  }

  _onWlAdc(session, ev, hexStr) {
    if (session.done || session.committedSeen) return;
    session.committedSeen = true;
    const weight = ev.weightKg != null ? ev.weightKg : session.wlStableWeight;
    if (weight == null) {
      scaleLog('W', `RX 0xD6 阻抗帧但无体重（adc=${JSON.stringify(ev.adcs)}），等待后续帧`, { hexStr });
      session.committedSeen = false;
      return;
    }
    scaleLog('I', `RX 0xD6 阻抗帧: adc=${JSON.stringify(ev.adcs)} 阻抗=${JSON.stringify(ev.impedances)} 体重=${ev.weightKg ?? '沿用稳定值'} alg=${ev.algType}（${hexStr}）`);
    this._finishWl(session, weight, ev);
  }

  // 沃莱协议收尾：Segal 公式估算体成分 → 走统一 _finish
  _finishWl(session, weightKg, adcEv) {
    const p = session.profile || parseProfileMd(null);
    const impedances = adcEv ? adcEv.impedances : null;
    const comp = adcEv
      ? Welland27.estimateBodyComposition(weightKg, p.heightCm, p.age, p.sex === 1, impedances)
      : null;
    const resistance = comp && comp.resistanceOhm != null ? comp.resistanceOhm
      : (impedances ? (impedances.find(z => z >= 100 && z <= 1500) ?? null) : null);
    scaleLog('I', `沃莱测量完成: ${weightKg}kg 阻抗=${resistance ?? '无'} 体脂率=${comp ? comp.bodyFatPercent + '%' : '—(无阻抗)'} 模型=${comp ? comp.model : '—'}`);
    this._finish(session, {
      weightKg,
      impedanceOhm: resistance,
      bodyFatPercent: comp ? comp.bodyFatPercent : null,
      composition: comp,
      timestamp: null,
      source: adcEv ? 'welland' : 'welland-weight-only'
    });
  }

  // 实时体重 0x51（B1 协议）
  _onLive(session, frame, hexStr) {
    session.liveSeen = true;
    session.stage = 'live';
    if (!session.weighStartedAt) {
      session.weighStartedAt = Date.now();
      scaleLog('I', `上秤：首次实时帧 ${frame.weightGrams}g（${hexStr}）`);
    }
    session.lastLiveWeightG = frame.weightGrams;
    try { session.hooks.onLiveWeight && session.hooks.onLiveWeight(frame.weightGrams / 1000); } catch (_) {}

    // 实时流限流记日志：首帧/变化>50g/锁定翻转/每 2s 一条
    const g = frame.weightGrams;
    const now = Date.now();
    if (session._lastLoggedLiveG === null
      || Math.abs(g - session._lastLoggedLiveG) > 50
      || now - session._lastLoggedLiveAt > 2000) {
      scaleLog('D', `RX 0x51 实时 ${g / 1000}kg mode=0x${frame.mode.toString(16)} ${frame.locked ? '锁定' : '测量中'}`);
      session._lastLoggedLiveG = g;
      session._lastLoggedLiveAt = now;
    }

    if (!session.profileSent && session.handshakeSent) {
      session.profileSent = true;
      scaleLog('I', '实时称重已开始 → 发送 INITIAL profile(0x3f)');
      this._sendProfile(session, 'INITIAL').catch(() => {});
    }
    // 锁定位=1：体重已定 → ACK + 等下秤后提交
    if (frame.locked && !session.weightFinal && session.handshakeSent) {
      session.weightFinal = true;
      session.stage = 'locked';
      scaleLog('I', `体重锁定 ${(g / 1000).toFixed(2)}kg → ACK 并等待下秤（静默 ${AFU.IDLE_DELAY_MS}ms 后提交）`);
      this._writeFrame(session, AfuB1.buildAck(AFU.WIRE_LIVE_WEIGHT, 0), 'ack-0x51').catch(() => {});
      this._startCommitFlow(session);
    }
  }

  // 存储记录 0x54
  _onStored(session, frame, hexStr) {
    // 先 ACK（导出模式下不 ACK 秤不发下一条；correlation 带上序号）
    this._writeFrame(session, AfuB1.buildAck(AFU.WIRE_STORED_RECORD, frame.sequence), `ack-0x54(seq=${frame.sequence})`).catch(() => {});

    // 空闲收到记录但导出请求还没落地（连接初期的 0x8e 可能被秤忽略）→ 首条记录时补发
    if (!session.liveSeen && !session.historyDumpSent) {
      session.historyDumpSent = true;
      scaleLog('I', '空闲首条 0x54 → 补发历史导出请求 0x8e');
      this._requestHistoryDump(session).catch(() => {});
    }

    // 本次称重的新记录？（提交中 + 时间在本轮称重内 + 体重与锁定值吻合）
    if (this._isFreshCommitted(session, frame)) {
      session.committedSeen = true;
      scaleLog('I', `RX 0x54 本次称重新记录: ${(frame.weightGrams / 1000).toFixed(2)}kg 阻抗=${frame.resistanceOhms}Ω ts=${frame.timestampEpochSeconds}（${hexStr}）`);
      this._finish(session, {
        weightKg: frame.weightGrams / 1000,
        impedanceOhm: frame.resistanceOhms || null,
        timestamp: frame.timestampEpochSeconds,
        source: 'stored'
      });
      return;
    }

    // 其余为历史记录（含秤空闲时反复重发的当前锁定记录——去重后入库）
    const rec = {
      timestampEpochSeconds: frame.timestampEpochSeconds,
      weightGrams: frame.weightGrams,
      resistanceOhms: frame.resistanceOhms
    };
    const dup = session.historyRecords.some(r =>
      r.timestampEpochSeconds === rec.timestampEpochSeconds && r.weightGrams === rec.weightGrams);
    if (!dup) {
      session.historyRecords.push(rec);
      scaleLog('D', `RX 0x54 历史记录 #${session.historyRecords.length}: ts=${frame.timestampEpochSeconds} ${(frame.weightGrams / 1000).toFixed(1)}kg 阻抗=${frame.resistanceOhms}Ω${frame.locked ? ' [锁定]' : ''}（${hexStr}）`);
      try { session.hooks.onHistory && session.hooks.onHistory(session.historyRecords.length); } catch (_) {}
    } else {
      scaleLog('D', `RX 0x54 重复历史记录（ts=${frame.timestampEpochSeconds} ${frame.weightGrams}g），已去重`);
    }
  }

  _isFreshCommitted(session, frame) {
    if (!session.commitInProgress || !session.weighStartedAt) return false;
    const nowSecs = Math.floor(Date.now() / 1000);
    const ts = frame.timestampEpochSeconds;
    if (ts < Math.floor(session.weighStartedAt / 1000) - 60) return false;
    if (Math.abs(nowSecs - ts) > 600) return false;
    const live = session.lastLiveWeightG;
    if (live == null) return false;
    return Math.abs(frame.weightGrams - live) <= 1000;
  }

  // 锁定后：等秤静默（人下秤）→ 重新 sync + getWeighAgain 拉新记录；超时回退锁定值
  _startCommitFlow(session) {
    const status = session.hooks.onStatus;
    scaleLog('I', `提交流程启动：轮询等待秤静默（>${AFU.IDLE_DELAY_MS}ms 无帧即认为已下秤）`);
    const tick = async () => {
      if (session.done || session.committedSeen) return;
      const idleMs = Date.now() - session.lastFrameAt;
      const idle = idleMs > AFU.IDLE_DELAY_MS;
      if (idle && !session.commitInProgress) {
        session.commitInProgress = true;
        session.stage = 'commit';
        session.commitStartedAt = Date.now();
        scaleLog('I', `秤已静默 ${idleMs}ms（人已下秤）→ 发送提交序列（timeSync + sync x2 + profile 0x4b/0x5b + chunkReq）`);
        try { status && status('commit', '测量完成 ✓ 正在同步数据…'); } catch (_) {}
        try {
          await this._writeFrame(session, AfuB1.buildTimeSync(Math.floor(Date.now() / 1000)), 'timeSync-commit');
          await this._sendSyncPair(session);
          await this._sendProfile(session, 'GET_WEIGH_AGAIN_1');
          await this._sendProfile(session, 'GET_WEIGH_AGAIN_2');
          await this._writeFrame(session, AfuB1.buildChunkRequest(), 'chunkReq');
        } catch (e) {
          scaleLog('W', `提交序列部分写失败（${e && e.message}），等待超时兜底`);
        }
      }
      // 提交超时：用锁定实时值兜底（无阻抗）
      if (session.commitInProgress && session.commitStartedAt
        && Date.now() - session.commitStartedAt > AFU.COMMIT_TIMEOUT_MS
        && session.lastLiveWeightG != null) {
        session.committedSeen = true;
        scaleLog('W', `提交超时（${AFU.COMMIT_TIMEOUT_MS / 1000}s 未收到新 0x54 记录）→ 回退用锁定实时值 ${(session.lastLiveWeightG / 1000).toFixed(2)}kg（无阻抗）`, sessionSnapshot(session));
        this._finish(session, {
          weightKg: session.lastLiveWeightG / 1000,
          impedanceOhm: null,
          timestamp: null,
          source: 'live-fallback'
        });
        return;
      }
      session.timers.push(setTimeout(tick, AFU.IDLE_POLL_MS));
    };
    session.timers.push(setTimeout(tick, AFU.IDLE_POLL_MS));
  }

  // 收尾：计算体成分 → resolve → 尽量复位秤 → 断开
  async _finish(session, raw) {
    if (session.done) return;
    session.done = true;
    session.timers.forEach(clearTimeout);
    scaleLog('I', `测量结果确定: ${(raw.weightKg).toFixed(2)}kg 阻抗=${raw.impedanceOhm ?? '无'} 来源=${raw.source}（历史记录 ${session.historyRecords.length} 条）`);
    session.resultResolve && session.resultResolve({ ...raw, historyRecords: session.historyRecords });

    // B1：尽力复位秤（FINAL profile + 时间同步 + sync，武装下一次称重）；沃莱断开即可
    if (session.protocol !== 'welland') {
      try {
        await this._sendProfile(session, 'FINAL');
        await this._writeFrame(session, AfuB1.buildTimeSync(Math.floor(Date.now() / 1000)), 'timeSync-final');
        await this._sendSyncPair(session);
      } catch (e) {
        scaleLog('W', `复位秤失败（不影响本次结果）: ${e && e.message}`);
      }
    }
    await this._cleanupConnection(session);
    logSessionEnd(session, 'ok');
  }

  async _cleanupConnection(session) {
    const { ble } = session;
    for (const h of session.listeners) { try { await h.remove(); } catch (_) {} }
    session.listeners = [];
    if (session.deviceId) {
      try {
        await ble.disconnect({ deviceId: session.deviceId });
        scaleLog('I', `已断开 ${session.deviceId}`);
      } catch (e) {
        scaleLog('W', `断开失败（可忽略）: ${e && e.message}`);
      }
    }
  }

  _armOverallTimeout(session, ms) {
    setTimeout(() => {
      if (!session.done) {
        session.done = true;
        session.timers.forEach(clearTimeout);
        scaleLog('E', `会话总超时（${ms / 1000}s）——按快照排查：stage=${session.stage}`, sessionSnapshot(session));
        this._cleanupConnection(session);
        session.resultReject(new Error('称重超时：请重站上秤并保持静止，再重试'));
        logSessionEnd(session, 'timeout');
      }
    }, ms);
  }

  _withTimeout(promise, ms, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))
    ]);
  }

  // 主动停止/出错清理
  async stopSession(reason = 'stopped') {
    const session = this._session;
    if (!session) return;
    session.timers.forEach(clearTimeout);
    if (!session.done) {
      session.done = true;
      scaleLog('W', `会话 #${session.seq} 中止（${reason}）stage=${session.stage}`, sessionSnapshot(session));
      try { if (session._scanHandle) await session._scanHandle.remove(); } catch (_) {}
      try { await session.ble.stopLEScan(); } catch (_) {}
      await this._cleanupConnection(session);
      session.resultReject && session.resultReject(new Error(reason === 'error' ? '连接中断，请重试' : '已取消称重'));
      logSessionEnd(session, reason === 'error' ? 'error' : 'cancelled');
    }
    this._session = null;
  }
}
