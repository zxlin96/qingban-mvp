# build-all.ps1 - 轻伴 MVP 一键打包脚本
# 用法: 在项目根目录运行 .\build-all.ps1
# 功能: 同步 Web 资源 -> Gradle 构建 -> 复制 APK -> 清理任务
# 注意: 本脚本应在 TRAE 终端或外部 PowerShell 中运行

param(
    [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

# ========== 配置 ==========
$projectRoot   = Resolve-Path $ProjectRoot
$androidDir    = Join-Path $projectRoot "android"
$buildScript   = Join-Path $projectRoot "build-apk.ps1"
$statusFile    = Join-Path $projectRoot "build-status.txt"
$logFile       = Join-Path $projectRoot "build-log.txt"
$apkOutput     = Join-Path $projectRoot "qingban-debug.apk"
$apkChinese    = Join-Path $projectRoot "轻伴-debug.apk"
$taskName      = "BuildAPK"

# ========== Node.js 路径检测 ==========
# 外部 PowerShell 可能缺少 Node.js，自动检测并添加到 PATH
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    $nodeCandidates = @(
        "$env:APPDATA\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node",
        "$env:LOCALAPPDATA\Programs\nodejs",
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs"
    )
    foreach ($nodePath in $nodeCandidates) {
        if (Test-Path (Join-Path $nodePath "npx.cmd")) {
            $env:PATH = "$nodePath;$env:PATH"
            Write-Host "  [i] 已添加 Node.js 路径: $nodePath" -ForegroundColor DarkYellow
            break
        }
    }
}

# ========== 辅助函数 ==========
function Write-Step($msg) {
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host "[$ts] $msg" -ForegroundColor Cyan
}

function Write-OK($msg) {
    Write-Host "  [OK] $msg" -ForegroundColor Green
}

function Write-Err($msg) {
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
}

function Write-Warn($msg) {
    Write-Host "  [!] $msg" -ForegroundColor Yellow
}

function Remove-BuildTask {
    <# 安全删除计划任务，忽略不存在的任务 #>
    try {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    } catch {
        # 任务不存在，忽略
    }
}

# ========== 前置检查 ==========
Write-Host ""
Write-Host "========================================" -ForegroundColor DarkCyan
Write-Host "  轻伴 MVP - APK 一键打包" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor DarkCyan
Write-Host ""

Write-Step "前置检查..."

# 检查项目根目录
if (-not (Test-Path $projectRoot)) {
    Write-Err "项目根目录不存在: $projectRoot"
    exit 1
}

# 检查 android 目录
if (-not (Test-Path $androidDir)) {
    Write-Err "android 目录不存在: $androidDir"
    exit 1
}

# 检查 JDK
$jdkPath = Join-Path $projectRoot "jdk21"
if (-not (Test-Path (Join-Path $jdkPath "bin\java.exe"))) {
    Write-Err "JDK 未找到: $jdkPath\bin\java.exe"
    Write-Host "  请从 TRAE 虚拟层复制 JDK: Copy-Item 'C:\Users\zxlin\.local\jdk\jdk-21.0.11+10' '$jdkPath' -Recurse -Force"
    exit 1
}

# 检查 Android SDK
$sdkPath = Join-Path $projectRoot "android-sdk"
if (-not (Test-Path $sdkPath)) {
    Write-Err "Android SDK 未找到: $sdkPath"
    Write-Host "  请从 TRAE 虚拟层复制 SDK: Copy-Item 'C:\Users\zxlin\.android\sdk' '$sdkPath' -Recurse -Force"
    exit 1
}

# 检查 Gradle Home
$gradleHome = Join-Path $projectRoot "gradle-home"
if (-not (Test-Path $gradleHome)) {
    Write-Err "Gradle Home 未找到: $gradleHome"
    Write-Host "  请从 TRAE 虚拟层复制: Copy-Item 'C:\Users\zxlin\.gradle' '$gradleHome' -Recurse -Force"
    exit 1
}

# 检查 build-apk.ps1
if (-not (Test-Path $buildScript)) {
    Write-Err "构建脚本未找到: $buildScript"
    exit 1
}

# 检查 npx（Capacitor 同步需要）
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Err "npx 未找到，Node.js 未安装或不在 PATH 中"
    Write-Host "  请安装 Node.js，或手动添加到 PATH:" -ForegroundColor Yellow
    Write-Host "    `$env:PATH = '`$env:APPDATA\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node;`$env:PATH'" -ForegroundColor DarkGray
    exit 1
}

Write-OK "所有前置条件检查通过"

# ========== Step 1: 同步 Web 资源 ==========
Write-Host ""
Write-Step "Step 1/4: 同步 Web 资源到 Android..."

Push-Location $projectRoot
try {
    # 1a. 源目录(js/css/data/index.html/manifest.json) → www/ → android assets
    $syncResult = & node scripts/sync-web.mjs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "三目录同步失败"
        $syncResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Pop-Location
        exit 1
    }
    $syncResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    # 1b. Capacitor 同步: www/ → android assets + 插件更新
    $npxResult = & npx cap sync android 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Web 资源同步失败"
        $npxResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Pop-Location
        exit 1
    }
    $npxResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    # 1c. Android 包版本同步: package.json → build.gradle (versionName/versionCode)
    $verResult = & node scripts/sync-android-version.mjs 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Android 版本同步失败"
        $verResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        Pop-Location
        exit 1
    }
    $verResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    Write-OK "Web 资源同步完成"
} catch {
    Write-Err "同步异常: $_"
    Pop-Location
    exit 1
}
Pop-Location

# ========== Step 2: 执行 Gradle 构建 ==========
Write-Host ""
Write-Step "Step 2/4: 通过 Task Scheduler 执行 Gradle 构建..."

# 清理之前的任务
Remove-BuildTask

# 创建新的构建任务（使用 PowerShell 原生 cmdlet，避免沙箱中 schtasks.exe 不可用）
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$buildScript`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(10)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User $env:USERNAME -Force | Out-Null
} catch {
    Write-Err "创建计划任务失败: $_"
    exit 1
}
Write-OK "计划任务已创建"

# 运行任务
try {
    Start-ScheduledTask -TaskName $taskName
} catch {
    Write-Err "启动计划任务失败: $_"
    exit 1
}
Write-OK "构建任务已启动"

# ========== Step 3: 监控构建状态 ==========
Write-Host ""
Write-Step "Step 3/4: 等待构建完成..."

$maxWaitSeconds = 300
$checkInterval  = 5
$waitedSeconds  = 0

while ($waitedSeconds -lt $maxWaitSeconds) {
    Start-Sleep -Seconds $checkInterval
    $waitedSeconds += $checkInterval

    if (Test-Path $statusFile) {
        $status = (Get-Content $statusFile -Raw).Trim()
        if ($status -eq "SUCCESS") {
            Write-OK "构建成功! (耗时 ${waitedSeconds}s)"
            break
        } elseif ($status -eq "FAILED") {
            Write-Err "构建失败! (耗时 ${waitedSeconds}s)"
            Write-Host ""
            Write-Host "构建日志最后 30 行:" -ForegroundColor Yellow
            if (Test-Path $logFile) {
                Get-Content $logFile | Select-Object -Last 30 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            }
            Remove-BuildTask
            exit 1
        }
        # RUNNING - 继续等待
        $dots = "." * (($waitedSeconds / $checkInterval) % 4 + 1)
        Write-Host "`r  等待中$dots    (已等待 ${waitedSeconds}s)  " -NoNewline -ForegroundColor Gray
    }
}

# 超时处理
if ($waitedSeconds -ge $maxWaitSeconds) {
    Write-Err "构建超时 (${maxWaitSeconds}s)"
    Remove-BuildTask
    exit 1
}

# ========== Step 4: 验证并复制 APK ==========
Write-Host ""
Write-Step "Step 4/4: 验证并复制 APK..."

if (Test-Path $apkOutput) {
    $sizeBytes = (Get-Item $apkOutput).Length
    $sizeMB = [math]::Round($sizeBytes / 1MB, 2)
    $builtTime = (Get-Item $apkOutput).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")

    Write-OK "APK 文件: $apkOutput"
    Write-OK "文件大小: $sizeMB MB"
    Write-OK "构建时间: $builtTime"

    # 复制中文命名版本
    Copy-Item $apkOutput $apkChinese -Force
    Write-OK "已复制中文命名版本: $apkChinese"
} else {
    Write-Err "APK 文件未找到: $apkOutput"
    exit 1
}

# ========== 清理 ==========
Remove-BuildTask
Write-OK "已清理计划任务"

# ========== 完成 ==========
Write-Host ""
Write-Host "========================================" -ForegroundColor DarkGreen
Write-Host "  打包完成!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor DarkGreen
Write-Host ""
Write-Host "  APK 文件:" -ForegroundColor White
Write-Host "    qingban-debug.apk ($sizeMB MB)" -ForegroundColor Green
Write-Host "    轻伴-debug.apk   ($sizeMB MB)" -ForegroundColor Green
Write-Host ""
