$ErrorActionPreference = "Stop"

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
    } finally {
      $algorithm.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -Raw -LiteralPath (Join-Path $projectRoot "package.json") | ConvertFrom-Json
$electronVersion = [string]$packageJson.devDependencies.electron
if ($electronVersion -notmatch '^\d+\.\d+\.\d+$') {
  throw "package.json must pin an exact Electron version"
}

$electronRoot = Join-Path $projectRoot "node_modules\electron"
$distRoot = Join-Path $electronRoot "dist"
$installedVersion = (Get-Content -Raw -LiteralPath (Join-Path $distRoot "version")).Trim()
if ($installedVersion -ne $electronVersion) {
  throw "Installed Electron version does not match package.json"
}
if (-not (Test-Path -LiteralPath (Join-Path $distRoot "electron.exe") -PathType Leaf)) {
  throw "Installed Electron Windows runtime is incomplete"
}

$architecture = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) { "arm64" } else { "x64" }
$cacheRoot = Join-Path $projectRoot "downloads\electron-cache"
$archiveName = "electron-v$electronVersion-win32-$architecture.zip"
$zipPath = Join-Path $cacheRoot $archiveName
$checksums = Get-Content -Raw -LiteralPath (Join-Path $electronRoot "checksums.json") | ConvertFrom-Json
$expectedHash = [string]$checksums.$archiveName
if ($expectedHash -notmatch '^[a-f0-9]{64}$') {
  throw "Electron package does not contain a trusted checksum for $archiveName"
}
if ((Test-Path -LiteralPath $zipPath -PathType Leaf) -and (Get-Sha256 $zipPath) -eq $expectedHash) {
  Write-Host "Electron local ZIP cache is ready: $zipPath"
  exit 0
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
$temporaryZip = "$zipPath.part"
if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip -Force }
$downloadUrl = "https://github.com/electron/electron/releases/download/v$electronVersion/$archiveName"
$curlExecutable = Join-Path ([string]$env:SystemRoot) "System32\curl.exe"
if (-not (Test-Path -LiteralPath $curlExecutable -PathType Leaf)) {
  throw "Windows curl.exe is required to download the checksum-pinned Electron runtime"
}
& $curlExecutable --proto "=https" --tlsv1.2 --location --fail --retry 2 --output $temporaryZip $downloadUrl
if ($LASTEXITCODE -ne 0) {
  if (Test-Path -LiteralPath $temporaryZip) { Remove-Item -LiteralPath $temporaryZip -Force }
  throw "Electron official ZIP download failed with curl exit code $LASTEXITCODE"
}
if ((Get-Sha256 $temporaryZip) -ne $expectedHash) {
  Remove-Item -LiteralPath $temporaryZip -Force
  throw "Downloaded Electron ZIP checksum does not match the npm-locked checksums.json"
}
Move-Item -LiteralPath $temporaryZip -Destination $zipPath -Force
Write-Host "Electron official ZIP cache downloaded and verified: $zipPath"
