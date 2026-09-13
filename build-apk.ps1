# APK Build Script for 轻伴 MVP
# Runs outside the TRAE sandbox via Task Scheduler
$ErrorActionPreference = "Continue"
$LogFile = "c:\Users\zxlin\Desktop\qingban-mvp-download\qingban-mvp\build-log.txt"
$StatusFile = "c:\Users\zxlin\Desktop\qingban-mvp-download\qingban-mvp\build-status.txt"
$projectRoot = "c:\Users\zxlin\Desktop\qingban-mvp-download\qingban-mvp"
$androidDir = "$projectRoot\android"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts - $msg" | Out-File $LogFile -Append -Encoding UTF8
    Write-Host "$ts - $msg"
}

# Clear previous log and status
"" | Out-File $LogFile -Encoding UTF8
"RUNNING" | Out-File $StatusFile -Encoding UTF8
Log "=== APK Build Started ==="

# Step 1: Set environment variables
Log "Step 1: Setting environment variables..."
$env:JAVA_HOME = "$projectRoot\jdk21"
$env:ANDROID_HOME = "$projectRoot\android-sdk"
$env:ANDROID_SDK_ROOT = "$projectRoot\android-sdk"
$env:GRADLE_USER_HOME = "$projectRoot\gradle-home"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

# Verify Java
$javaExe = "$env:JAVA_HOME\bin\java.exe"
if (Test-Path $javaExe) {
    Log "Java found: $javaExe"
    $javaVersion = & $javaExe -version 2>&1
    Log "Java version: $javaVersion"
} else {
    Log "ERROR: Java not found at $javaExe"
    "FAILED" | Out-File $StatusFile -Encoding UTF8
    Log "=== Build Failed ==="
    exit 1
}
Log "JAVA_HOME: $env:JAVA_HOME"
Log "ANDROID_HOME: $env:ANDROID_HOME"

# Step 2: Verify web assets are synced
Log "Step 2: Verifying web assets..."
$syncedAssets = "$androidDir\app\src\main\assets\public\index.html"
if (Test-Path $syncedAssets) {
    Log "Web assets confirmed at $syncedAssets"
} else {
    Log "WARNING: Web assets not found, build may fail."
}

# Step 2.5: Sync latest web assets (www -> assets/public), equivalent to `cap copy`
# 根因修复：此前打包不拷贝 web 资源，全靠手动同步，曾导致 on-demand-loader.js 缺失、
# app.js 模块 404、整个应用黑屏卡「加载中」。此后每次打包前自动镜像 www 到原生工程。
Log "Step 2.5: Syncing web assets www -> assets/public..."
robocopy "$projectRoot\www" "$androidDir\app\src\main\assets\public" /E /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
    Log "ERROR: robocopy failed with exit code $LASTEXITCODE"
    "FAILED" | Out-File $StatusFile -Encoding UTF8
    Log "=== Build Failed ==="
    exit 1
}
Log "Web assets synced (robocopy exit $LASTEXITCODE)."

# Step 3: Build APK with Gradle (clean first to ensure latest assets are packaged)
Log "Step 3: Building APK with Gradle..."
Set-Location $androidDir

# Run gradlew.bat via cmd.exe for proper batch file execution
$gradlewCmd = "cd /d `"$androidDir`" && set JAVA_HOME=$env:JAVA_HOME&& set ANDROID_HOME=$env:ANDROID_HOME&& set ANDROID_SDK_ROOT=$env:ANDROID_SDK_ROOT&& set GRADLE_USER_HOME=$env:GRADLE_USER_HOME&& gradlew.bat clean assembleDebug --no-daemon 2>&1"
$buildOutput = & cmd.exe /c $gradlewCmd
$buildOutput | Out-File $LogFile -Append -Encoding UTF8
$buildExitCode = $LASTEXITCODE
Log "Gradle build exit code: $buildExitCode"

if ($buildExitCode -ne 0) {
    Log "ERROR: Gradle build failed with exit code $buildExitCode"
    $lastLines = $buildOutput | Select-Object -Last 30
    Log "Last 30 lines of output:"
    foreach ($line in $lastLines) { Log "  $line" }
    "FAILED" | Out-File $StatusFile -Encoding UTF8
    Log "=== Build Failed ==="
    exit 1
}

# Step 4: Copy APK to project root
Log "Step 4: Locating and copying APK..."
$apkPath = "$androidDir\build-output\app\outputs\apk\debug\app-debug.apk"
if (Test-Path $apkPath) {
    $destPath = "$projectRoot\qingban-debug.apk"
    Copy-Item $apkPath $destPath -Force
    Log "APK copied to: $destPath"
    Log "APK size: $((Get-Item $destPath).Length) bytes"
    "SUCCESS" | Out-File $StatusFile -Encoding UTF8
    Log "=== Build Successful ==="
} else {
    # Try other common output paths
    $altPaths = @(
        "$androidDir\app\build\outputs\apk\debug\app-debug.apk",
        "C:\Users\zxlin\.android\build\qingban\app\outputs\apk\debug\app-debug.apk"
    )
    $found = $false
    foreach ($altPath in $altPaths) {
        if (Test-Path $altPath) {
            $destPath = "$projectRoot\qingban-debug.apk"
            Copy-Item $altPath $destPath -Force
            Log "APK found at: $altPath"
            Log "APK size: $((Get-Item $destPath).Length) bytes"
            "SUCCESS" | Out-File $StatusFile -Encoding UTF8
            Log "=== Build Successful ==="
            $found = $true
            break
        }
    }
    if (-not $found) {
        Log "ERROR: APK file not found"
        Log "Checked: $apkPath"
        foreach ($altPath in $altPaths) { Log "Checked: $altPath" }
        "FAILED" | Out-File $StatusFile -Encoding UTF8
        Log "=== Build Failed ==="
        exit 1
    }
}
