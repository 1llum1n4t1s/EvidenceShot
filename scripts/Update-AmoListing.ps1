#requires -Version 7.0
[CmdletBinding()]
param([switch]$MetadataOnly, [switch]$PreviewsOnly, [switch]$DryRun, [string]$PreviewDirectory = "$PSScriptRoot/../webstore/images", [Net.Http.HttpMessageHandler]$HttpHandler)
$ErrorActionPreference = 'Stop'
if ($MetadataOnly -and $PreviewsOnly) { throw 'Choose only one operation filter' }
Import-Module "$PSScriptRoot/Amo-Http.psm1" -Force
$root = Split-Path $PSScriptRoot -Parent
$addonId = '{ff2db429-9e61-439d-9e11-b565113d5711}'
$path = '/api/v5/addons/addon/' + [Uri]::EscapeDataString($addonId) + '/'
$repo = 'https://github.com/1llum1n4t1s/EvidenceShot'
$body = @{
    default_locale='ja'
    summary=@{ja='Web テスト向けに、表示領域 / スクロール連結 / 中央本文のスクリーンショットを 15 種の日時スタンプ入りで保存できる拡張機能。PNG 出力には改ざん検知用の iTXt メタデータを自動付与します。';'en-US'='A Firefox extension for evidence-style screenshots (viewport / full-page stitched / main column) with 15 timestamp overlay styles. PNG output embeds tamper-detection iTXt metadata for auditing.'}
    description=@{ja=(Get-Content "$root/webstore/store-listing.txt" -Raw).Trim();'en-US'=(Get-Content "$root/webstore/store-listing.en-US.txt" -Raw).Trim()}
    homepage=@{ja=$repo;'en-US'=$repo}; support_url=@{ja="$repo/issues";'en-US'="$repo/issues"}
    support_email=@{ja='1llum1n4t1@duck.com';'en-US'='1llum1n4t1@duck.com'}
    has_privacy_policy=$true
    privacy_policy=@{ja=(Get-Content "$root/docs/privacy-policy-ja.md" -Raw).Trim();'en-US'=(Get-Content "$root/docs/privacy-policy.md" -Raw).Trim()}
    categories=@('web-development'); tags=@('download');is_experimental=$false;requires_payment=$false
}
$policy = @{ privacy_policy=$body.privacy_policy }
$body.Remove('privacy_policy') | Out-Null
$body.Remove('has_privacy_policy') | Out-Null
$previews = @(
    @('01-feature-overview-1280x800.png','機能概要','Feature overview'),
    @('02-how-to-use-1280x800.png','使い方','How to use'),
    @('03-hero-promo-1280x800.png','撮影サンプル','Sample capture')
)
if ($DryRun) { Write-Output (@{listing=$body;policy=$policy} | ConvertTo-Json -Depth 20); return }
$client = New-AmoClient -HttpHandler $HttpHandler
try {
    if (!$PreviewsOnly) {
        $result = Invoke-AmoApi $client 'PATCH' $path -Body $body
        if ($result.guid -cne $addonId) { throw 'AMO listing response identity mismatch' }
        $null = Invoke-AmoApi $client 'PATCH' ($path+'eula_policy/') -Body $policy
        # PATCH returns rendered Markdown; authenticated show_source exposes raw input.
        $result = Invoke-AmoApi $client 'GET' ($path+'eula_policy/?show_source=1')
        foreach ($locale in 'ja','en-US') {
            if ($result.privacy_policy[$locale] -cne $policy.privacy_policy[$locale]) { throw 'AMO privacy policy update not confirmed' }
        }
        Write-Output 'AMO metadata and privacy policy updated'
    }
    if (!$MetadataOnly) {
        # Existing previews remain in place; new images are appended.
        foreach ($preview in $previews) {
            $file = Join-Path $PreviewDirectory $preview[0]
            if (!(Test-Path -LiteralPath $file -PathType Leaf)) { Write-Warning "Preview missing: $($preview[0]); skipped"; continue }
            $result = Invoke-AmoApi $client 'POST' ($path+'previews/') -Form @{image=(Get-Item -LiteralPath $file)}
            if ($result.id -isnot [long] -or $result.id -le 0) { throw 'AMO preview acceptance not confirmed' }
            $previewId = $result.id
            $caption = @{ja=$preview[1];'en-US'=$preview[2]}
            $result = Invoke-AmoApi $client 'PATCH' ($path+"previews/$previewId/") -Body @{caption=$caption}
            if ($result.id -ne $previewId -or $result.caption.ja -cne $caption.ja -or $result.caption['en-US'] -cne $caption['en-US']) { throw 'AMO preview caption update not confirmed' }
            Write-Output "AMO preview accepted: $previewId"
        }
    }
} finally { $client.Dispose() }
