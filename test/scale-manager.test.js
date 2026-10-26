// scale-manager.test.js — AFU-BH-TZ-B1 体脂秤协议层测试
// 金标准帧与参考值全部来自 openScale 项目 AfuB1LibTest 的真实抓包（btsnoop HCI 日志），
// 保证 JS 移植与 Android/Kotlin 参考实现逐字节一致。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AFU, AfuB1, bytesToHex, hexToBytes,
  parseProfileMd, recordBodyMeasurement, ScaleManager,
  scaleLog, getScaleLog, getScaleDump, Welland27
} from '../js/scale-manager.js';
import { mockFm } from './helpers.mjs';

const T0 = 1786810554; // 抓包时刻（2026-08 左右），与 openScale 测试一致

// ---- 帧构造：与抓包逐字节一致 ----

test('buildTimeSync 与抓包一致', () => {
  assert.equal(bytesToHex(AfuB1.buildTimeSync(T0)),
    'af4516ba90806a20000000000000000000005f09');
});

test('buildSyncRequest 两种变体与抓包一致', () => {
  assert.equal(bytesToHex(AfuB1.buildSyncRequest('FIRST')),
    'af45040001afb6171d010002b4c61b560100620f');
  assert.equal(bytesToHex(AfuB1.buildSyncRequest('SECOND')),
    'af45040103a5f8111d020004b4c61b1d0100620e');
});

test('buildUserProfile(INITIAL) 与抓包一致', () => {
  const f = AfuB1.buildUserProfile('INITIAL', 1786810580, 1, 29, 1, 50.0);
  assert.equal(bytesToHex(f), 'af453fd490806a0001afb6171d01881303006107');
});

test('buildUserProfile getWeighAgain/FINAL 变体（掩时间戳）与抓包一致', () => {
  const maskTime = (hex) => {
    const b = hexToBytes(hex);
    b[3] = b[4] = b[5] = b[6] = 0;
    b[19] = 0;
    return b;
  };
  const cases = [
    ['GET_WEIGH_AGAIN_1', 'af454ba4826a200001afb6171d01881303006115'],
    ['GET_WEIGH_AGAIN_2', 'af455ba4826a200001afd9171d01881303006108'],
    ['FINAL', 'af4568a4826a200001afd9171d01881303006115'],
  ];
  for (const [variant, captured] of cases) {
    const built = AfuB1.buildUserProfile(variant, 0, 1, 29, 1, 50.0);
    assert.deepEqual(maskTime(bytesToHex(built)), maskTime(captured), variant);
  }
});

test('buildHistoryDumpRequest 与抓包一致', () => {
  const f = AfuB1.buildHistoryDumpRequest(1786810432, 1, 29, 1, 50.0);
  assert.equal(bytesToHex(f), 'af458e4090806a0001afde171d0188130300610a');
});

test('buildChunkRequest 与抓包一致', () => {
  assert.equal(bytesToHex(AfuB1.buildChunkRequest()),
    'af45140000000000000000000000000000005f13');
});

test('buildAck 三种抓包', () => {
  assert.equal(bytesToHex(AfuB1.buildAck(AFU.WIRE_STORED_RECORD, 5)),
    'af45125400050000000000000000000000005f0a');
  assert.equal(bytesToHex(AfuB1.buildAck(AFU.WIRE_LIVE_WEIGHT, 0)),
    'af45125100000000000000000000000000005f02');
  assert.equal(bytesToHex(AfuB1.buildAck(AFU.WIRE_IMPEDANCE_RESULT, 0)),
    'af45125200000000000000000000000000005f03');
});

test('buildFrame body 长度非法时抛错', () => {
  assert.throws(() => AfuB1.buildFrame(0x16, 0x5f, [0, 0, 0]));
});

// ---- 帧解析：抓包帧 → 结构化结果 ----

test('parse 实时体重帧（未锁定）', () => {
  const f = AfuB1.parse(hexToBytes('af45b2ed080002800188384b0000000000005106'));
  assert.equal(f.type, 'live');
  assert.equal(f.weightGrams, 60850);
  assert.equal(f.mode, 0x02);
  assert.equal(f.locked, false);
});

test('parse 锁定的实时体重帧', () => {
  // 标志字占 raw[2..5]（raw[2] 同时充当实时帧的子命令字节），bit31 置位 = 锁定
  const flags = 0x8000edb2 | 0; // 60850g + locked
  const vt = AfuB1.convertIntEndian(flags) >>> 0; // BE32(swap32(flags)) 的字节序列
  const body = [(vt >>> 16) & 0xff, (vt >>> 8) & 0xff, vt & 0xff, 0x02,
    ...new Array(11).fill(0)];
  const f = AfuB1.buildFrame((vt >>> 24) & 0xff, AFU.WIRE_LIVE_WEIGHT, body);
  const parsed = AfuB1.parse(f);
  assert.equal(parsed.type, 'live');
  assert.equal(parsed.weightGrams, 60850);
  assert.equal(parsed.locked, true);
});

test('parse 历史存储记录帧', () => {
  const f = AfuB1.parse(hexToBytes('af450046a4826a7aee0880000127020000005404'));
  assert.equal(f.type, 'stored');
  assert.equal(f.historyType, 0);
  assert.equal(f.sequence, 0);
  assert.equal(f.timestampEpochSeconds, 1786946630);
  assert.equal(f.weightGrams, 61050);
  assert.equal(f.resistanceOhms, 551);
  assert.equal(f.locked, true);
});

test('parse 存储记录头字节编码序号', () => {
  // 头字节 0x14 = historyType 0 + sequence 5（bits 2..7）
  const f = AfuB1.buildFrame(0x14, AFU.WIRE_STORED_RECORD, new Array(15).fill(0));
  const h = AfuB1.parse(f);
  assert.equal(h.historyType, 0);
  assert.equal(h.sequence, 5);
  assert.equal(h.weightGrams, 0);
});

test('parse 阻抗结果帧', () => {
  const f = AfuB1.parse(hexToBytes('af4501002702000000000000000000000000521c'));
  assert.equal(f.type, 'impedance');
  assert.equal(f.valid, true);
  assert.equal(f.adcOhms, 551);
});

test('parse 报告分片帧', () => {
  const f = AfuB1.parse(hexToBytes('af4514001058a2e6e8296fe2d7799037224c5f0a'));
  assert.equal(f.type, 'chunk');
  assert.equal(f.chunkIndex, 0);
  assert.equal(f.payload.length, 14);
});

test('parse ACK 帧', () => {
  const f = AfuB1.parse(hexToBytes('af45125f16000000000000000000000000005f06'));
  assert.equal(f.type, 'ack');
  assert.equal(f.replyCmd, 0x5f);
  assert.equal(f.replyOp, 0x16);
});

// ---- 健壮性 ----

test('parse 拒绝手机→秤方向帧', () => {
  const f = AfuB1.buildUserProfile('INITIAL', 1786810580, 1, 29, 1, 50.0);
  assert.equal(AfuB1.parse(f), null);
  assert.equal(AfuB1.parse(AfuB1.buildSyncRequest('FIRST')), null);
});

test('parse 拒绝错误长度/头/CRC', () => {
  assert.equal(AfuB1.parse([0xaf]), null);
  assert.equal(AfuB1.parse(new Array(19).fill(0)), null);
  assert.equal(AfuB1.parse(new Array(21).fill(0)), null);
  const f = AfuB1.buildTimeSync(T0);
  f[0] = 0x00;
  assert.equal(AfuB1.parse(f), null);
  const g = AfuB1.buildTimeSync(T0);
  g[19] = (g[19] + 1) & 0xff;
  assert.equal(AfuB1.parse(g), null);
});

test('构造帧 CRC 自洽', () => {
  const f = AfuB1.buildTimeSync(T0);
  assert.equal(f[19] & 0x1f, AfuB1.crc(f));
});

// ---- 体成分公式：与 openScale 参考值一致 ----
// 注意：Kotlin 参考实现的 heightCm/weightKg/bodyFatPercent 是 Float 参数，
// 测试输入须先 fround 到单精度（16.7f ≠ 16.7 的 f64 表示），结果才能逐位对齐。

test('bodyFatPercent 参考值（男 29y 175cm）', () => {
  assert.equal(AfuB1.bodyFatPercent(61.0, 175.0, 29, 1, 550.0), 16.7);
  assert.equal(AfuB1.bodyFatPercent(61.1, 175.0, 29, 1, 545.0), 16.6);
  assert.equal(AfuB1.bodyFatPercent(61.0, 175.0, 29, 1, 0.0), null);
});

test('bodyFatPercent 结果裁剪在 [5,80]', () => {
  const extreme = AfuB1.bodyFatPercent(120.0, 160.0, 60, 1, 250.0);
  assert.ok(extreme >= 5 && extreme <= 80);
});

test('bodyComposition 参考值 #1（男 29y 175cm 61kg 16.7%）', () => {
  const c = AfuB1.bodyComposition(1, 29, Math.fround(175), Math.fround(61), Math.fround(16.7));
  assert.ok(c, '应返回成分对象');
  assert.equal(c.waterPercent, 56.15439616656694);
  assert.equal(c.skeletalMusclePercent, 50.25818621525999);
  assert.equal(c.boneMassKg, 2.6422760486602783);
  assert.equal(c.visceralFatIndex, 6);
  assert.equal(c.proteinPercent, 22.814002990722656);
  assert.equal(c.fatFreeMassKg, 50.8129997253418);
});

test('bodyComposition 参考值 #2（61.1kg 16.6%）', () => {
  const c = AfuB1.bodyComposition(1, 29, Math.fround(175), Math.fround(61.1), Math.fround(16.6));
  assert.ok(c, '应返回成分对象');
  assert.equal(c.waterPercent, 56.27454136258639);
  assert.equal(c.skeletalMusclePercent, 50.36572084232014);
  assert.equal(c.boneMassKg, 2.649784803390503);
  assert.equal(c.visceralFatIndex, 5);
  assert.equal(c.proteinPercent, 22.788658142089844);
  assert.equal(c.fatFreeMassKg, 50.9573974609375);
});

test('bodyComposition 拒绝超出验证范围的输入', () => {
  assert.equal(AfuB1.bodyComposition(1, 29, 175, 61, 3.9), null);
  assert.equal(AfuB1.bodyComposition(1, 29, 175, 61, 75.5), null);
  assert.equal(AfuB1.bodyComposition(1, 9, 175, 61, 20), null);
  assert.equal(AfuB1.bodyComposition(1, 29, 80, 61, 20), null);
  assert.equal(AfuB1.bodyComposition(1, 29, 175, 250, 20), null);
});

// ---- PROFILE.md 解析 ----

test('parseProfileMd 宽容解析与默认值', () => {
  const md = `# 用户档案\n\n## 基础信息\n- 昵称: 小林\n- 性别: 女\n- 年龄: 29\n- 身高: 162cm\n- 初始体重: 70.5kg\n- 目标体重: 60kg\n`;
  const p = parseProfileMd(md);
  assert.equal(p.sex, 0);
  assert.equal(p.age, 29);
  assert.equal(p.heightCm, 162);
  assert.equal(p.targetKg, 60);
  assert.equal(p.name, '小林');

  // 无目标体重时回退初始体重
  const p2 = parseProfileMd('- 性别: 男\n- 年龄: 35\n- 身高: 180cm\n- 初始体重: 90kg\n');
  assert.equal(p2.targetKg, 90);

  // 空文件用默认值
  const p3 = parseProfileMd('');
  assert.deepEqual(
    { sex: p3.sex, age: p3.age, heightCm: p3.heightCm },
    { sex: 1, age: 30, heightCm: 170 });
});

// ---- BODY_METRICS.md 落盘 ----

const TEMPLATE_MD = `---
updated: 2026-10-25
---

# 身体指标追踪

## 最新数据
- 日期: 2026-10-20
- 体重: 80.5kg
- BMI: 26.3
- 体脂率: 待测量
- 基础代谢: ~1720 kcal

## 营养目标
- 每日热量: 待计算

## 体重趋势
| 日期 | 体重 | 变化 |
|------|------|------|
| 10-18 | 81.2 | - |
| 10-20 | 80.5 | -0.7 |

## 阶段判断
减重进行中。`;

test('recordBodyMeasurement 追加趋势行并重写最新数据区', async () => {
  const fm = mockFm({ 'BODY_METRICS.md': TEMPLATE_MD });
  const meas = {
    weightKg: 79.8,
    impedanceOhm: 512,
    bodyFatPercent: 22.3,
    composition: AfuB1.bodyComposition(1, 30, 175, 79.8, 22.3),
    timestamp: Math.floor(new Date('2026-10-25T08:00:00').getTime() / 1000)
  };
  const r = await recordBodyMeasurement(fm, meas, { sex: 1, age: 30, heightCm: 175 },
    new Date('2026-10-25T08:00:00'));
  const md = await fm.readFile('BODY_METRICS.md');

  assert.equal(r.prevWeight, 80.5);
  assert.equal(r.diff, -0.7);
  assert.equal(r.addedRow, true);
  // 新行追加在表尾且变化列相对上一行
  assert.ok(md.includes('| 10-25 | 79.8 | -0.7 |'), md);
  // 旧行保留
  assert.ok(md.includes('| 10-20 | 80.5 |'));
  // 最新数据区更新
  assert.ok(md.includes('- 日期: 2026-10-25'));
  assert.ok(md.includes('- 体重: 79.8kg'));
  assert.ok(md.includes('- 体脂率: 22.3%（体脂秤）'));
  assert.ok(md.includes('- 骨骼肌率:'));
  assert.ok(md.includes('- 内脏脂肪指数:'));
  // 其他区不被破坏
  assert.ok(md.includes('## 营养目标'));
  assert.ok(md.includes('- 每日热量: 待计算'));
});

test('recordBodyMeasurement 同日同重不重复追加', async () => {
  const fm = mockFm({ 'BODY_METRICS.md': TEMPLATE_MD });
  const now = new Date('2026-10-20T09:00:00'); // 与已有行同日
  const meas = { weightKg: 80.5, impedanceOhm: null, bodyFatPercent: null, timestamp: null };
  const r = await recordBodyMeasurement(fm, meas, { sex: 1, age: 30, heightCm: 175 }, now);
  assert.equal(r.addedRow, false);
  const md = await fm.readFile('BODY_METRICS.md');
  assert.ok(!md.includes('| 10-20 | 80.5 | - |\n| 10-20 |'));
});

test('recordBodyMeasurement 首次记录（无历史）变化列为 -', async () => {
  const fm = mockFm({});
  const meas = { weightKg: 74.3, impedanceOhm: 480, bodyFatPercent: 20.1, composition: null, timestamp: null };
  const r = await recordBodyMeasurement(fm, meas, { sex: 0, age: 28, heightCm: 162 },
    new Date('2026-10-25T07:30:00'));
  const md = await fm.readFile('BODY_METRICS.md');
  assert.equal(r.prevWeight, null);
  assert.equal(r.diff, null);
  assert.ok(md.includes('| 10-25 | 74.3 | - |'));
  // 女性基础代谢走 -161 分支
  assert.ok(md.includes('- 基础代谢: ~'));
});

test('recordBodyMeasurement 补录秤内历史记录', async () => {
  const fm = mockFm({ 'BODY_METRICS.md': TEMPLATE_MD });
  const history = [
    { timestampEpochSeconds: Math.floor(new Date('2026-10-21T07:00:00').getTime() / 1000), weightGrams: 80200, resistanceOhms: 500 },
    { timestampEpochSeconds: Math.floor(new Date('2026-10-22T07:00:00').getTime() / 1000), weightGrams: 80100, resistanceOhms: 505 }
  ];
  const meas = { weightKg: 79.8, impedanceOhm: null, bodyFatPercent: null, timestamp: null };
  await recordBodyMeasurement(fm, meas, { sex: 1, age: 30, heightCm: 175 },
    new Date('2026-10-25T08:00:00'), history);
  const md = await fm.readFile('BODY_METRICS.md');
  assert.ok(md.includes('| 10-21 | 80.2 |'));
  assert.ok(md.includes('| 10-22 | 80.1 |'));
  assert.ok(md.indexOf('| 10-21 |') < md.indexOf('| 10-22 |'));
  assert.ok(md.indexOf('| 10-22 |') < md.indexOf('| 10-25 |'));
});

// ---- Welland 27 协议（AFU-WL-TZ-A1 · 沃莱 0xAC 帧） ----

// 组装一帧 20 字节沃莱数据包：first + body16 + packetType + crc(body[17] 低 5 位)
function wlFrame(first, bodyBytes, packetType, extraBits = 0) {
  const body = [...bodyBytes];
  while (body.length < 16) body.push(0);
  body.push(packetType & 0xff);
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += body[i];
  body.push((sum & 0x1f) | ((extraBits & 0x07) << 5));
  return [0x00, first & 0xff, ...body];
}

// 编码体重字（大端）：低 18 位克数 + bits18-20 分度 + bit31 稳定
function wlWeightBytes(encoded) {
  return [(encoded >>> 24) & 0xff, (encoded >>> 16) & 0xff, (encoded >>> 8) & 0xff, encoded & 0xff];
}

test('Welland27 用户资料帧布局与校验和', () => {
  const f = Welland27.buildUserInfo({
    deviceType: 0x27, nowEpochSeconds: 1786810554, utcQuarters: 32,
    unit: 0, user: 1, heightCm: 168, age: 28, sex: 1
  });
  assert.equal(f.length, 20);
  assert.equal(f[0], 0xac);
  assert.equal(f[1], 0x27);
  // 时间 4 字节大端（1786810554 = 0x6A8090BA）
  assert.deepEqual([f[2], f[3], f[4], f[5]], [0x6a, 0x80, 0x90, 0xba]);
  assert.equal(f[6], 32);       // 时区刻度
  assert.equal(f[7], 0);        // kg
  assert.equal(f[8], 1);        // 用户号
  assert.equal(f[9], 168);      // 身高
  assert.equal(f[10], 0);       // 目标体重高
  assert.equal(f[11], 0);       // 目标体重低
  assert.equal(f[12], 28);      // 年龄
  assert.equal(f[13], 1);       // 男=1
  assert.equal(f[16], 0x03);    // 功能位 bit0|bit1
  assert.equal(f[18], 0xd0);
  // 校验和 = sum(f[2..19)) & 0xFF
  let sum = 0;
  for (let i = 2; i < 19; i++) sum += f[i];
  assert.equal(f[19], sum & 0xff);
});

test('Welland27 解析 0xD5 体重帧（稳定/未稳定）', () => {
  // 74300g + 分度0 + 稳定位 → 74.3kg stable
  const enc = (0x80000000 | 74300) >>> 0;
  const stableFrame = wlFrame(0x01, wlWeightBytes(enc), Welland27.PACKET_WEIGHT);
  const ev1 = Welland27.decode(stableFrame);
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].type, 'weight');
  assert.equal(ev1[0].weightKg, 74.3);
  assert.equal(ev1[0].stable, true);

  const encU = 74300; // 未置稳定位
  const liveFrame = wlFrame(0x01, wlWeightBytes(encU), Welland27.PACKET_WEIGHT);
  const ev2 = Welland27.decode(liveFrame);
  assert.equal(ev2[0].stable, false);
  assert.equal(ev2[0].weightKg, 74.3);
});

test('Welland27 解析 0xD5 分度 1 的 0.05 步进取整', () => {
  // 分度 1（0.05kg 步进）：74310g → raw 74310 → 7431(奇)+1=7432 → 74.32kg
  const enc = ((1 << 18) | 74310) >>> 0;
  const f = wlFrame(0x01, wlWeightBytes(enc), Welland27.PACKET_WEIGHT);
  const ev = Welland27.decode(f);
  assert.equal(ev[0].weightKg, 74.32);
});

test('Welland27 解析 0xD6 阻抗帧（带体重）', () => {
  const enc = (0x80000000 | 74300) >>> 0;
  // payload: [first, count=1, ?, adc1(2B BE), mode=1, weight(4B BE), ...]
  const payload = [0x01, 0x01, 0x00, 0x01, 0xf4, 0x01, ...wlWeightBytes(enc)];
  const f = wlFrame(payload[0], payload.slice(1), Welland27.PACKET_ADC);
  const ev = Welland27.decode(f);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, 'adc');
  assert.deepEqual(ev[0].adcs, [500]);
  assert.deepEqual(ev[0].impedances, [500]); // 500 < 1500 不做修正
  assert.equal(ev[0].weightKg, 74.3);
  assert.equal(ev[0].stable, true);
});

test('Welland27 五频率阻抗重排与 ≥1500 修正', () => {
  // 5 频率：[a,b,c,d,e] → [e,a,b,c,d]
  assert.deepEqual(Welland27.normalizeImpedances([100, 200, 300, 400, 500], null), [500, 100, 200, 300, 400]);
  // 单频率 ≥1500：((1600-1000) + 74.3*10*-0.4)/0.6/10 = (600 - 297.2)/6 = 50.466→50.47
  const adj = Welland27.normalizeImpedances([1600], 74.3);
  assert.ok(Math.abs(adj[0] - 50.47) < 0.01, `实际 ${adj[0]}`);
});

test('Welland27 解析拒绝 bit7/坏 CRC/短帧', () => {
  const enc = 74300;
  const good = wlFrame(0x01, wlWeightBytes(enc), Welland27.PACKET_WEIGHT);
  // first bit7 置位
  const bad1 = [...good]; bad1[1] = 0x81;
  assert.equal(Welland27.decode(bad1).length, 0);
  // CRC 坏
  const bad2 = [...good]; bad2[19] = (bad2[19] + 1) & 0xff;
  assert.equal(Welland27.decode(bad2).length, 0);
  // 长度不足
  assert.equal(Welland27.decode([0x00, 0x01]).length, 0);
});

test('Welland27 广播解析：厂商/服务数据 → deviceType', () => {
  // 公司 0x27AC（十进制 10156），payload: AC 27(category2|subtype7) ... 第9字节协议版本 1
  const payloadHex = 'ac27' + '112233445566' + '01';
  const adv = Welland27.parseAdvertisement({ '10156': payloadHex }, {});
  assert.ok(adv, '应解析出协议数据');
  assert.equal(adv.flags, 0x27);
  assert.equal(adv.category, 2);
  assert.equal(adv.subtype, 7);
  assert.equal(adv.ok, true);
  assert.equal(adv.protocolVer, 1);
  // 无 AC 数据 → null
  assert.equal(Welland27.parseAdvertisement({ '76': '0102' }, {}), null);
  assert.equal(Welland27.parseAdvertisement({}, {}), null);
});

test('Welland27 Segal 体成分（男 74.3kg/168cm/28y/500Ω）', () => {
  const c = Welland27.estimateBodyComposition(74.3, 168, 28, true, [500]);
  assert.ok(c, '应返回成分');
  assert.equal(c.model, 'segal_3a_male_lt20'); // 估出体脂 ~18.3% < 20 → 3a 公式
  assert.ok(Math.abs(c.bodyFatPercent - 18.3) < 0.06, `体脂率 ${c.bodyFatPercent}`);
  assert.ok(Math.abs(c.fatFreeMassKg - 60.7) < 0.06, `去脂体重 ${c.fatFreeMassKg}`);
  assert.ok(Math.abs(c.waterPercent - 57.2) < 0.06, `水分 ${c.waterPercent}`);
  assert.equal(c.resistanceOhm, 500);
  assert.equal(c.visceralFatIndex, null); // Segal 估算不含内脏脂肪
});

test('Welland27 无有效阻抗 → Deurenberg 兜底', () => {
  const c = Welland27.estimateBodyComposition(74.3, 168, 28, true, []);
  assert.ok(c);
  assert.equal(c.model, 'deurenberg_bmi_fallback');
  const bmi = 74.3 / (1.68 * 1.68);
  const expectFat = 1.20 * bmi + 0.23 * 28 - 10.8 - 5.4;
  assert.ok(Math.abs(c.bodyFatPercent - expectFat) < 0.06, `体脂率 ${c.bodyFatPercent} vs ${expectFat}`);
});

// ---- ScaleManager 可用性判断 ----

test('ScaleManager 在无 Capacitor 桥接时不可用', () => {
  // node 测试环境无 window.Capacitor
  assert.equal(ScaleManager.plugin(), null);
  const sm = new ScaleManager(mockFm());
  assert.equal(sm.isAvailable(), false);
});

// ---- 调试日志 ----

test('scaleLog 三路输出：缓冲可读、结构化 data 拼入、getScaleDump 带现场', async () => {
  const marker = `日志单测-${Date.now()}`;
  scaleLog('I', marker, { a: 1 });
  const text = getScaleLog();
  assert.ok(text.includes(marker), '缓冲应包含刚写入的日志');
  assert.ok(text.includes('"a":1'), '结构化 data 应 JSON 化拼入');

  const dump = getScaleDump();
  assert.ok(Array.isArray(dump.recent) && dump.recent.length > 0);
  assert.ok(Array.isArray(dump.recentFramesHex));
});

test('scaleLog 持久化到 .meta/scale-log.md（防抖后）', async () => {
  const fm = mockFm();
  new ScaleManager(fm); // 注入日志持久化用的 fm
  const marker = `持久化单测-${Date.now()}`;
  scaleLog('I', marker);
  await new Promise(r => setTimeout(r, 1700)); // 防抖 1.5s
  const saved = await fm.readFile('.meta/scale-log.md');
  assert.ok(saved && saved.includes(marker), '防抖后应写入 .meta/scale-log.md');
});

test('recordBodyMeasurement 落盘动作会写日志', async () => {
  const fm = mockFm({ 'BODY_METRICS.md': TEMPLATE_MD });
  const meas = { weightKg: 79.8, impedanceOhm: null, bodyFatPercent: null, timestamp: null };
  await recordBodyMeasurement(fm, meas, { sex: 1, age: 30, heightCm: 175 },
    new Date('2026-10-25T08:00:00'));
  assert.ok(getScaleLog().includes('BODY_METRICS.md 已更新'), '应记录落盘结果');
});
