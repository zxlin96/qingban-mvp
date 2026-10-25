# EdgeOne Pages（现名 EdgeOne Makers）注册与首次部署 · 详细版

> 本文是 `docs/PWA-DEPLOY.md` 第三节的展开。目标读者：第一次用 EdgeOne Pages 的你。
>
> **先纠正一个易混点**：EdgeOne 是**腾讯云**的产品（近期已从 "EdgeOne Pages" 更名为 "EdgeOne Makers"，账号、项目、域名一切不变），和火山引擎（字节跳动云）没有关系。免费档**无需绑定银行卡**。

## 一、注册前准备

| 需要 | 说明 |
|---|---|
| 一个邮箱或手机号 | 注册账号用（邮箱推荐，国际站流程最短；国内站可用手机号/微信） |
| GitHub 账号（可选但推荐） | 想要「push 代码自动部署」就绑定；纯手动拖拽部署则不需要 |
| **不需要** | 银行卡、ICP 备案（默认 `*.edgeone.app` 域名免备案）、Apple 开发者账号 |

## 二、注册（两条路径，选一条）

### 路径 A：国际站 edgeone.ai（推荐，流程最短）

1. 打开官网 https://edgeone.ai （自带中文界面）
2. 点右上角「登录」→ 跳到登录页 https://edgeone.ai/login
3. 点「注册」：填邮箱 + 密码即可；也支持 **Google 账号一键注册**（全程免绑卡）
4. 收验证邮件 → 点激活链接 → 登录成功
5. 控制台地址（可收藏）：https://console.tencentcloud.com/edgeone/pages

### 路径 B：腾讯云国内站（已有腾讯云账号走这条）

1. 打开 https://cloud.tencent.com → 右上角「免费注册」
2. 手机号/微信扫码注册，按提示完成个人实名认证
3. 登录后进控制台，搜索「EdgeOne」，直达：https://console.cloud.tencent.com/edgeone/makers

> 两个站点账号体系相互独立，轻伴这种纯静态分享站用哪个都能部署成功。路径 A 步骤最少；路径 B 适合已有腾讯云账号、习惯国内站的人。

**★ 大陆用户必读**：按官方文档规定，中国境内用户**必须注册并登录控制台**，部署生成的访问链接才是永久有效的；**未登录状态下**通过 Drop 部署的链接**只有 1 小时有效期**。所以务必先完成上面的注册登录，再进行部署。

## 三、首次部署轻伴（`www/` 目录）

### 方式 A：拖拽（Drop，最快，不用 GitHub）

1. 在电脑上进入仓库目录，先跑一次同步确保 `www/` 最新：
   ```bash
   npm run sync        # 或 ./node-v22.23.2-win-x64/node.exe scripts/sync-web.mjs
   ```
2. 确认**已登录** EdgeOne 账号（看第二步）
3. 打开 Drop 页面：https://pages.edgeone.ai/drop
4. 把整个 `www/` 文件夹拖进虚线框 → 几秒后部署完成，页面显示 `xxx.edgeone.app` 访问链接
5. 该链接即为发给朋友的正式链接；到控制台「项目列表」里可以持续管理它

> 拖拽部署的内容 = 发版：以后每次更新代码，重新拖一次新 `www/` 即可。

### 方式 B：绑定 GitHub 自动部署（推荐长期使用）

1. 进控制台 → 「创建项目」→ 选择「导入 Git 仓库」→ 点绑定 GitHub → 跳转 GitHub 授权（可只授权指定仓库）
2. 仓库列表选中 `zxlin96/qingban-mvp`
3. 构建配置按下表填写（轻伴专用）：

   | 配置项 | 填写值 | 说明 |
   |---|---|---|
   | 项目名称 | `qingban` | 决定默认域名（形如 `qingban-xxx.edgeone.app`，具体以页面提示为准） |
   | 根目录 | `./` | 仓库根就是站点根 |
   | 构建命令 | **留空** | 轻伴是纯静态站，无需构建 |
   | 输出目录 | `www` | 部署产物目录（必须是 www，不是仓库根） |

4. 点「部署」→ 控制台实时看构建日志 → 几十秒后完成，得到默认域名
5. 之后**每次 `git push`，网页版自动重新部署**；打 `v*` tag 发版时，网页版与 APK（CI Release）同步更新，两边永远一致

## 四、验证部署成功（1 分钟）

1. 手机 Safari 打开部署链接：界面完整加载、无红色报错横幅
2. 点 ☰ 菜单 → 「更新日志」→ 版本号 ≥ v3.19.0
3. Safari 分享 → 添加到主屏幕 → 图标和名称「轻伴」正确
4. 完整验收对照 `docs/PWA-DEPLOY.md` 第四节的 8 项自检清单

## 五、常见问题

| 问题 | 处理 |
|---|---|
| 链接过了 1 小时失效了 | 那是未登录账号部署的临时链接。登录账号后重新部署（Drop 重拖或走方式 B），新链接永久有效 |
| 大陆访问速度一般 | 默认节点全球分布（不含大陆专属加速），但普遍优于 GitHub Pages / Cloudflare Pages。项目设置里有「加速区域」选项，需要大陆优化可按控制台提示调整（详见官方文档） |
| 想换链接前缀（子域名） | 默认子域名跟项目名称走；控制台「项目设置」里改名后重新部署 |
| 想用自己的域名 | 项目设置 → 域名管理 → 添加域名 → 按提示去域名服务商加一条 CNAME 解析 → 平台自动签发免费 HTTPS 证书（TrustAsia，自动续期）。走国际加速节点**无需备案**；要大陆节点加速则域名需 ICP 备案 |
| 免费额度够吗 | 官方 FAQ：Pages 基础功能近乎无限制免费、无需绑卡；轻伴这种分享场景远用不到上限。商业化政策如有调整以官网为准 |
| 和 PWA 的 Service Worker 冲突吗 | 不冲突。`sw.js` 部署在域名根目录、scope 正常；网络优先策略保证朋友重新打开链接就是最新版 |

## 六、相关链接

| 资源 | 地址 |
|---|---|
| 官网 | https://edgeone.ai |
| 登录/注册 | https://edgeone.ai/login |
| 国际站控制台 | https://console.tencentcloud.com/edgeone/pages |
| 国内站控制台 | https://console.cloud.tencent.com/edgeone/makers |
| 拖拽部署 Drop | https://pages.edgeone.ai/drop |
| 官方文档（含更名说明） | https://pages.edgeone.ai/zh/document / [Release Notes](https://pages.edgeone.ai/zh/document/release-notes) |
| CLI 部署（进阶） | https://pages.edgeone.ai/zh/document/edgeone-cli |
| 第三方详细教程（本文参考） | [zyglq.cn 教程](https://www.zyglq.cn/posts/qcloud-eo-pages-guide.html) · [腾讯云官方介绍](https://cloud.tencent.com/developer/article/2458968) |
