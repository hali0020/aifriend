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
$sourceVendor = Join-Path $projectRoot "node_modules\electron-winstaller\vendor"
if (-not (Test-Path -LiteralPath (Join-Path $sourceVendor "Squirrel.exe") -PathType Leaf)) {
  throw "electron-winstaller vendor runtime is missing; run npm ci first"
}

$nugetVersion = "6.11.1"
$nugetHash = "c0ddc9cb0633c4607da7e8028eb4f91248c8b74e45a68b0c79fcfa7d78c2a481"
$cacheRoot = Join-Path $projectRoot "downloads\nuget-cache"
$cachedNuget = Join-Path $cacheRoot "nuget-$nugetVersion.exe"
if (-not (Test-Path -LiteralPath $cachedNuget -PathType Leaf) -or (Get-Sha256 $cachedNuget) -ne $nugetHash) {
  New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
  $temporaryNuget = "$cachedNuget.part"
  if (Test-Path -LiteralPath $temporaryNuget) { Remove-Item -LiteralPath $temporaryNuget -Force }
  $curlExecutable = Join-Path ([string]$env:SystemRoot) "System32\curl.exe"
  if (-not (Test-Path -LiteralPath $curlExecutable -PathType Leaf)) {
    throw "Windows curl.exe is required to download the checksum-pinned NuGet runtime"
  }
  $downloadUrl = "https://dist.nuget.org/win-x86-commandline/v$nugetVersion/nuget.exe"
  & $curlExecutable --proto "=https" --tlsv1.2 --location --fail --retry 2 --output $temporaryNuget $downloadUrl
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath $temporaryNuget) { Remove-Item -LiteralPath $temporaryNuget -Force }
    throw "NuGet download failed with curl exit code $LASTEXITCODE"
  }
  if ((Get-Sha256 $temporaryNuget) -ne $nugetHash) {
    Remove-Item -LiteralPath $temporaryNuget -Force
    throw "Downloaded NuGet executable checksum does not match the pinned release"
  }
  Move-Item -LiteralPath $temporaryNuget -Destination $cachedNuget -Force
}

$targetVendor = Join-Path $projectRoot "downloads\squirrel-vendor"
New-Item -ItemType Directory -Force -Path $targetVendor | Out-Null
Copy-Item -Path (Join-Path $sourceVendor "*") -Destination $targetVendor -Recurse -Force
Copy-Item -LiteralPath $cachedNuget -Destination (Join-Path $targetVendor "nuget.exe") -Force
Write-Host "Squirrel vendor cache is ready with checksum-pinned NuGet $nugetVersion"
