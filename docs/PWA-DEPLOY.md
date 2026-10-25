# 轻伴 iOS 分享版（PWA）部署上线手册

> 适用版本：v3.19.0+。目标场景：把轻伴分享给少量朋友在 iPhone 上用——不花 $99 开发者账号、不签名出包，Safari「添加到主屏幕」即当 App 用。蓝牙体脂秤仅 APK 支持，网页版入口已自动隐藏。
>
> 本手册覆盖：整体链路 → 材料清单 → 代码发布与 tag → 部署 → 上线自检 → 朋友话术 → 接口矩阵 → 差异说明 → 常见问题 → 日常维护。

## 0. 整体链路（一图看懂）

```
【代码侧 · 一次】
改代码 → npm run sync（三目录同步）→ npm test（177 项）→ git commit
       → git tag v3.19.0 → git push（含 tag）
                        ↓ GitHub Actions 自动（打 v* tag 时）
                  测试 + 编译 APK + 建 Release（APK 永久直链）

【部署侧 · 上线/发版】
EdgeOne Pages 上传 www/ 目录（拖拽或关联仓库自动）→ 部署后**先做裸链测试**（无痕窗口直接打开，默认域名可能是限时预览链接）→ 测试通过或绑定自定义域名后发给朋友
       → 把链接发给朋友

【朋友侧 · 首次】
iPhone Safari 打开链接 → 添加到主屏幕 → 打开轻伴
       → ☰ 菜单 → 模型设置 → 点「Kimi K3 全量配置」→ 填自己的 API Key → 开始用
```

## 一、上线材料清单（备齐这些就够了）

| # | 材料 | 说明 | 去哪拿 |
|---|---|---|---|
| 1 | 腾讯云/EdgeOne 账号 | 用于 EdgeOne Pages 免费托管（腾讯云产品，近期更名 EdgeOne Makers）。**注册详细步骤见 [EDGEONE-REGISTER.md](EDGEONE-REGISTER.md)** | https://edgeone.ai/login （邮箱/Google 注册，免绑卡） |
| 2 | 待部署内容：`www/` 目录 | `npm run sync` 后即为完整静态站点（index.html/manifest/sw.js/icons/js/css/data）。**不需要** server.js、node_modules、.env —— PWA 版无后端，LLM 由浏览器直连 | 仓库本地跑 `npm run sync` 生成 |
| 3 | 朋友的 LLM Key | 每人自己注册自己填（合规且免费额度各算各的）。推荐 Kimi 开放平台（唯一同时满足「浏览器可直连 + 有视觉模型支持拍照识别」） | https://platform.kimi.com ；备选 DeepSeek https://platform.deepseek.com |
| 4 | 发给朋友的使用说明 | 本手册第五节，直接复制转发 | — |
| 5 | （推荐）自有域名，约 ¥10/年 | EdgeOne 默认域名（.cool/.dev）是**带 token 的限时预览链接**，不能长期分享；绑一个便宜域名（.top/.xyz）+ 加速区选"全球（不含中国大陆）"可免备案、自动 HTTPS。走大陆节点加速才需 ICP 备案 | 腾讯云/阿里云域名注册 |

**不需要**：Apple 开发者账号、Mac、Xcode、签名证书、任何后端服务器。

## 二、代码侧：发布提交与 tag

每次发版（含本次 v3.19.0）固定动线：

```bash
npm run sync     # 三目录同步（js→www→android assets）+ build.gradle 版本号自动联动
npm run verify   # MD5 校验
node --test      # 177 项测试（Git Bash 下用无参数形式；test/ 参数形式在 bash 里会报错）
git status       # ★ 核对新文件全部入库（见下方盲区说明）
git add <本次改动的文件>
git commit -m "feat: vX.Y.Z 一句话说明 — 关键点列表"
git tag vX.Y.Z   # 轻量 tag 即可，CI 监听 v* 触发
git push origin master --tags   # github.com 连不上时可用 scripts/push-via-api.mjs 备用通道
```

**版本号五处联动**（改代码时）：`js/app.js` 的 `APP_VERSION` + `CHANGELOG` 数组、`package.json`、`CHANGELOG.md`、`android/app/build.gradle`（由 sync 脚本自动）。`sw.js` 顶部的 `CACHE_VERSION` 顺手同号（忘改不影响正确性，只是旧缓存清理延迟）。

**★ CI 门禁盲区（重要）**：CI 用 `git diff --exit-code -- www/` 把关同步，但 **git diff 看不见未跟踪的新文件**——像 v3.19.0 新增的 `icons/`、`sw.js`、`www/icons/`、`www/sw.js` 如果漏提交，CI 照样绿灯，APK/PWA 却缺资源。提交前务必确认 `git status` 里没有遗漏的 `??` 新文件。

**打 tag 后 CI 自动做**：单测 → 编译 Debug APK → 建 GitHub Release 挂 APK（公开仓库 Release 即永久直链，安卓侧手机可直接下载安装）。

## 三、部署：EdgeOne Pages（免费、国内快、默认域名免备案）

> ⚠️ **默认域名都是限时预览链接（2026-10-25 实测）**：EdgeOne Makers 分配的默认域名（国内站 `*.edgeone.cool`、以及 `*.edgeone.dev`）都是**带 `eo_token` 的限时链接**——裸链接对任何访客（含海外网络）返回 401，token 过期后彻底失效。官方错误码 FAQ 明确建议：长期访问请绑定**自定义域名**（约 ¥10/年，加速区选不含大陆可免备案、自动签发 HTTPS）。详见 [EDGEONE-REGISTER.md](EDGEONE-REGISTER.md)。

### 方式 A：Pages Drop 拖拽（最快，适合手动发版）

1. 打开 https://pages.edgeone.ai/drop
2. 把 `www/` 目录拖进去 → 几秒部署完成，页面显示访问链接
3. **裸链测试（必做）**：开一个无痕/隐私浏览窗口，直接打开链接（不带任何 `?eo_token=...` 参数）→ 能显示轻伴界面才算可分享；显示 401 即限时预览链接，需按上方案绑定自定义域名
3. 注意：未注册时链接仅 1 小时有效——**先注册登录 EdgeOne 账号再拖**（EdgeOne 是腾讯云产品，注册步骤见 [EDGEONE-REGISTER.md](EDGEONE-REGISTER.md)）
4. 发版 = 重新拖一次新版 `www/`

### 方式 B：关联 GitHub 仓库（push 自动部署）

1. EdgeOne Pages 控制台 → 创建项目 → 导入 GitHub 仓库
2. 构建命令**留空**，输出目录填 `www`
3. 之后每次 push 自动重新部署，tag 发版时网页版与 APK 同步更新

### 备选托管

GitHub Pages / Cloudflare Pages 也免费，但国内直连不稳（朋友打开慢或失败），只作备用镜像，不作主链接。

## 四、上线后自检清单（拿自己手机过一遍）

- [ ] 手机 Safari 打开链接：界面完整、无红色报错横幅（顶栏菜单显示 v3.19.0+）
- [ ] Safari 分享 →「添加到主屏幕」：图标、名称「轻伴」、独立窗口全屏正确
- [ ] ☰ 菜单 →「模型设置」→ 点「Kimi K3 全量配置」：BASE URL 自动填 `https://api.moonshot.cn`、协议为 openai
- [ ] 填入自己的 Kimi Key → 保存 → 发一条消息能收到回复
- [ ] 拍一张食物照片能识别（视觉链路）
- [ ] 断网/飞行模式后再打开主屏幕图标：界面仍能加载（Service Worker 离线兜底）
- [ ] 微信里打开链接：出现「在 Safari 中打开」引导条
- [ ] 菜单里没有「蓝牙体脂秤」项、输入框上方没有「蓝牙称重」按钮（网页版预期行为）

## 五、发给朋友的话术（直接复制转发）

```
📱 轻伴 · iPhone 安装使用（3 步）

1. 用 iPhone 自带的 Safari 浏览器打开这个链接：
   <你的最终分享链接>
   （微信里点开的：点右上角「···」→「在 Safari 中打开」）

2. 点 Safari 底部中间的「分享」按钮 ⬆️ →「添加到主屏幕」
   桌面上会出现轻伴图标，以后从桌面打开，像 App 一样全屏使用

3. 首次使用配置 AI：
   打开轻伴 → 右上角 ☰ 菜单 →「模型设置」
   → 点最上面的「Kimi K3 全量配置」按钮
   → 在「连接配置 → API Key」里填你自己的 Kimi Key
     （到 https://platform.kimi.com 注册获取，新用户有免费额度）
   → 点保存，就可以开始聊天了

小提示：
· 数据都存在你自己手机上，换设备前用菜单「数据备份」导出
· 蓝牙体脂秤功能需要安卓 APK 版，网页版没有
· 每天定点提醒需要 App 在后台运行，网页版只在你打开时提醒
```

## 六、LLM 接口浏览器直连矩阵（2026-10-25 实测：CORS 预检 + 错误路径）

| 接口 | 浏览器直连 | 备注 |
|---|---|---|
| `https://api.moonshot.cn`（Kimi 开放平台） | ✅ | 全路径回 CORS 头；`kimi-k3` 支持视觉，**PWA 首选** |
| `https://api.deepseek.com` | ✅ | 全路径支持；无视觉模型，拍照识别不可用 |
| `https://ark.cn-beijing.volces.com`（火山方舟） | ⚠️ 未定论 | 预检过但 401 错误响应丢头；拿真 Key 在浏览器控制台 fetch 一次即可定论 |
| `https://spark-api-open.xf-yun.com`（讯飞） | ❌ 预检 403 | 仅 APK 内经 CapacitorHttp 可用 |
| `https://api.kimi.com/coding`（Kimi Coding Plan） | ❌ 预检 404 | 仅 APK 内可用；预设按钮已按环境自动区分 |
| `https://open.bigmodel.cn`（智谱） | ❌ 无 CORS 头 | 需代理，不建议 |

## 七、PWA 与 APK 能力差异（如实告知）

| 能力 | APK | PWA 网页版 |
|---|---|---|
| 聊天/饮食记录/习惯打卡/趋势/记忆 | ✅ | ✅ 完整可用 |
| 拍照识别饮食 | ✅ | ✅（需 Kimi 等支持视觉的模型） |
| 蓝牙体脂秤直连 | ✅ | ❌ 入口已隐藏（iOS 无 Web Bluetooth） |
| 关闭 App 后的定点提醒 | ✅ 系统级通知 | ❌ 仅打开 App 时可见 |
| 数据存储 | IndexedDB（随 APK） | IndexedDB（主屏幕 Web App 豁免 7 天清除，已申请 persist） |
| 更新方式 | 重装 APK | 重新打开链接自动拿新版 |

## 八、常见问题排查

| 症状 | 原因与处理 |
|---|---|
| 朋友聊天一直报错 | Key 没填/填错，或 BASE URL 填了 Coding Plan/讯飞地址（浏览器不通）——重新点「Kimi K3 全量配置」预设并只填 Key |
| 拍照识别没反应 | 用的 DeepSeek 等无视觉模型——换 Kimi 开放平台 |
| 桌面图标是截图样子 | 未生成 apple-touch-icon 引用或用了旧版本部署——确认部署的是 v3.19.0+ 的 `www/` |
| 更新后朋友看到的还是旧版 | Service Worker 网络优先，在线刷新即最新；确要强刷：Safari 设置里清除该网站数据 |
| 数据不见了 | 用户在 Safari 里「清除浏览数据」会连带清 Web App 存储——引导用菜单「数据备份」定期导出 |
| 收不到提醒 | PWA 已知限制（无后台通知），见第七节 |
| 朋友在海外访问慢 | EdgeOne 有全球节点，一般无碍；可再镜像一份到 Cloudflare Pages 作备用链接 |

## 九、合规说明

PWA 版每个用户填**自己的** API Key、浏览器直连官方接口，**没有共享后端**——不触碰讯飞 Coding Plan「禁止将 Key 用于自建应用后端」的条款。请勿改回「内置共享 Key + 公网代理」的模式；也不要把 PWA 当作对外运营的产品大规模推广（各家 Key 条款均限个人使用）。

## 十、日常维护速查

| 场景 | 操作 |
|---|---|
| 改了前端代码 | `npm run sync` → `npm run verify` → `node --test` → 提交 → 重新部署 `www/`（方式 A 重拖 / 方式 B 自动） |
| 换 App 图标 | 替换 `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` → `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-icons.ps1` → `npm run sync` → 部署 |
| 想看部署是否生效 | 手机 Safari 打开链接 → ☰ 菜单 → 更新日志，看版本号 |
| Service Worker 缓存清理 | 无需手动：缓存名带版本（`sw.js` 顶部），发新版自动清旧缓存 |
| 朋友反馈异常 | 让其 ☰ 菜单 → 数据备份导出 `.qb.json` 发来排查 |
