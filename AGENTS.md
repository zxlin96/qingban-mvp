# AGENTS.md — 轻伴 MVP

轻伴（qingban-mvp）是 AI 减肥陪伴助手 MVP。架构为 **Android WebView 壳应用（Capacitor 8）+ 原生 JS 前端 + Node.js 后端代理**。后端 `server.js` 将请求转发到讯飞星辰 Coding Plan（OpenAI 兼容协议，SSE 流式）。

## 启动与运行

- **本地 Web**：`npm start`（即 `node server.js`），默认 `PORT=3000`，需 Node 20.6+（用原生 `process.loadEnvFile()` 加载 `.env`）。
- **环境变量**：复制 `.env.example` 为 `.env`，填 `XF_API_KEY`（讯飞 Coding Plan API Key）。未配置时 `server.js` 启动即退出。
- **构建 APK**：`./build-all.ps1`（同步 Web 资源 → Gradle 构建 → 复制 APK）。工具链全部本地化：`jdk21/`、`android-sdk/`、`gradle-home/`（均在 `.gitignore` 中，不提交）。构建产物 `qingban-debug.apk` / `轻伴-debug.apk`。
- **测试与校验**：`npm test`（Node 原生 node:test，`test/*.test.js`，零依赖）；`npm run sync` / `npm run verify`（三目录同步与 MD5 校验，`build-all.ps1` 已接入同一脚本）。无 lint、无 typecheck；真机手动验收用 `docs/REGRESSION.md`，发版前逐项过。

## 三目录同步约定（关键）

源码维护三份副本，改动后必须同步并校验：

```
js/   →  www/js/   →  android/app/src/main/assets/public/js/
css/  →  www/css/  →  android/app/src/main/assets/public/css/
```

- `js/` 是源，`www/` 是 Capacitor 打包资源（`capacitor.config.json` 的 `webDir: www`），android assets 是最终随 APK 分发的副本。
- 改完 `js/` 或 `css/` 后运行 `npm run sync`（自动复制 + 清理孤儿文件），再跑 `npm run verify` 确认 MD5 一致。只改源未同步视为未完成。
- `android/app/src/main/assets/public/` 已在 `.gitignore` 中（构建时从 `www/` 生成），但开发期仍需手动同步以保持一致。
- `index.html`、`manifest.json` 同样在根目录与 `www/` 各有一份，改动需同步。

## 版本号与更新日志（关键）

每次功能改动或修复后，必须同时更新**五处**：

1. `js/app.js` 的 `APP_VERSION` 和 `APP_VERSION_DATE`（文件顶部，`const APP_VERSION = '3.4.x'`）
2. `js/app.js` 的 `CHANGELOG` 数组顶部插入新条目（应用内"关于"页展示）
3. `package.json` 的 `version`
4. `CHANGELOG.md` 顶部新增条目（仓库记录）
5. `android/app/build.gradle` 的 `versionName`/`versionCode` —— **由 `scripts/sync-android-version.mjs` 自动同步**（`npm run sync` / `npm run verify` / `build-all.ps1` 均已接入），无需手动改

- 版本号语义化递增（如 3.4.7 → 3.4.8）。`CHANGELOG` 数组与 `CHANGELOG.md` 内容必须一致。
- 改完 `js/app.js` 后按三目录同步约定同步到副本。

## 架构要点

- **前端**：原生 JS（无框架），`index.html` + `css/style.css` + `js/*.js`。入口 `js/app.js`。
- **后端**：`server.js` 单文件，`/api/chat`（非流式）、`/api/chat/stream`（SSE）、`/api/health`（健康检查），其余走静态文件服务。`cleanMessages()` 会剥离非标准字段（如 `_pendingAction`）避免讯飞拒绝。
- **LLM 服务**：`js/spark-llm.js`（讯飞/OpenAI/Anthropic 多协议适配）、`js/llm-service.js`（KV Cache 三层缓存 + 工具调度）、`js/mock-llm.js`（离线 mock）。
- **业务模块**：`chat-manager.js`、`diet-recorder.js`（饮食记录）、`habit-manager.js`（习惯打卡）、`file-manager.js`、`index-manager.js`、`profile-learner.js`、`notification-manager.js`、`auto-dream.js`、`on-demand-loader.js`、`settings.js`、`app-config.js`。
- **AI 记忆**：AI 角色指令内嵌于 `js/file-manager.js` 的 `_getClaudeMd()`（v12），用户数据文件（PROFILE/BODY_METRICS/rules 等）为 IndexedDB 虚拟文件，由 AI 通过 `read_file`/`write_file` 工具读写；`data/` 目录仅存用户数据模板（CLAUDE.md 已删，运行时不用）
- **Capacitor**：`appId: com.qingban.mvp`，`androidScheme: https`，启用 `CapacitorHttp`、`allowMixedContent`。

## 合规限制

讯飞 Coding Plan 条款（4.2.3 节）禁止将 API Key 用于自建应用后端。`server.js` 仅作本地功能演示，请勿上线或批量调用。文档：https://www.xfyun.cn/doc/spark/CodingPlan.html

## Bash 环境注意

该项目的 bash 工具环境中 heredoc 语法和多行消息可能出错。执行 `git commit` 时用单行 `git commit -m "消息"`，或拆分为多个单行 `-m` 参数，避免 heredoc（`<<'EOF'`）。

## 命名约定

使用 camelCase（如 `_dataIntegrityCheck`、`handleDayRollover`、`saveDailySummary`）。