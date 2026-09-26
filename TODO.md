# TODO — 系统提示词无损压缩（下一版本待办）

> ✅ **状态：已完成（2026-09-26，v3.11.0 发版）。唯一未做项：read_file 截断（可选项，另立任务）**

> 制定于 2026-09-26（v3.10.0 之后）。基于实测：固定前缀 ~10.7K 字符 + 动态段，工具定义 ~4K 字符。
> 测量工具：`node scripts/measure-context.mjs`（改完复跑对比）。
> 节奏：**一次只压一节 → 跑评测集 → 通过 → 下一节**。全部完成随 v3.11.0 发版。

## 〇、前置：行为评测集（先建，后压）

- [x] `scripts/prompt-eval.mjs` + `npm run prompt:eval`：固定 8~10 个标准输入，直连真实 LLM，**只 diff 工具调用序列**（调了什么工具、write 了哪个文件），不比对文案措辞
  - 用例至少覆盖：记饮食（→write_file diet/）、记体重（→write_file BODY_METRICS）、说过敏（→write_file rules/allergies）、说运动打卡（→checkin_habit）、要推荐习惯（→suggest_habit）、要提醒（→send_notification）、需要确认细节（→ask_user）、纯闲聊（→零工具调用）
  - 基线：用当前 v11 CLAUDE.md 跑一遍存为 `scripts/prompt-eval-baseline.json`，之后每次压缩跑新提示词与之比对
- [x] CLAUDE.md 版本头 v11 → v12（压缩完成后），`file-manager._extractVersion` 启动自动升级，旧用户零操作

## 一、红线（这些一个字不动）

- [x] **饮食文件格式模板**（~500 字符）—— `stats-manager` 解析器依赖该格式，压缩模板 = 数据层回归
- [x] **数据写入判断流程**（6 条 checklist）—— 工具触发正确性的根
- [x] **数据原值保留规则** —— 摘要 / record_metrics 的事实准确性
- [x] 熬夜/时区规则（有历史 bug）、语气/语言（仅 38 字符）
- [x] 不引入 LLMLingua 类语义压缩模型；不删"必须先 write_file"护栏表述（只合并重复，保留最强一处）

## 二、分节压缩清单（按风险从低到高排序）

| # | 任务 | 现状 | 目标 | 状态 |
|---|---|---|---|---|
| 1 | 习惯打卡系统节 与 4 个工具定义去重：每工具留一行触发规则 | 953 | ~250 | ✅ |
| 2 | send_notification 节：6 示例砍到 2，保留 4 原则（type 枚举已在工具定义） | 857 | ~350 | ✅ |
| 3 | ask_user 节：5 示例砍到 2，保留使用原则短句版 | 734 | ~400 | ✅ |
| 4 | 健康生活小建议：7 类各压一短句（类别=行为，必须留全） | 498 | ~300 | ✅ |
| 5 | 数据写入规则："必须先 write_file"3 处重复合并为判断流程 + 一次最强表述 | 871 | ~600 | ✅ |
| 6 | 身体数据更新：步骤保留、示例对话砍半 | ~400 | ~250 | ✅ |
| 7 | 时间判断块（动态段，llm-service.buildSystemPrompt）：表格化，信息等价 | ~500 | ~300 | ✅ |

- 每节完成后：`npm run prompt:eval` 对比基线 → 通过 → 下一节
- 全部完成预期：CLAUDE.md 6,242 → ~4,300 字符（-30%），单次请求省 ~2,100 字符

## 三、相邻优化（同版本顺手做）

- [x] **PROFILE.md / BODY_METRICS.md 移出固定前缀**（llm-service `_fixedFiles` → 动态段）：它们被 AI 频繁写入，每记一次体重就失效整个前缀缓存；移出后前缀=纯静态（CLAUDE.md + rules），缓存存活期大幅延长。注意 `_invalidatePrefixCache` 触发清单同步调整
- [x] **data/CLAUDE.md 旧模板同步或删除**：运行时用的是 file-manager.js 内嵌 v11（6.2K），data/ 那份是 3.5K 旧模板，纯误导；三目录同步脚本已覆盖 data/，删除需同步清理 www/data 与 android assets
- [x] （可选，本轮未做）read_file 结果按 `fileTruncate` 截断——防大文件进上下文轮内放大（工具结果问题，另见 v3.9.0 讨论）

## 四、收尾发版（v3.11.0）

- [x] `scripts/measure-context.mjs` 复跑，前后数字写进 CHANGELOG
- [x] 四处版本号 + CHANGELOG（js/app.js ×2、package.json、CHANGELOG.md）
- [x] `npm run sync && npm run verify && npm test`
- [x] 真机回归：docs/REGRESSION.md 第 2 节全项（重点：饮食/体重/过敏记录行为不回归）+ 用 context 查看功能人工过一遍新提示词全文
