# EvidenceShot のパッケージングスクリプト

$ErrorActionPreference = "Stop"

Write-Host "EvidenceShot をパッケージングします..." -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent ($MyInvocation.MyCommand.Path ?? $PSCommandPath ?? $PWD)
if ($scriptDir) { Set-Location $scriptDir }

Write-Host "アイコンを生成しています..." -ForegroundColor Yellow
npm install --silent
if ($LASTEXITCODE -ne 0) { throw "npm install に失敗しました" }
node scripts/generate-icons.js
if ($LASTEXITCODE -ne 0) { throw "アイコン生成に失敗しました" }

$zipName = "evidence-shot.zip"
if (Test-Path $zipName) {
    Remove-Item $zipName -Force
}

$tempDir = "temp-build"
if (Test-Path $tempDir) {
    Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

Copy-Item "manifest.json" -Destination $tempDir
Copy-Item "icons" -Destination $tempDir -Recurse
Copy-Item "src" -Destination $tempDir -Recurse
if (Test-Path "_locales") {
    Copy-Item "_locales" -Destination $tempDir -Recurse
}

Get-ChildItem -Path $tempDir -Recurse -Include "*.DS_Store", "*.swp", "*~" | Remove-Item -Force

Write-Host "ZIP を作成しています..." -ForegroundColor Cyan
Compress-Archive -Path "$tempDir/*" -DestinationPath $zipName -Force
Remove-Item $tempDir -Recurse -Force

if (Test-Path $zipName) {
    $fileSize = (Get-Item $zipName).Length
    $fileSizeKB = [math]::Round($fileSize / 1KB, 2)
    Write-Host "ZIP を作成しました: $zipName" -ForegroundColor Green
    Write-Host "サイズ: $fileSizeKB KB" -ForegroundColor White
} else {
    Write-Host "ZIP の作成に失敗しました" -ForegroundColor Red
    exit 1
}
