Add-Type -Assembly System.IO.Compression
Add-Type -Assembly System.IO.Compression.FileSystem

$src = $PSScriptRoot
if (-not $src) { $src = Get-Location }
$staging = Join-Path (Split-Path $src -Parent) "tunescript-firefox-staging"
$zipPath = Join-Path (Split-Path $src -Parent) "tunescript-firefox.zip"

Write-Host "Creating Firefox build staging area at $staging..."
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging | Out-Null

# Folders and files to include
$itemsToInclude = @("background", "content", "icons", "popup", "shared", "styles", "manifest.json")
foreach ($item in $itemsToInclude) {
    Copy-Item "$src\$item" -Destination "$staging\$item" -Recurse -Force
}

# Rename background script
Rename-Item "$staging\background\service-worker.js" -NewName "background.js"

Write-Host "Transforming manifest.json for Firefox..."
$manifestPath = "$staging\manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

# Add browser_specific_settings using Add-Member
$manifest | Add-Member -MemberType NoteProperty -Name "browser_specific_settings" -Value @{
    gecko = @{
        id = "akshar@lyrics-romanizer"
        strict_min_version = "142.0"
        data_collection_permissions = @{
            required = @("none")
        }
    }
} -Force

# Fix permissions (remove activeTab and declarativeNetRequest)
if ($manifest.permissions) {
    $manifest.permissions = @($manifest.permissions | Where-Object { $_ -notmatch 'activeTab|declarativeNetRequest' })
}

# Remove declarative_net_request block
if ($manifest.psobject.properties.match('declarative_net_request').Count -gt 0) {
    $manifest.psobject.properties.Remove('declarative_net_request')
}

# Fix host_permissions (remove localhost)
if ($manifest.host_permissions) {
    $manifest.host_permissions = @($manifest.host_permissions | Where-Object { $_ -ne 'http://localhost:11434/*' })
}

# Change background service worker to scripts with forward slashes
$manifest.background = @{
    scripts = @("background/background.js")
}

$jsonContent = $manifest | ConvertTo-Json -Depth 10
Set-Content -Path $manifestPath -Value $jsonContent -Encoding UTF8

Write-Host "Zipping Firefox extension with POSIX forward-slash relative paths..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Use .NET ZipArchive to guarantee forward slashes in zip entry paths (AMO requirement)
$zipMode = [System.IO.Compression.ZipArchiveMode]::Create
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, $zipMode)

$stagingPath = (Get-Item $staging).FullName
Get-ChildItem -Path $stagingPath -Recurse | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $relPath = $_.FullName.Substring($stagingPath.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relPath) | Out-Null
}

$zip.Dispose()

Write-Host "Cleaning up staging area..."
Remove-Item $staging -Recurse -Force

Write-Host "Firefox build completed successfully: $zipPath"
