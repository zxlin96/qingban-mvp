# gen-icons.ps1 — 从 Android 最高分辨率启动图标生成 PWA 图标集
# 源: android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png (192x192)
# 产物: icons/icon-192.png(直接复制) / icons/icon-512.png(放大) / icons/apple-touch-icon.png(180)
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gen-icons.ps1

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'
$iconsDir = Join-Path $root 'icons'

if (-not (Test-Path $srcPath)) { Write-Error "源图标不存在: $srcPath"; exit 1 }
New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null

$src = [System.Drawing.Image]::FromFile($srcPath)
Write-Host ("源图标: {0}x{1}" -f $src.Width, $src.Height)

function Save-Resized([System.Drawing.Image]$image, [string]$path, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($image, 0, 0, $size, $size)
  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("已生成: {0} ({1}x{1})" -f $path, $size)
}

Copy-Item $srcPath (Join-Path $iconsDir 'icon-192.png') -Force
Write-Host "已生成: icons\icon-192.png (复制原件)"
Save-Resized $src (Join-Path $iconsDir 'icon-512.png') 512
Save-Resized $src (Join-Path $iconsDir 'apple-touch-icon.png') 180
$src.Dispose()
