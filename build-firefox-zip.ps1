Add-Type -Assembly System.IO.Compression.FileSystem

$src = "D:\CODING\Extensions\akshar"
$staging = "D:\CODING\Extensions\akshar-firefox-staging"
$zipPath = "D:\CODING\Extensions\akshar-firefox.zip"

Write-Host "Creating Firefox build staging area..."
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

# Change background service worker to scripts
$manifest.background = @{
    scripts = @("background/background.js")
}

$jsonContent = $manifest | ConvertTo-Json -Depth 10
Set-Content -Path $manifestPath -Value $jsonContent -Encoding UTF8

Write-Host "Zipping Firefox extension..."
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Compress-Archive -Path "$staging\*" -DestinationPath $zipPath -Force

Write-Host "Cleaning up staging area..."
Remove-Item $staging -Recurse -Force

Write-Host "Firefox build completed: $zipPath"
