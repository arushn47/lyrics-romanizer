$ErrorActionPreference = 'Stop'
Add-Type -Assembly System.IO.Compression
Add-Type -Assembly System.IO.Compression.FileSystem

$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$buildRoot = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot 'build'))
if ((Test-Path -LiteralPath $buildRoot) -and ((Get-Item -LiteralPath $buildRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Build directory must not be a junction or symlink.' }
$staging = [System.IO.Path]::GetFullPath((Join-Path $buildRoot ('firefox-stage-' + [guid]::NewGuid().ToString('N'))))
$manifest = Get-Content -LiteralPath (Join-Path $sourceRoot 'manifest.json') -Raw | ConvertFrom-Json
$zipPath = [System.IO.Path]::GetFullPath((Join-Path $buildRoot ('tunescript-firefox-' + $manifest.version + '.zip')))
foreach ($target in @($staging, $zipPath)) {
    if (-not $target.StartsWith($buildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Build target escaped the workspace build directory.' }
    if ((Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Build target must not be a junction or symlink.' }
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    foreach ($item in @('background', 'content', 'icons', 'popup', 'shared', 'styles')) {
        Copy-Item -LiteralPath (Join-Path $sourceRoot $item) -Destination (Join-Path $staging $item) -Recurse -Force
    }
    # Keep the deferred Spotify adapter in the repository, outside this release.
    foreach ($file in @('spotify.js', 'spotify-dom.js')) {
        Remove-Item -LiteralPath (Join-Path $staging ('content/' + $file)) -Force
    }
    $manifest | Add-Member -MemberType NoteProperty -Name 'browser_specific_settings' -Value @{
        gecko = @{
            id = 'akshar@lyrics-romanizer'
            strict_min_version = '142.0'
            data_collection_permissions = @{ required = @('websiteContent', 'authenticationInfo') }
        }
    } -Force
    $manifest.permissions = @($manifest.permissions | Where-Object { $_ -ne 'declarativeNetRequest' })
    $manifest.PSObject.Properties.Remove('declarative_net_request')
    # activeTab resolves the current song for the popup's rerun action.
    $manifest.background = @{ scripts = @('shared/performance.js', 'shared/diagnostics.js', 'background/request-service.js', 'background/service-worker.js') }
    $manifest | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $staging 'manifest.json') -Encoding utf8
    $manifestFiles = @($manifest.content_scripts | ForEach-Object { $_.js; $_.css }) + @($manifest.background.scripts) + @($manifest.action.default_popup) + @($manifest.icons.PSObject.Properties.Value)
    foreach ($file in $manifestFiles) {
        if ($file -and -not (Test-Path -LiteralPath (Join-Path $staging $file) -PathType Leaf)) { throw "Missing package asset: $file" }
    }
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $staging -File -Recurse | Sort-Object FullName)) {
            $relative = $file.FullName.Substring($staging.Length + 1).Replace('\', '/')
            $entry = $zip.CreateEntry($relative)
            $entry.LastWriteTime = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $inputStream = [IO.File]::OpenRead($file.FullName)
            $outputStream = $entry.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() }
        }
    } finally { $zip.Dispose() }
    Write-Output "Firefox review package: $zipPath"
} finally {
    # Resolved absolute target was verified above, and this run created it.
    if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
}
