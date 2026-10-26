# 轻伴 MVP 变更日志

## 2026-10-26 (v3.20.2)

### 优化 — 搜秤成功率与速度

> 真机日志：一次 30s 扫描周围 5 个设备均非秤——秤未广播（未踩醒/被官方 App 占用）。本轮围绕"更易连上、失败更容易排查"强化

- **记住上次的秤**：连接成功后写入 `.meta/scale-device.json`（60 天有效），下次「蓝牙称重」**直连优先**（8s 超时自动中止挂起连接并转扫描），秤醒着时跳过扫描秒连（对齐 ant-afu-welland-scale-android 的 savedDevice 方案）
- **广播匹配加指纹**：厂商数据 companyId=0x27AC(10156) 且 payload 首字节 0xAC 即命中（秤处于隐私模式不带广播名也能识别）；匹配逻辑抽为 `Welland27.matchAdvertisement` 纯函数并补 8 断言单测（全量 187 项通过）
- **扫描窗 30s→45s**，倒计时提示"踩一下秤可唤醒；若装了阿福/Fitdays 官方 App 请先关掉（秤被占用时不会广播）"
- **报错分流**：0 广播 → 定位开关/重启蓝牙；有广播无秤 → 踩秤、关官方 App、靠近三步建议
- 近距离（rssi≥-70）无名广播的厂商数据原文进日志，便于下一轮识别"改名/隐私地址"状态的秤
- **涉及文件**：`js/scale-manager.js`、`test/scale-manager.test.js` 及三目录同步副本

## 2026-10-26 (v3.20.1)

### 修复 — 顶栏与系统状态栏重叠

> 用户截图：系统状态栏（时钟/状态图标）与轻伴顶栏叠在同一行。根因：Android 15 起对 targetSdk 35+ 的应用**强制边到边**（edge-to-edge），Capacitor 8 模板 targetSdk=36，WebView 全屏绘制、顶栏落在状态栏之下，而 CapacitorWebView 未做任何 inset 处理（源码 import 了 WindowInsetsCompat 却未使用）

- `MainActivity` 注册 `OnApplyWindowInsetsListener`：把「系统栏 + 刘海」的顶部/左右 inset 作为 `webview` 的 MarginLayoutParams 顶边距，Web 内容始终从状态栏下方开始
- 底部与键盘行为不变（`adjustResize` 继续处理软键盘）；Android 14 及以下窗口本不延伸到状态栏下、inset 为 0，行为完全不变
- opt-out 方案（`windowOptOutEdgeToEdgeEnforcement`）在 targetSdk 36 上已被 Android 16 忽略，故采用 inset 适配这条正路
- **涉及文件**：`android/app/src/main/java/com/qingban/mvp/MainActivity.java`

## 2026-10-26 (v3.20.0)

### 新增 — 支持蚂蚁阿福 A1 款体脂秤（AFU-WL-TZ-A1 · 沃莱标准协议）

> 真机调试日志确认：A1 与 openScale 逆向的 B1 是**两套完全不同的协议**（A1 连接后 GATT 树只有 FFB0/1530/1800 等服务，没有 B1 的 af0000 写通道）。v3.19.1 连上即"Characteristic not found"即为佐证。本版按 GATT 树自动识别协议，A1/B1 都支持

- **协议识别**：连接后看 GATT 树——有 `FFB0/FFB1/FFB2` → 沃莱 27 协议（A1）；有 `af000002` → 阿福 B1 私有协议（原路径保留）
- **沃莱 27 协议移植**（依据 Mzdyl/ant-afu-welland-scale-android 与 tonyupup/ha-afu-scale 公开实现）：订阅 FFB2 通知 → 向 FFB1 写用户资料帧（0xAC，含 deviceType/身高/年龄/性别/时区，deviceType 从广播 0x27AC 厂商数据解析）→ 秤推 `0xD5` 实时体重帧（低 18 位克数 + 分度位 + bit31 稳定位，按秤的分度规则取整）→ 稳定后测阻抗推 `0xD6` ADC 帧即完成
- **体成分**：Segal(1988) BIA 公式本地估算（体脂率/去脂体重/肌肉/水分/蛋白质/骨量/骨骼肌/皮下脂肪）；无有效阻抗时 Deurenberg BMI 公式兜底；体重稳定 15s 无阻抗帧（穿鞋快速称重）按仅体重收尾不报错
- **阻抗规整**：5 频率列表重排、≥1500 原始值按体重修正，与参考实现一致
- 新增 9 项协议单测（用户资料帧布局+校验和、体重帧稳定/分度取整、ADC 帧、五频重排/修正、坏帧拒绝、广播 deviceType 解析、Segal/Deurenberg 公式），全量 **186 项测试通过**
- **涉及文件**：`js/scale-manager.js`、`js/app.js` 及三目录同步副本

## 2026-10-26 (v3.19.1)

### 修复 — 真机扫描收不到任何蓝牙广播

> 调试日志定位：两轮扫描 20s 内 `onScanResult` 回调 0 次——不是"秤没匹配上"，是扫描用了 service 0xfc50 硬件过滤，秤广播包不携带该 UUID 时结果被整体滤掉。openScale 的设备判定依据是广播**名字**含 AFU，而非 service 过滤

- 扫描改为**全量无过滤**（`SCAN_MODE_LOW_LATENCY` 前台高占空比），回调内匹配：名字含 AFU（主判据）+ serviceData 带 fc50 的无名设备（兜底）
- 每个候选广播留痕进日志（名字/id/rssi/厂商与服务数据短码），秤广播名即使不同也能从日志识别
- 超时报错分两种：0 个广播 → 提示检查系统「位置信息」开关（Android 11 及以下扫描必需）并重启蓝牙；有广播但不匹配 → 列出附近设备名并提示复制日志反馈
- 扫描窗口 20s → 30s（秤常需踩一下才广播）；初始化后新增系统定位服务状态诊断日志
- **涉及文件**：`js/scale-manager.js` 及三目录同步副本

## 2026-10-25 (v3.19.0)

### 新增 — PWA 网页版适配（iOS 分享用）

> 目标：不花 99 美元、不签名出包，iPhone 用 Safari「添加到主屏幕」即可当 App 用。所有适配仅浏览器环境（`html.web-env`）生效，APK 渲染与行为不变。

- **安装体验**：补全 `manifest.json`（standalone/图标/主题色，`start_url` 改相对路径便于任意目录部署）+ `apple-touch-icon` 等 iOS 头部标签；`viewport-fit=cover` 打开安全区，顶栏避刘海、输入区避底部横条
- **数据安全**：iOS 主屏幕 Web App 本就豁免 WebKit「7 天不活跃清存储」，另申请 `navigator.storage.persist()` 防存储压力逐出
- **Service Worker**（`sw.js`，新文件）：网络优先 + 离线缓存兜底，断网也能打开界面；仅浏览器环境注册（APK 内资产随包更新，注册反而造成版本滞后）；跨域请求与 `/api/` 本地代理不碰
- **输入体验**：浏览器环境输入控件统一 16px，避免 iOS Safari 聚焦小字号输入框时强制放大页面
- **安装引导条**：iOS Safari / 微信内首次访问显示一次性引导（微信提示「在 Safari 打开」、Safari 提示「添加到主屏幕」），可关闭且 localStorage 记忆
- **蓝牙体脂秤**：非原生环境隐藏菜单项与「蓝牙称重」快捷按钮（浏览器必然不可用，防误点）
- **「Kimi K3 全量配置」预设环境自适应**：APK 维持 Coding Plan 直连默认；浏览器/PWA 自动填 Kimi 开放平台 `https://api.moonshot.cn`（openai 格式，模型 `kimi-k3`）
- **LLM 接口 CORS 实测**（2026-10-25，预检 + 错误路径）：✅ `api.deepseek.com`、`api.moonshot.cn`；❌ `spark-api-open.xf-yun.com`（403）、`open.bigmodel.cn`（无 CORS 头）、`ark.cn-beijing.volces.com`（预检过但 401 响应丢头，成功路径未验证）、`api.kimi.com/coding`（404）
- **同步范围扩展**：`icons/` 目录与 `sw.js` 纳入三目录同步（`scripts/sync-web.mjs`）；新增 `scripts/gen-icons.ps1` 从 Android 启动图标生成 PWA 图标集（192/512/180）
- **涉及文件**：`index.html`、`manifest.json`、`js/app.js`、`css/style.css`、`sw.js`（新）、`icons/`（新）、`scripts/sync-web.mjs`、`scripts/gen-icons.ps1`（新）、`docs/PWA-DEPLOY.md`（新）及三目录同步副本

## 2026-10-25 (v3.18.3)

### 优化 — 输入框上方「蓝牙称重」快捷按钮

- 聊天输入框上方新增快捷入口（⚖️ 蓝牙称重药丸按钮）：点击即打开体脂秤弹窗并**自动开始搜索**，省去再点「开始称重」的二次操作，直接进入搜秤阶段
- 称重进行中再点快捷按钮：只把弹窗调回前台，实时体重与状态不被重置
- 浏览器网页版点击仍打开弹窗并提示"请使用 APK"（快捷入口不报错、不失效）
- **涉及文件**：`js/app.js`、`index.html` 及三目录同步副本

## 2026-10-25 (v3.18.2)

### 修复 — 点击「蓝牙体脂秤」菜单无反应

> 弹窗其实已创建但不可见：`.file-viewer` 遮罩层在 CSS 中默认 `display: none`，v3.18.0 的打开逻辑只清了内联 `display`，没有写入有效值，遮罩永远停留在隐藏态

- `openScalePanel` 改为与「模型设置」弹窗同款方式：内联 `display: flex` 覆盖 CSS 默认值
- 浏览器自动化实测验证：菜单点击 → 弹窗弹出 → Web 环境正确显示「不支持蓝牙，请用 APK」提示、开始按钮禁用、调试日志按钮可见
- **涉及文件**：`js/app.js` 及三目录同步副本

## 2026-10-25 (v3.18.1)

### 增强 — 蓝牙体脂秤全链路调试日志

> 真机蓝牙问题（连不上/收不到数据/数据不对）不再靠猜：一次称重的完整过程可一键复制带走，按日志即可收敛定位

- **三路输出**：① console（`[Scale]` 前缀，chrome://inspect / adb logcat 可见）；② 内存环形缓冲（400 条上限）；③ `.meta/scale-log.md` 持久化（1.5s 防抖写入，滚动保留最近 24K 字符，记忆面板可直接查看，AI 也可 read_file 读取协助排查）
- **覆盖点**：扫描候选广播逐个留痕（name/id/rssi，排查"秤广播名不含 AFU"）；完整 GATT 树快照（service×characteristic×properties 短码表）；每一帧收发均带 hex 与用途标签（timeSync/syncReq/profile 变体/ACK/提交序列）；非 AFU 帧标注拒因（长度/头/CRC 计算值对比）；实时流限流记录（首帧/变化>50g/2s 一条/锁定翻转必记）；历史记录去重、新旧记录判定；提交静默等待与超时回退决策；会话结束快照（stage、全部状态标志、帧类型计数、写成功/失败计数、最近 20 帧 hex）
- **UI**：称重弹窗新增「🐞 调试 / 📋 复制调试日志」按钮（clipboard API + execCommand 兜底）；称重失败的状态区直接提示日志位置
- 新增 3 项日志单测（缓冲读取/防抖持久化/落盘动作记录），全量 177 项测试通过
- **涉及文件**：`js/scale-manager.js`、`js/app.js`、`index.html`、`test/scale-manager.test.js` 及三目录同步副本

## 2026-10-25 (v3.18.0)

### 新增 — 蓝牙体脂秤直连（蚂蚁阿福 AFU-BH-TZ-B1 · 沃莱代工）

> 体脂秤数据不再需要手动口述：菜单新增「蓝牙体脂秤」，APK 内通过 BLE 直读测量数据，落盘后自动交给 AI 分析

- **新增 `js/scale-manager.js`**：AFU B1 协议全量移植（20 字节定长帧/CRC/握手/历史导出/实时流/提交拉取），秤只吐「体重+阻抗」，体脂率/骨骼肌率/水分率/蛋白质率/骨量/内脏脂肪按官方 App 逆向公式本地计算（f32 舍入边界与参考实现逐位一致）；协议与公式依据 openScale 项目（GPL-3.0）公开的逆向成果重新实现，个人使用无碍、分发需注意许可证
- **AI 触发链路**：称重完成 → `recordBodyMeasurement` 以 AI 同款格式写入 BODY_METRICS.md（趋势表追加 + 最新数据区重写 + 秤内历史补录）→ 自动以「[体脂秤同步]」用户消息触发对话；BODY_METRICS.md 本就每轮动态注入系统提示词，AI 即刻可读并分析
- **CLAUDE.md v14 → v15**：新增规则——「[体脂秤同步]」消息数据已由系统写入，AI 直接读取分析、不得重复 write_file
- **UI**：功能菜单新增「蓝牙体脂秤」入口 + 称重弹窗（实时体重大字、状态提示、结果卡、取消/重称）；`sendMessage` 支持 overrideText 供系统触发路径复用全套对话管线（流式渲染/token 统计/工具日志）
- **原生接入**：`@capacitor-community/bluetooth-le@8.3.0`（项目首个社区插件），经 `window.Capacitor.Plugins.BluetoothLe` 桥接调用（与 LocalNotifications 同模式，无需打包器）；AndroidManifest 声明 `BLUETOOTH_SCAN` 并覆盖为 `neverForLocation`（Android 12+ 免位置权限，其余权限由插件清单合并）
- **浏览器网页版不支持蓝牙**（WebView/浏览器无 BLE 桥接），弹窗内明确提示，仅 APK 可用
- 新增 `test/scale-manager.test.js` 29 项：帧构造/解析与 openScale 官方抓包逐字节对齐、体成分参考值逐位一致（含 fround 单精度输入）、BODY_METRICS 落盘（追加/去重/历史补录/首记录）、PROFILE 解析、无桥接环境降级
- **涉及文件**：`js/scale-manager.js`（新增）、`js/app.js`、`js/file-manager.js`、`index.html`、`package.json`、`android/app/src/main/AndroidManifest.xml`、`test/scale-manager.test.js`（新增）及三目录同步副本

## 2026-10-24 (v3.17.0)

### 优化 — 界面现代化清新化

> 文件查看、趋势图表与整体视觉的一次系统性打磨：从"纯文本 + 方块字符"升级为现代清新的呈现

- **文件查看 Markdown 渲染**：新增零依赖 `js/md-render.js`，`.md` 文件按结构渲染 — 标题层级、表格（圆角描边、表头底色）、列表、粗体/行内代码、引用块、分隔线、代码块，front-matter（updated/version）折成日期徽标；非 md 文件保持等宽代码块展示
- **趋势图打磨**：体重图线条下方加渐变面积填充；热量图增加中位参照网格线与刻度；宏量图图例从"■字符"改为彩色圆点、堆叠柱顶圆角
- **全局质感**：按钮药丸圆角+悬浮/按压微动效；图表卡片描边+柔和阴影；弹层背景毛玻璃（blur）；细滚动条；聊天气泡柔和阴影
- 新增 `test/md-render.test.js`（渲染/转义/容错 3 组断言）
- **涉及文件**：`js/md-render.js`（新增）、`js/app.js`、`js/stats-manager.js`、`css/style.css`、`index.html` 及三目录同步副本

## 2026-10-24 (v3.16.3)

### 修复 — 打卡热力图格子挤在左上角

> v3.6.0 引入热力图时格子固定 11px、间距 4px，在 340 宽的画布上仅占 30%（101px），右侧大片空白，看起来像没有正常显示；数据链路本身正常（打卡 → JSON → 聚合 → 渲染均通）

- `StatsManager.buildHabitHeatmap` 格子尺寸按画布宽度反推（≈38px）、水平居中、高度按行数动态计算，铺满整个卡片，与体重/热量/营养素图视觉对齐
- 新增回归测试：格子宽度 ≥ 30px
- **涉及文件**：`js/stats-manager.js`、`test/stats-manager.test.js` 及三目录同步副本

## 2026-10-24 (v3.16.2)

### 修复 — 营养素日均被全零天摊薄

> 近 7 天内存在 0/0/0 营养数据的天（功能上线初期初始化写入）时，图上不显示柱子、却计入"日均"分母，导致日均与柱子标注明显对不上（柱 326g 而日均合计 164g）

- `StatsManager.buildMacroSvg` 日均分母改为"三项之和 > 0"的天，与画柱逻辑（全零天显示"无营养数据"占位）口径一致
- 新增回归测试：零数据天不影响日均
- **涉及文件**：`js/stats-manager.js`、`test/stats-manager.test.js` 及三目录同步副本

## 2026-10-24 (v3.16.1)

### 安全 — 移除内置 Kimi API Key

> 原内置 Key（曾硬编码于 `js/app-config.js`，已进入 git 历史）在官方后台吊销失效（验证返回 401），代码与 APK 从此不携带任何密钥；API Key 改为应用内「设置 → 连接配置」填写，仅存手机本地

- `js/app-config.js` 的 `apiKey` 置空；真机首次聊天前需在连接配置中填入自己的 Key
- 浏览器开发模式不受影响（走 `server.js` 代理，Key 在本地 `.env`，未入库）
- 单元测试不受影响（测试全部使用 mock，141 项全绿）
- **涉及文件**：`js/app-config.js` 及三目录同步副本

## 2026-10-24 (v3.16.0)

### 优化 — 图片预识别携带辅助上下文

> 识别阶段原本只有一句指令 + 图片（零上下文）；现注入食物种类清单与当日对话记录，视觉模型能结合"用户平时吃什么、今天聊了什么"识别，家常菜、上午提过的餐食不再凭空猜

- **上下文构成**：`rules/food-types.md`（截取前 1500 字，全部分类为"(暂无记录)"的初始模板不注入）+ 当日对话记录（`chatManager.getHistory()`，从最新往回取至多 2000 字；当前图片消息在识别完成后才入历史，不会自引用）
- **协议适配**：OpenAI 格式（APK 直连/开发模式代理）注入为 system 消息；Anthropic 协议（APK 直连）注入为顶层 `system` 字段；极简识别指令本身不变
- **健壮性**：清单/对话任一读取失败只跳过该部分，全部为空时等同旧版零上下文识别；识别失败仍回退原图直发
- **涉及文件**：`js/spark-llm.js`、`js/app.js` 及三目录同步副本

## 2026-10-24 (v3.15.0)

### 新增 — 营养分析全面加强（碳水/脂肪/微量元素，为补剂提供依据）

> 饮食记录从"仅热量"扩展为完整营养分析：三大宏量营养素（蛋白质/碳水/脂肪）量化估算 + 当日「营养观察」按食物组定性标记微量元素缺口，趋势图表、昨日总结、AI 周报全链路消费，补剂建议遵循"食物优先、持续缺口才提、遵医嘱"原则

- **记录层**：CLAUDE.md v13 → v14 — 每餐记录新增 `估算营养: 蛋白质~Xg / 碳水~Xg / 脂肪~Xg`，当日汇总新增 `总蛋白质/总碳水/总脂肪` 与 `营养观察`（无奶制品→钙、无深海鱼→omega-3、蔬果少→维C/叶酸、无粗粮→B族、红肉少→铁/B12 等食物组缺口定性标记）
- **营养目标体系**：蛋白质 = 体重kg × 1.2~1.6g、脂肪 = 体重 × 0.8~1g、碳水按热量余量换算，写入 BODY_METRICS.md「营养目标」节（新装模板自带；老用户由 AI 首次提及营养话题时补写）；对话可直接问"营养分析/缺什么/要不要补剂"，AI 汇总近 7 天饮食给结论
- **补剂原则**：食物优先；某缺口连续 3 天以上才提补剂，措辞"可以考虑"，注明个体差异、遵医嘱；不做诊断、不推荐剂量
- **结构化双写**：`record_metrics` 工具 meals 新增 `protein_g/carbs_g/fat_g`（日总量可显式传或按餐求和）；stats-manager v3 — parseDietMd 容错解析宏量行（全角/半角冒号、约/~、g/克），缓存签名升级 v2 自动失效重建
- **趋势面板**：新增「🥗 三大营养素（近 7 天）」堆叠柱状图（碳水/脂肪/蛋白质分色），caption 附日均与蛋白质建议区间（最新体重 × 1.2~1.6）
- **AI 周报**：数据段新增「近 7 天三大营养素（日均）」与「近 7 天营养观察」汇总（从 diet 文件提取），输出结构新增「营养素与补剂」段（350-500 字）
- **昨日总结**：饮食线包含三大营养素概要；今日建议优先基于营养观察缺口提对应食物
- **AutoDream**：21 天分析新增日均蛋白质（解析「总蛋白质」行），≥5 天记录且日均 <60g 时给"蛋白质摄入偏低"洞察（食物优先 + 蛋白粉备选遵医嘱）
- **兼容性**：历史 diet 文件无营养行时各处优雅降级（宏量 null、图表空态提示、周报如实说明"无营养记录"）
- **涉及文件**：`js/file-manager.js`、`js/llm-service.js`、`js/stats-manager.js`、`js/app.js`、`js/auto-dream.js`、`index.html`、`test/stats-manager.test.js` 及三目录同步副本

## 2026-10-24 (v3.14.0)

### 新增 — 食物种类记忆

> 新记忆文件 `rules/food-types.md`，AI 在记录饮食时发现新食物自动归类追加，形成用户的分类食物清单（主食/蛋白质/蔬菜/水果/饮品/零食加餐/外卖外食/其他），用于个性化推荐与饮食多样性分析

- **实时更新**：CLAUDE.md v12 → v13 — 判断流程规则 1 追加"出现清单中没有的食物 → write_file 更新 rules/food-types.md 对应分类"；该文件纳入系统提示词**固定注入前缀**（`_fixedFiles`），AI 无需 read_file 即可看到现有清单，只有真正的新食物才触发一次写入，不增加工具轮次消耗
- **用途指令**：推荐食物时优先从清单里选用户熟悉的；发现某分类长期空缺或种类单一时，温和建议饮食多样化
- **结算兜底**：跨天结算数据完整性检查（`_dataIntegrityCheck`）新增第 6 项检查 — 对话中出现的新食物（尤其图片识别结果）vs food-types.md，遗漏时自动补写
- **UI 与备份**：记忆面板新增「食物种类」分组；food-types.md 纳入每日记忆快照（SNAPSHOT_FILES，误删可回滚）；INDEX.md v3 → v4 收录新文件
- **老用户升级**：`_upgradeSystemFiles` 检测到文件不存在时自动写入模板，创建后永不覆盖
- **涉及文件**：`js/file-manager.js`、`js/llm-service.js`、`js/app.js`、`js/backup-manager.js`、`scripts/prompt-eval.mjs` 及三目录同步副本

## 2026-10-13 (v3.13.4)

### 优化 — 设置页连接配置增加填写提示

> 用户配置自定义 API 时易在 BASE URL 误带 `/chat/completions`（路径重复 404）或模型名与服务端不一致（模型不存在 404），现就地加灰色提示

- **模型选择组**：标题追加"(需与 API 服务端模型名一致)"
- **请求地址 (BASE URL)**：输入框下方追加"不要带末尾 /chat/completions，程序会自动拼接"
- **涉及文件**：`index.html` 及 `www/index.html` 同步副本

## 2026-10-11 (v3.13.3)

### 修复 — 工具调用轮次耗尽时丢弃已生成内容 + 文案误导

> 当 AI 连续多轮工具调用达到上限（maxToolRounds，默认 5）未给出最终回复时，原逻辑直接返回"抱歉，处理超时了，请重试。"并丢弃已生成的全部文本，用户长时间等待后只看到一句误导性提示

- **根因**：`llm-service.js` 的 `chat()` / `chatStream()` 在工具调用循环耗尽后返回固定文案，`chatStream` 尤其丢弃了已累积的 `finalContent`，且文案"处理超时"实为轮次上限而非时间超时，具有误导性
- **修复**：兜底返回时保留已生成的部分内容（`finalContent`）并附准确提示后缀；无内容时文案改为"已处理 N 轮工具调用但未完成"；补全 `model`/`usage` 字段与其他返回分支一致
- **诊断**：达到上限时输出 `console.warn` 记录轮次与工具调用链，便于排查 AI 陷入循环的原因
- **涉及文件**：`js/llm-service.js` 及三目录同步副本

## 2026-10-10 (v3.13.2)

### 优化 — 移除聊天底部快捷 chip

> 精简聊天界面，移除输入框上方的快捷记录 chip（💧 喝水 250ml / ⚖️ 记体重 / 🍪 加餐）

- **移除内容**：`index.html` 中的 `quick-chips` 容器及三个 `quick-chip` 按钮、`css/style.css` 中 `.quick-chips`/`.quick-chip` 全部样式、`js/app.js` 中 chip 点击事件绑定（一键填充文案逻辑）
- **涉及文件**：`index.html`、`js/app.js`、`css/style.css`、`package.json`、`CHANGELOG.md` 及三目录同步副本

## 2026-10-09 (v3.13.1)

### 新增 — 模型设置新增「连接配置」分组

> 在应用内「模型设置」UI 可配置大模型连接参数，运行时切换不同大模型服务，无需改代码或重新打包 APK

- **新增配置项**：API 协议格式（openai/anthropic）、请求地址 BASE URL、API Key、请求超时（秒）、失败重试次数、自定义请求头（JSON）、上下文窗口大小（tokens）
- **动态生效**：`SparkLLM._refreshConn()` 在每次请求前从 `QINGBAN_SETTINGS` 读取连接参数（优先）回退到 `QINGBAN_CONFIG`（内置默认），用户在设置 UI 修改后立即生效
- **超时/重试可调**：`_request_openai`/`_request_anthropic` 的 retries/timeoutMs 默认值从 settings 读取（参数未传时），图片场景自动延长至至少 180s
- **自定义请求头**：`_getCustomHeaders()` 解析 JSON 字符串并合并到所有请求（OpenAI/Anthropic/流式），支持代理认证等场景
- **修复**：保存设置时丢失 `onDemandLoad`/`onDemandTokenBudget`/`settlement` 等未在 UI 暴露的字段（`_saveSettings` 现保留旧值）
- **涉及文件**：`js/settings.js`、`js/spark-llm.js`、`js/app.js`、`index.html`、`package.json`、`CHANGELOG.md` 及三目录同步副本

## 2026-10-09 (v3.13.0)

### 新增 — 每日结算步骤可配置

> 用户可自行勾选凌晨跨天结算需要执行哪些步骤，未勾选的步骤自动跳过

- **结算设置面板**：菜单新增「结算设置」入口，10 个步骤独立开关：
  - 对话与数据：昨日对话摘要、数据完整性检查、记忆文件快照、重建记忆索引
  - 习惯与打卡：刷新习惯总结（近 21 天）、昨日打卡记录、周度习惯总结（每 7 天）
  - 周报与提醒：AI 周报（周日）、刷新每日提醒（静默）、Auto Dream 自动触发（静默）
- **配置存储**：`settings.js` 的 `DEFAULT_SETTINGS.settlement` 新增 10 个布尔开关（默认全 true，保持现有行为）；`loadSettings` 深合并 `settlement`/`reminders` 子对象，旧用户存档缺新开关时自动补默认值
- **结算执行**：`handleDayRollover` 在方法开头快照配置（避免结算中途配置变化导致步骤序列错位），每个步骤前判断 `setlOn(key)`，关闭则跳过（不显示在明细弹窗）
- **UI**：`settlementOverlay` 复用 `.settings-group`/`.settings-row`/`.settings-check` 现有样式；对「昨日摘要」加提示（关闭可能导致后续步骤数据不全）
- **涉及文件**：`js/settings.js`、`js/app.js`、`index.html`、`package.json`、`CHANGELOG.md` 及三目录同步副本

## 2026-09-27 (v3.12.0)

### 新增 — 昨日总结三层提前结算（早上打开即见）+ 结算可靠性

> 源自 v3.11.1 真机首验反馈（09-27 早：结算耗时 3 分钟、21 天分析撞 90s 超时、状态条位置漂移）

- **三层提前结算**：
  - **层 1 · 晚间草稿**：22:00 后且当日有对话 → 复用 60s 检测定时器静默预生成当日摘要（`saveDailySummary` 新增 `skipIndex` 选项防 INDEX 重复行；20 分钟节流 + 按消息增量触发；标记存 `.meta/daily-draft.json`）
  - **层 2 · 凌晨后台结算**：生效日 4:00 翻转，退后台时对齐 04:05 的 `setTimeout` 触发（60s 检测兜底）；结算后仍有失败步骤 → 15 分钟自动重跑失败步骤（跳过已完成步骤），**9:00 封顶、整夜至多 2 轮**；全部成功才删除断点文件
  - **层 3 · 早打开兜底**（现有）：断点续跑恢复队列，按已完成状态跳过
- **单一入口闸门**：新模块 `js/settlement-gate.js` 状态机（idle/running/retryScheduled）——后台对齐触发、夜间重试定时器、用户打开恢复、运行中跨天检测四个入口统一过闸；`retryScheduled` 被任何 `claim()` 接管时自动取消挂起的重试定时器，**用户主动打开与后台重试互不冲突，杜绝双跑**
- **21 天分析降频（用户确认）**：跑当且仅当距上次成功刷新 ≥ 2 天 且期间有新对话摘要（状态存 `.meta/habits-refresh.json`，`ProfileLearner.shouldSkipRefresh/markRefreshed`）；跳过时明细显示"无新数据，已跳过"；菜单手动刷新不受限
- **可靠性**：重步骤超时 90s → 150s；习惯总结与 AI 周报失败自动重试 1 次（间隔 10s）；失败原因写入队列步骤（`steps[i].error`）并在明细弹窗灰字/红字展示
- **状态条修复**：移入聊天面板顶部（`.chat-panel` 首子元素，token-bar 之前）——根治 `.app` grid 自动放置导致的位置漂移（真机截图 1 出现在屏幕中部）；样式瘦身（高度 ~28px：padding 4px 12px、字号 11px、圆点 6px）
- **明细文案**：步骤 label 转中性描述（修复"完成后仍显示正在…"）
- **测试**：新增 `test/settlement-gate.test.js`（闸门冲突/窗口边界/轮数上限/真实定时器冒烟）、`test/profile-learner.test.js`（降频策略 6 用例）、chat-manager 草稿决策与 skipIndex 用例，全量 **125 用例通过**
- **涉及文件**：`js/settlement-gate.js`（新）、`js/chat-manager.js`、`js/profile-learner.js`、`js/app.js`、`index.html`、`css/style.css`、`test/*`、`TODO.md`（完成）、`docs/REGRESSION.md` 及三目录同步副本

## 2026-09-26 (v3.11.1)

### 修复 — Android 安装包版本号长期不更新

- **问题**：系统安装确认框 / 设置→应用管理里显示的 `versionName` 自 v3.4.1 起一直是 "3.4.1"（versionCode 3）——发版约定的"四处版本号"漏了 `android/app/build.gradle` 这第五处，且 Capacitor 的 `npx cap sync` 不会自动同步 package.json 版本。应用内顶栏版本（APP_VERSION）一直正常
- **修复**：新增 `scripts/sync-android-version.mjs` — 读 package.json 版本自动改写 build.gradle：`versionName` = semver 原值，`versionCode` = `major*10000 + minor*100 + patch`（单调递增，3.11.1 → 31101），支持 `--check` 校验模式
- **接入**：`npm run sync` / `npm run verify` 追加该脚本（同步与校验双模式）；`build-all.ps1` Step 1 新增 1c 步骤；AGENTS.md 版本约定更新为"五处"（第五处自动同步，无需手动）
- **本次**：versionName "3.4.1" → "3.11.1"，versionCode 3 → 31101；安装界面即刻可见正确版本
- **涉及文件**：`scripts/sync-android-version.mjs`（新）、`package.json`、`build-all.ps1`、`android/app/build.gradle`、`AGENTS.md`

## 2026-09-26 (v3.11.0)

### 优化 — 系统提示词无损压缩（CLAUDE.md v12，前缀 -49%）

- **行为评测集（先建后压）**：新增 `npm run prompt:eval`（`scripts/prompt-eval.mjs`）— 8 个标准输入（记饮食/记体重/说过敏/运动打卡/推荐习惯/要提醒/缺细节/纯闲聊）直连真实 LLM 跑完整工具循环（工具结果内存 mock），**只断言工具调用行为**（工具名集合 + write_file 目标路径，不比对文案）。v11 基线存 `scripts/prompt-eval-baseline.json`；批次 A（打卡/通知/ask_user/健康建议）、批次 B（数据写入规则/身体数据/核心原则）分批压缩、每批复跑，**两轮评测均 8/8 硬性行为通过**
- **CLAUDE.md v11 → v12（6,242 → 3,495 字符，-44%）**，按"每个知识点只有一个权威来源"原则去重：
  - 习惯打卡系统节与 4 个工具定义重复教学 → 压缩为每工具一行触发规则（953 → ~280）
  - send_notification / ask_user 场景示例砍半（工具定义已含参数与枚举）
  - "必须先 write_file"3 处重复强调 → 判断流程清单 + 一次最强表述；"触发关键词"清单删除（与判断流程 item 1 完全重复）
  - 身体数据更新示例对话删除（步骤与公式保留）；健康生活小建议 7 类各压一短句
  - **红线未动**：饮食文件格式模板一字未改（stats-manager 解析契约）、数据写入判断流程、数据原值保留规则
  - **新增「文件地图」节（~230 字符）**：告知模型全部可查位置（diet/chat/habits/weekly/insights/.meta）+ "历史数据一律查文件，不要凭记忆编造" + 不确定路径先 read_file INDEX.md / search_files 按模式搜——把"按需读取"从偶尔想起变成默认直觉；配套评测新增 2 个召回用例（查上周饮食/查打卡报告，数据在注入窗口外，验证模型会主动用工具找）
- **固定前缀纯静态化（7,602 → 4,095 字符，-46%）**：`PROFILE.md` / `BODY_METRICS.md` 移出 `_fixedFiles` 固定前缀改为动态注入 — 它们被 AI 频繁写入，每记一次体重就失效整个前缀 KV 缓存；移出后前缀 = CLAUDE.md + rules/（真静态），缓存存活期大幅延长。单元测试同步更新（PROFILE 写入不再失效缓存，rules/ 仍失效）
- **时间判断块表格化**（llm-service.buildSystemPrompt）：今天/昨天/明天合并单行，信息等价，删重复转述（~500 → ~250）
- **测量**：`scripts/measure-context.mjs` 改为测量真实内嵌模板（原 data/CLAUDE.md 是 3.5K 旧模板，与内嵌 6.2K 不同步导致此前测量偏低）；每次请求静态部分净省约 3,300 字符（≈2K+ tokens）
- **清理**：删除 `data/CLAUDE.md`（运行时不用、纯误导），三目录孤儿同步清理；AGENTS.md 记忆说明更正
- **真机回归**：REGRESSION.md 第 2 节新增 v12 行为核对项
- **涉及文件**：`js/file-manager.js`、`js/llm-service.js`、`test/llm-service.test.js`、`scripts/prompt-eval.mjs`（新）、`scripts/measure-context.mjs`、`TODO.md`（全部完成）、`docs/REGRESSION.md`、`AGENTS.md` 及三目录同步副本

## 2026-09-26 (v3.10.0)

### 新增 — 跨天结算后台化（打开即聊，结算后台跑）

- **前台/后台划分**：跨天（启动检测 + 运行中检测共用 `_startDayRollover`）改为两段式 —
  - **前台（毫秒级，正确性必须）**：昨日历史快照落盘（`.meta/rollover-pending.json`，剥离 `_displayPhotos` base64 大图、保留 `_recognition`）→ 日期切今天 → 清空 live 历史 → 聊天 UI 就绪 + 顶栏状态条 + 简短问候。原则：凡"今天的新聊天不能等"且"纯本地毫秒级"的在前台
  - **后台（顺序队列，不阻塞）**：昨日摘要(LLM，90s 步骤超时) → 数据完整性检查 → 21 天习惯刷新(LLM) → 昨日打卡报告 → 周度习惯总结(条件) → 记忆快照 → AI 周报(周日) → 重建索引 → 每日提醒刷新 → Auto Dream。原则：依赖昨日数据、可慢慢算的都在后台
- **顶栏状态条**：`header` 下方细条「🌙 昨日结算中 · 保存昨日对话摘要（N 步完成）」呼吸灯动画；点击弹出步骤明细弹窗（⏳/✅/⚠️ 实时状态 + 失败补救指引）。全部成功 →「✓ 昨日结算完成」2.5s 淡出；有失败 →「⚠️ 部分失败，点击查看」保留可点。原全屏跨天遮罩不再自动显示（DOM 保留备用）
- **摘要改从快照生成**：`ChatManager.saveDailySummary(llmService, history?, date?)` 参数化 — 后台结算传昨日快照，绝不读 live 状态（用户已在新的一天聊天，防止串日期）
- **问候拆两段**：`showNewDayWelcomeQuick()`（简短问候，前台立发）+ `showNewDayWelcomeFull()`（含昨日总结和今日建议，后台摘要完成后调用）；结算完成时用户已开聊则只发「🌅 昨日结算完成」系统轻提示
- **断点续跑**：结算中被杀 APP → 下次启动检测 pending 快照自动恢复后台队列（live 状态上次已切今天，不重复前台切换）；结算完成后删除 pending 文件
- **KV 缓存收尾**：后台队列完成时统一失效固定前缀缓存（learned-habits 等被后台步骤更新后，后续对话立即使用新档案）
- **测试**：+2 用例（saveDailySummary 快照参数不串日期 / 空快照不写文件），全量 110 用例通过
- **涉及文件**：`js/chat-manager.js`、`js/app.js`、`index.html`、`css/style.css`、`docs/REGRESSION.md` 及三目录同步副本

## 2026-09-26 (v3.9.0)

### 新增 — 图片两阶段发送（提升沟通效率）

- **图片预识别管道**：新 `SparkLLM.recognizeImages()` — 用户发图片/图片+文字时，图片先**单独**发给视觉模型：不带系统提示词（省掉整个 KV 固定前缀的传输），仅一句极简识别指令（`RECOGNIZE_HINT` 约 60 字；max_tokens 4096、temperature 0.2、2 次重试 / 60s 快速失败）
- **识别文字并入主对话**：返回的识别文字以「[图片识别] …」与用户文字合并为**纯文本**消息走主对话 — 主对话不再切换视觉模型、工具循环各轮不再重复视觉编码图片、纯文本消息可命中 30s 响应缓存。识别文字存入历史消息 `_recognition` 字段：`getHistory()` 组装 LLM 上下文时并入，UI 气泡仍只显示用户原文，跨重启保留
- **失败回退**：预识别失败/返回空时自动回退旧行为（图片数组直发、视觉模型接管），零回归风险；MockLLM 无该方法时同样回退
- **状态条**：识别阶段显示「🔍 识别图片中 · Xs」，主请求发出后切「等待响应」
- **修复：每条请求双发最新用户消息** — 旧版 `sendMessage` 先把用户消息写入历史，`chatStream` 又把当前消息追加一次，导致**每次请求最新一条用户消息都发送两遍**（token 浪费 + 上下文重复）。新增 `ChatManager.getHistoryForRequest()` 弹出末尾当前消息，`_streamRender` 改用
- **测试**：+10 用例（recognizeImages 三格式 payload / 空列表不发请求 / 失败抛错；`_recognition` 存取组装 / getHistoryForRequest / saveHistory 往返），全量 108 用例通过
- **涉及文件**：`js/spark-llm.js`、`js/chat-manager.js`、`js/app.js`、`docs/REGRESSION.md` 及三目录同步副本

## 2026-09-21 (v3.8.0)

### 新增 — 三套界面主题（按 ui-proposals.html 三方案落地）

- **主题矩阵扩展 3 → 6**：`dark/light/warm`（原有）+ `fresh 晨雾呼吸`（方案 A：清新渐变底 + 大圆角柔和气泡 + 浮起卡片）/ `glass 暗色玻璃`（方案 B：深空光晕底 + 弹窗毛玻璃 + 半透明气泡）/ `paper 暖纸手账`（方案 C：纸纹底 + 衬线标题 + 纸片实体投影）。菜单「切换主题」循环切换，localStorage 持久化不变
- **纯视觉层实现**：每主题一组完整 CSS 变量（12 色板字段全覆盖）+ 少量主题特化样式（背景/气泡/弹窗容器），不动 DOM 结构与业务逻辑，与底部信息架构重构（三案"共同改动"）解耦，后者待后续单独立项
- **兼容性处理**：`backdrop-filter` 渐进增强（不支持的环境半透明底色仍可读）；`initTheme` 对 localStorage 旧值/异常值防御回退 `dark`；三主题均经 CSS 变量自动继承既有的菜单滚动修复、快捷 chip、提醒设置等 v3.7.x 组件样式
- **涉及文件**：`css/style.css`（3 变量块 + 主题特化区）、`js/app.js`（THEMES/THEME_LABELS/initTheme 防御）、`package.json` 及三目录同步副本
- **真机验收**：REGRESSION.md 第 6 节主题条目更新为六主题，重点验证 glass 毛玻璃与 paper 衬线字在低端 WebView 的性能与渲染

## 2026-09-19 (v3.7.0)

### 新增 — 主动陪伴与记录提效（ROADMAP 阶段四）

- **通知系统升级（4.1）**：`js/notification-manager.js` 双轨适配 — Capacitor 原生环境接入 `@capacitor/local-notifications`（系统级 AlarmManager 调度，App 被杀后提醒仍可达），Web 环境自动降级 Web Notification + 应用内横幅（本地开发行为不回退）。补齐每日定点（`schedule.on` + `allowWhileIdle`）与一次性（`schedule.at`）两种调度原语；启动时 reconcile 对账（过期未标记静默补 fired / 系统侧丢失重新注册 / 孤儿清理且每日定点固定 id 保留）；通知点击路由（`localNotificationActionPerformed` → 打卡/趋势面板）；权限请求移至提醒设置保存时触发
- **主动陪伴场景（4.2）**：晨间问候（默认 8:00，昨日体重变化 + 打卡回顾模板文案）、打卡提醒系统级定点两次（默认 12:30 / 20:00，通用文案 + 点击进打卡面板看真实进度；原前台轮询仅在 App 可见时补充具体习惯名横幅）、晚间复盘提醒（默认 21:30）。全部文案为模板 + 结构化数据离线生成（零 LLM 调用）。菜单新增「提醒设置」（`remindersOverlay` 弹窗），三个提醒的开关与时间可配置，存 settings.reminders
- **Auto Dream 自动触发（4.3）**：`shouldTrigger()`（预留未接通）接入跨天流程末尾静默执行 — 本周无周报且数据足够时后台生成周报/月报/模式分析，`.meta/autodream.json` 记录当日防重，完成后横幅提示
- **record_metrics 双写（4.4）**：新 LLM 工具 `record_metrics`（meals/total/weight），AI 写 `diet/日期.md` 后调用提交结构化数据到 `.meta/metrics-manual.json`（事实数据，不随缓存重建丢失）；`stats-manager.js` 读数优先级 = 双写结构化 > MD 容错解析（解析保留兜底历史），体重在 BODY_METRICS 缺失日期用双写补齐；缓存签名纳入 manual 文件。`data/CLAUDE.md` 更新使用指引
- **快捷记录通道（4.5）**：拍照菜单新增「📸 拍餐照 · 一键记录」— 拍完自动附记录意图直接发送；聊天页输入栏上方新增快捷 chip（喝水 250ml / 记体重 / 加餐）一键填充
- **插件**：新增依赖 `@capacitor/local-notifications@^8`，`capacitor.plugins.json` 注册 LocalNotificationsPlugin

### 修复 — 内测验收发现的两个回归

- **跨天总结清单被超时砍断**：SparkLLM 重试循环（最多 30 次 × 单请求 120s）叠加跨天流程单步无超时兜底，LLM 服务变慢/持续失败时击穿 init 全局 5 分钟超时，跨天清单定格在已显示的几项，后续步骤（21 天习惯刷新 / 打卡报告 / 快照 / AI 周报 / 重建索引 / 每日提醒）全部未执行（v3.4.8 同款 bug 复发，单步变慢再次击穿总预算）。修复：新增 `_stepTimeout()` 步骤级超时 — 四个 LLM 步骤（昨日摘要 / 21 天习惯刷新 / 周度习惯总结 / AI 周报）各配 90s 兜底，超时标红不阻断后续；init 总超时 5min → 8min；`autoDream.run` 后台执行加 10min 兜底；`_hideDayTransition` 不再把未完成步骤伪装成成功；REGRESSION.md 新增「断网状态下跨天」异常路径验收项
- **功能菜单溢出**：新增「提醒设置」后菜单 13 → 14 项，`.menu-dropdown` 无高度约束无滚动，手机上底部入口（含「刷新习惯总结」）溢出屏幕不可见。修复：`.menu-dropdown` 加 `max-height: calc(100vh - 60px)` + `overflow-y: auto`

- **测试**：新增 `test/notification-reminders.test.js` 17 用例（模板文案/静默时段/时间解析/Web 轨道调度与每日补发/原生轨道系统注册与 reconcile 对账），`test/stats-manager.test.js` 追加双写用例（mergeCaloriesDay/recordMetrics/统计合并），全量 98 用例通过
- **涉及文件**：`js/notification-manager.js`（重写）、`js/stats-manager.js`、`js/llm-service.js`、`js/settings.js`、`js/app.js`、`index.html`、`css/style.css`、`data/CLAUDE.md`、`test/*`、`package.json` 及三目录同步副本

## 2026-09-19 (v3.6.1)

### 优化 — 顶栏布局与打卡日期导航修复

- **顶栏瘦身**：「Auto Dream」与日期徽章移入左侧功能菜单 — 菜单新增「日历」条目（日历图标 + 当前日期，点击打开日历）与「Auto Dream — 周报/月报」条目，顶栏仅保留 记忆/趋势/打卡 三个高频入口，手机宽度下不再拥挤
- **修复打卡日期导航左右箭头不显示**：原实现通过 `transform:rotate(90deg)` 复用向下箭头图标，SVG rotate 默认围绕原点 (0,0) 旋转，图形被转出 viewBox 可视区域；新增 `icon-chevron-left`/`icon-chevron-right` 图标定义并直接引用，左右箭头正常渲染
- **样式适配**：`.date-badge`/`.date-badge-clickable` 选择器从 `.topbar` 前缀改为全局类，日期徽章在功能菜单内正常展示
- **涉及文件**：`js/app.js`、`index.html`、`css/style.css`、`package.json` 及三目录同步副本

## 2026-09-18 (v3.6.0)

### 新增 — 趋势可视化与 AI 周报（ROADMAP 阶段三）

- **数据解析层**：新模块 `js/stats-manager.js`。容错解析 `diet/*.md`（分餐段"估算热量"、汇总段"总估算热量"）与 `BODY_METRICS.md`（体重趋势表 MM-DD 行，按今天推算年份、1 月日期归上一年、同日多条取最后）。解析结果缓存到 `.meta/daily-stats.json` 侧车文件，以源文件 `updatedAt` 集合为签名，未变化直接命中缓存；历史数据零迁移，升级后即可出图
- **趋势面板**：顶栏新增「趋势」按钮。体重折线图（近 30 天，首末值标注）、热量柱状图（近 7 天，无记录日占位、日均汇总）、打卡热力图（近 28 天 7 列网格，颜色深浅 = 当日打卡条数，悬停显示明细）。全部为原生 SVG 字符串生成（`buildWeightSvg`/`buildCaloriesSvg`/`buildHabitHeatmap` 纯函数），零第三方依赖、离线可用，配色走 CSS 变量跟随深/浅/暖三主题
- **AI 周报**：跨天流程新增条件步骤 4.6 — 昨日为周日时自动生成上周周报（近 7 天热量/体重/习惯打卡数据驱动 + 300-450 字解读与建议），写入 `weekly/<周日日期>.md`；趋势面板「生成本周周报」可手动触发（生成后重建索引 + 刷新文件树）
- **KV Cache 保护**：图表数据仅从 IndexedDB 读取展示，不注入系统提示词，前缀缓存命中率不受影响
- **测试**：新增 `test/stats-manager.test.js` 15 个用例（体重表解析/年份推算/饮食解析降级/缓存签名与 force 重建/三个 SVG 生成器/日期平移），全量 70 用例通过
- **涉及文件**：`js/stats-manager.js`（新）、`js/app.js`、`index.html`、`css/style.css`、`package.json` 及三目录同步副本

## 2026-09-18 (v3.5.0)

### 新增 — 数据备份与迁移（ROADMAP 阶段二）

- **全量导出**：新模块 `js/backup-manager.js`，把 IndexedDB 单一文件存储（记忆文件、`diet/`、`chat/`、`habits/`、`.meta/*.json`、设置）dump 为单个 `qingban-backup-日期-时间.qb.json`（含 format/version/appVersion/exportedAt 元信息与版本兼容校验）。APK 内经 `@capacitor/filesystem` 写入系统 Documents 目录，失败或 Web 模式自动降级浏览器 blob 下载
- **完整还原（导入）**：`<input type="file">` 选择备份 → 结构校验（format/版本号/ files 结构，版本高于当前 App 时拒绝并提示升级）→ confirm 确认 → `clearAll` 后全量写入 → 失效 KV 前缀缓存 + 重建 INDEX.md + 整页刷新（replace 导入后内存对话历史与磁盘不一致，必须重载）
- **记忆文件自动快照**：跨天流程新增步骤 4.5，将 `PROFILE.md`、`BODY_METRICS.md`、`rules/learned-habits.md`、`rules/allergies.md`、`rules/preferences.md`、`rules/exercise.md` 快照到 `.meta/backups/<日期_时分>/`，滚动保留最近 7 份（超出自动删除）
- **快照手动管理**：菜单「数据备份」新面板：立即快照 / 快照列表（时间倒序 + 文件数）/ 一键回滚指定快照（stamp 格式校验防路径注入，回滚后失效前缀缓存并刷新文件树）。CLAUDE.md / INDEX.md 为系统文件不入快照
- **插件**：新增依赖 `@capacitor/filesystem@^8.1.3`，`npx cap sync android` 已注册（capacitor.plugins.json 含 FilesystemPlugin）
- **测试**：新增 `test/backup-manager.test.js` 9 个用例（导出结构/校验拒绝/replace 与 merge 导入/快照与滚动清理/回滚与 stamp 拒绝），全量 55 用例通过
- **涉及文件**：`js/backup-manager.js`（新）、`js/app.js`、`index.html`、`css/style.css`、`package.json`、`test/*` 及三目录同步副本

## 2026-09-18 (v3.4.8)

### 新增 — 工程地基（ROADMAP 阶段一）

- **三目录同步自动化**：新增 `scripts/sync-web.mjs`，管理范围 js/、css/、data/、index.html、manifest.json，源目录 → www/ → android assets。`npm run sync` 复制差异并清理孤儿文件，`npm run verify` 仅校验（MD5 比对，不一致退出码 1）；`build-all.ps1` Step 1 接入同一脚本，消除两套同步逻辑漂移
- **测试基建**：新增 `npm test`（Node 22 原生 node:test，零新依赖），46 个用例 = 历史 Bug 回归集：max_tokens 传参（v3.4.2/v3.4.7）、含图片 Anthropic maxTokens 上限、凌晨 0-4 点熬夜不跨天、cleanMessages 剥离非标字段、KV 前缀缓存失效（write_file/append_file 命中固定文件）、响应缓存 LRU/TTL、流式工具参数跨 chunk 累加、流式中断返回部分内容（stop_reason=error）、chat() 工具循环与缓存行为
- **真机回归清单**：新增 `docs/REGRESSION.md`，发版前手动验收逐项过（启动/对话/打卡/跨天/弱网/备份/趋势）

### 优化

- **server.js 可测试化**：`cleanMessages` 改为导出；API Key 校验与端口监听用主模块判断（`import.meta.url === pathToFileURL(argv[1])`）包裹，作为模块导入时不退出、不监听，`node server.js` 直接运行行为不变
- **熬夜跨天逻辑提取**：app.js 启动流程中内联的"凌晨 0-4 点算前一天"日期计算提取为 `ChatManager.getEffectiveToday(now)`，行为不变、可单测（含月初/跨年边界用例）
- **AGENTS.md 更新**：移除"无测试"描述，补充 npm test / npm run sync / npm run verify 用法

### 清理

- 删除无引用的孤儿实验文件 `www/js/data-store.js`（android assets 副本同步清理）；根目录构建中间物 `cmd_test.txt`、`test_ps.txt`、`轻伴-debug_3.4.1.apk`、`轻伴-debug - 副本.apk`；`www/index.html` 独有的启动诊断脚本回迁根目录 index.html（恢复"根目录为源"约定）
- **涉及文件**：`scripts/sync-web.mjs`（新）、`test/*`（新）、`docs/REGRESSION.md`（新）、`server.js`、`js/app.js`、`js/chat-manager.js`、`package.json`、`build-all.ps1` 及三目录同步副本

## 2026-08-31 (v3.4.7)

### 修复
- **OpenAI 格式 maxOutputTokens 配置不生效**：非流式（`spark-llm.js:372`）与流式（`:465/:466`，含代理/直连）payload 原本不传 `max_tokens`，配置无效、用服务端默认。现统一加 `max_tokens: baseMax`（`baseMax = settings.maxOutputTokens || … || 8192`），代理端点 `server.js` 透传给上游

### 优化
- **Anthropic 格式 maxTokens 简化**：`spark-llm.js:344/:612` 原 `hasImages ? Math.min(baseMax, 32768) : baseMax`，因 settings 上限已 32768，`Math.min(baseMax, 32768) === baseMax`，冗余且耦合写死数字。简化为 `const maxTokens = baseMax`，配置直接生效、无写死
- **涉及文件**：`js/spark-llm.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.6)

### 修复
- **跨天流程被砍断（21天习惯总结丢失/只剩三步）**：启动跨天时 `handleDayRollover` 被 `_withTimeout(..., 30000)` 包裹，但流程含多步大模型调用（`saveDailySummary` + `refreshHabits(21)` + 周度总结），单步 20-40s，30s 整体超时会在步骤 3（21天习惯总结）中途砍断，导致步骤 3 未完成、步骤 4/5/6（打卡报告/重建索引/清空历史）未执行，遮罩只显示 3 个步骤。就绪标记已提前（v3.4.3），跨天不再阻塞启动，故将超时放宽到 5 分钟（300s），让 6 步全部跑完
- **涉及文件**：`js/app.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.5)

### 修复
- **typing 用时不显示 + 跳动周期异常**：`.typing-wait` 是 `<span>`，被 `.typing span` 规则匹配，误设为 7×7px 圆点 + bounce 动画——文字塞不进 7px 宽度（看不到用时），且该点无 animation-delay、与第 1 点同步跳（周期奇怪）。将跳动点选择器改为 `.typing span:not(.typing-wait)`，排除文字 span
- **涉及文件**：`css/style.css` 及 `www/`、`android/app/src/main/assets/public/` 同步副本

## 2026-08-31 (v3.4.4)

### 优化
- **请求等待秒数样式统一**：将"已等待 Xs"从独立浮动黑条（`#reqStatusBar`，固定底部、黑色圆角）移至 typing 指示器气泡内——三个跳动点后跟一段小字"🖼️ 等待响应 · 3s"，与聊天气泡风格一致。`_showReqStatus()` 改为更新 `#typingIndicator` 内的 `.typing-wait`，`_hideReqStatus()` 空操作（typing 由 `hideTyping()` 统一移除）
- **涉及文件**：`js/app.js`、`css/style.css` 及 `www/`、`android/app/src/main/assets/public/` 同步副本

## 2026-08-31 (v3.4.3)

### 修复
- **跨天"启动超时"误报**：跨天（每日更新）生成昨日总结需调大模型，耗时超过 `www/index.html` 的 20s 启动看门狗时，`__qbAppReady` 尚未置位导致弹出"启动超时"横幅，但实际启动成功（总结完成后横幅被移除）。现将就绪标记（`_markAppReady()`）提前到跨天重活之前——跨天总结不再阻塞"启动就绪"判定，看门狗不再误报
- **涉及文件**：`js/app.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-31 (v3.4.2)

### 修复
- **图片+工具调用停止**：Anthropic 格式下含图片时 `max_tokens` 被硬性压到 4096，K3 thinking 模式消耗完后工具调用参数未输出完即触发 `stop_reason: max_tokens` 截断，服务层检测到后跳过工具执行。现将含图片时的上限放宽到 32K（`Math.min(baseMax, 32768)`）

### 新增
- **max_tokens 截断诊断日志**：`spark-llm.js` 的 `_streamOpenAI`/`_streamAnthropic` 返回前在 `stop_reason==max_tokens` 时打印 model/hasImages/maxTokens/contentLen/各工具 argsLen/usage；`llm-service.js` 跳过工具执行时打印 hasImages/thinkingLen/contentLen/各工具 argsLen+argsHead/usage/model，协助判断是 thinking 占满还是参数过长
- **涉及文件**：`js/spark-llm.js`、`js/llm-service.js` 及 `www/js/`、`android/app/src/main/assets/public/js/` 同步副本

## 2026-08-20 (v3.4.0)

### 优化
- **真摘要生成**：`saveDailySummary` 改为调用 LLM 生成 300-500 字真摘要，强制保留饮食/体重/打卡等关键事实数据原值；LLM 失败时降级为全文拼接，保证摘要始终可用
- **数据完整性智能过滤**：`_dataIntegrityCheck` 改为智能过滤策略，保留所有 user 消息与图片识别的 AI 回复，跳过纯文字聊天的 AI 回复，减少误报
- **涉及文件**：`js/chat-manager.js`、`js/app.js`、`js/spark-llm.js`、`js/mock-llm.js` 及 `www/js/` 同步副本

## 2026-08-12 (v3.3.0)

### 新增 — KV Cache 三层缓存优化
- **第一层：System Prompt 结构重排**：固定内容（CLAUDE.md、用户档案、身体指标、偏好、习惯等）移到提示词最前面，动态内容（当前时间、近 7 天饮食记录、打卡状态）移到后面。让 Kimi 服务端 KV Cache 的前缀部分保持稳定，提升缓存命中率
- **第二层：固定前缀内存缓存**：`LLMService` 新增 `_cachedPrefix` 机制，固定文件内容读取后缓存在内存中，后续请求直接复用，跳过 7 次 IndexedDB 读取和字符串拼接。当 `write_file` 或 `append_file` 修改固定文件时自动失效缓存
- **第三层：客户端响应缓存（LRU + TTL）**：`chat()` 方法新增响应级缓存，对 30 秒内相同的（对话历史 + 用户消息）请求直接返回缓存结果，跳过 API 调用。仅缓存无工具调用的纯文本回复，带图片/工具调用的请求不缓存
- **缓存失效机制**：`executeTool` 中的 `write_file` 和 `append_file` 自动检测是否修改固定文件，触发前缀缓存失效

### 修改
- **llm-service.js**：新增 `_buildFixedPrefix()`、`_getFixedPrefix()`、`_invalidatePrefixCache()`、`_computeResponseCacheKey()`、`_getResponseFromCache()`、`_setResponseCache()` 6 个缓存方法；重构 `buildSystemPrompt()` 使用缓存前缀 + 动态后缀结构；`chat()` 方法增加响应缓存查询和写入逻辑；`chatStream()` 方法初始化 `_pendingCacheKey` 避免缓存污染
- **同步目录**：`js/`、`www/js/`、`android/app/src/main/assets/public/js/` 三个目录均已同步

## 2026-08-12 (v3.2.0)

### 修改
- **默认非流式输出**：`sendMessage` 和 `_retryLastMessage` 均改用 `llmService.chat()`（非流式），等待完整响应后一次性显示，配合 30 次重试机制在弱网环境下更稳定
- **app.js**：移除流式回调相关代码（streamDiv、thinkingText 等），简化为 typing 指示器 → 完整回复的流程

## 2026-08-11 (v3.1.0)

### 新增
- **流式请求超时保护**：流式 fetch 添加 30 秒连接超时（AbortController）和 90 秒读取超时，防止请求无限挂起
- **流式请求自动重试**：流式 fetch 添加 3 次网络错误重试（指数退避），与非流式请求重试机制对齐
- **流式中断容错**：流式读取中断时（后台切换、网络波动），返回已接收的部分内容而非直接报错
- **LLM 服务层容错**：`chatStream` 方法添加 try-catch，检测 `stop_reason: 'error'` 时跳过工具调用直接返回
- **重试按钮**：网络中断或出错时，消息下方显示「🔄 重试」按钮，点击自动重新发送上一次消息
- **后台中断检测**：APP 从后台恢复时检测请求是否被中断，记录后台时长用于诊断

### 修改
- **spark-llm.js**：`_streamOpenAI` 和 `_streamAnthropic` 方法重构，使用 `_fetchStreamWithRetry` 和 `_readWithTimeout` 辅助方法
- **llm-service.js**：`chatStream` 方法添加 LLM 调用 try-catch 和 `stop_reason: 'error'` 检测
- **app.js**：`sendMessage` 保存消息上下文，添加 `_retryLastMessage` 和 `_appendRetryButton` 方法，后台事件监听增强
- **style.css**：新增 `.stream-retry-btn` 重试按钮样式

## 2026-08-07 (v3.0.0)

### 新增
- **习惯打卡系统**：独立面板 + 聊天联动双入口，支持 AI 推荐习惯和用户自定义习惯
- **HabitManager 模块**：新增 `habit-manager.js`，基于 IndexedDB 存储习惯列表（`.meta/habits.json`）和打卡记录（`.meta/habit-checkins.json`）
- **数量打卡**：支持带数量的打卡（如喝水 0.5L、跑步 30 分钟），同一天可多次打卡累加
- **目标与进度追踪**：每个习惯可设每日目标，面板实时显示完成进度百分比和连续打卡天数
- **习惯打卡面板**：顶栏新增打卡按钮，弹出全屏面板展示今日习惯卡片、进度条、快速打卡、添加/删除习惯
- **4 个 LLM 工具**：`checkin_habit`（对话中打卡）、`get_habit_status`（查询状态）、`suggest_habit`（推荐习惯）、`add_habit`（添加习惯）
- **系统提示词注入**：每次对话自动注入今日打卡状态，让 AI 了解用户各习惯的完成进度
- **跨天习惯日报**：跨天时自动生成昨日习惯完成情况总结
- **刷新习惯总结**：菜单新增「刷新习惯总结」按钮，手动触发习惯档案分析
- **CLAUDE.md v11**：新增习惯打卡系统使用指南，说明 4 个工具的触发场景和使用原则
- **INDEX.md v3**：新增习惯打卡数据文件路径索引

### 修改
- **app.js**：集成 HabitManager，注册 4 个 LLM 工具回调，绑定面板事件，跨天处理集成习惯日报
- **llm-service.js**：新增 4 个工具定义、executeTool 分发逻辑、buildSystemPrompt 注入今日打卡状态
- **index.html**：新增打卡面板 HTML、添加习惯表单、顶栏打卡按钮、SVG 图标
- **style.css**：新增打卡面板、习惯卡片、进度条、添加习惯表单样式

## 2026-07-08

### 修复
- **UTC 时区 bug**：`_getToday()` 从 `toISOString()`（UTC）改为本地时间 `getFullYear/getMonth/getDate`，修复凌晨 0-8 点日期差一天的问题
- **跨天检测条件**：重启检测移除 `history.length > 0` 要求，即使昨天没聊天日期变了也会推进
- **后台定时器增强**：从单一 `setInterval` 扩展为 4 层检测（60秒定时器 + 5分钟兜底 + visibilitychange + Capacitor appStateChange）

### 新增
- **熬夜不跨天**：凌晨 0-4 点不触发跨天总结，熬夜聊天仍算前一天；4 点后自动跨天。熬夜时段显示提示「🌙 还在熬夜呀？凌晨 4 点前仍然算前一天」

## 2026-07-07

### 新增
- **后台定时跨天检测**：APP 运行中每 60 秒检查日期变化，无需重启即可自动跨天总结
- **完整 Markdown 渲染**：`formatMarkdown()` 支持标题/列表/表格/代码块/引用/分割线/链接，替换原来只支持粗体和行内代码的简陋实现
- **记忆面板 Markdown**：记忆面板内容从 `<pre>` 纯文本改为 Markdown 格式化渲染

### 修复
- **rules 文件保护**：`allergies.md`、`preferences.md`、`exercise.md` 从"版本号覆盖"改为"只创建不覆盖"，防止 AI 写入的用户数据被升级覆盖

## 2026-07-06

### 新增
- **首次使用引导**：检测 `.meta/onboarded` 标记，首次打开弹出引导表单收集基本信息（昵称/性别/年龄/身高/体重/目标/过敏/偏好/运动），自动计算 BMI 和基础代谢
- **拍照菜单**：点击相机按钮弹出「拍照 / 从相册选择」菜单，拍照模式调用后置摄像头（`capture="environment"`）
- **记忆面板**：顶栏新增文件夹图标「记忆」按钮，全屏弹窗按标签页分类展示所有记忆文件，日期类用时间线卡片展示
- **对话历史持久化**：聊天记录存入 IndexedDB（`.meta/chat-history.json`），重启 APP 恢复当天对话
- **时间信息注入**：系统提示词注入当前日期、星期、8 个时段判断（深夜/早晨/上午/中午/午休/下午/晚上/夜间）及对话策略
- **健康生活建议**：CLAUDE.md 新增 7 类健康提醒规则（饮水/进食节奏/运动/睡眠/进食顺序/情绪/季节）
- **时间判断增强**：注入今天/昨天/明天的完整日期和星期，明确标注工作日/周末，防止 AI 推算错误
- **重启自动跨天**：`init()` 检测 `savedDate < today` 自动触发跨天总结
- **体重更新规则**：CLAUDE.md 新增 5 步体重记录流程，明确要求 AI 调用 `write_file` 更新 BODY_METRICS.md
- **CLAUDE.md 版本号自动升级**：系统文件头部添加 `version: N`，启动时检测版本号自动覆盖升级，无需卸载重装

### 修改
- **日期自动获取**：移除硬编码 `'2026-07-05'`，使用 `_getToday()` 获取真实日期
- **空白默认模板**：`rules/allergies.md`、`preferences.md`、`exercise.md`、`PROFILE.md`、`BODY_METRICS.md` 全部改为空白模板，等 AI 在对话中逐步填充
- **去掉同日压缩**：移除 `sendMessage()` 中的 `needsCompact` 检查，同一天内完整保留上下文
- **learned-habits.md 保护**：从"版本号覆盖"改为"只创建不覆盖"

### 移除
- **示例照片按钮**：删除底部「模拟早餐/午餐/晚餐」三个彩色按钮

## 2026-07-05

### 新增
- **讯飞 Coding Plan 集成**：创建 `server.js` 后端代理 + `spark-llm.js` 适配器，`USE_REAL_LLM` 开关切换真实模型/MockLLM
- **重置数据引导**：`showResetModal()` 弹出表单收集用户信息，`performReset()` 写入个性化 PROFILE.md 和 BODY_METRICS.md
- **自动学习机制**：创建 `profile-learner.js`，跨天时 ProfileLearner 从对话中提取 7 维度习惯（饮食/用餐场所/作息/运动/工作环境/情绪/其他），合并到 `rules/learned-habits.md`
- **习惯打卡**：跨天时 LLM 根据学习到的习惯生成个性化跟进问题
- **多照片上传**：`pendingPhoto` 改为 `pendingPhotos` 数组，支持多选、预览、单独删除
- **主题切换**：三套主题（深色科技/浅色清新/暖调米黄），CSS 变量驱动，localStorage 持久化
- **Auto Dream 图标**：新增 `#icon-dream` SVG 符号（星星图案）
- **APK 打包**：Android SDK + JDK 21 + Capacitor 环境，`spark-llm.js` 双模式（APK 直连讯飞 + 开发代理），`app-config.js` 打包 API Key，CapacitorHttp 绕过 CORS，`buildDir` 重定向解决沙箱权限

### 修改
- **调试按钮隐藏**：`rebuildIndexBtn`、`resetBtn`、`nextDayBtn` 添加 `display:none`

### 初始项目结构
- 纯前端 SPA，模拟 Claude Code 四种记忆机制
- 本地 MD 文件（IndexedDB）+ Function Calling + 上下文压缩 + Auto Dream
- MockLLM 模拟通义千问 Plus（规则引擎，无真实 LLM 调用）
- 三栏布局：文件树 / 聊天 / 上下文信息+工具日志
