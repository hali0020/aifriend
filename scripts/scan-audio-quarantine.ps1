$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$root = Join-Path $projectRoot 'audio'
$quarantine = Join-Path $root 'quarantine'
$reports = Join-Path $root 'reports'
$approvedExtensions = @('.wav', '.flac', '.mp3', '.m4a', '.ogg', '.opus', '.aac')
$sidecarExtensions = @('.json', '.jpg', '.jpeg', '.png', '.webp')

function Test-AudioMagic([System.IO.FileInfo]$file) {
  if ($approvedExtensions -notcontains $file.Extension.ToLowerInvariant()) { return $null }
  $stream = [System.IO.File]::OpenRead($file.FullName)
  try {
    $bytes = New-Object byte[] 12
    $read = $stream.Read($bytes, 0, $bytes.Length)
    if ($read -lt 4) { return $false }
    $ascii = [System.Text.Encoding]::ASCII.GetString($bytes, 0, $read)
    switch ($file.Extension.ToLowerInvariant()) {
      '.wav'  { return $ascii.StartsWith('RIFF') -and $ascii.Substring(8, 4) -eq 'WAVE' }
      '.flac' { return $ascii.StartsWith('fLaC') }
      '.ogg'  { return $ascii.StartsWith('OggS') }
      '.opus' { return $ascii.StartsWith('OggS') }
      '.m4a'  { return $read -ge 8 -and $ascii.Substring(4, 4) -eq 'ftyp' }
      '.mp3'  { return $ascii.StartsWith('ID3') -or ($bytes[0] -eq 0xff -and (($bytes[1] -band 0xe0) -eq 0xe0)) }
      '.aac'  { return $bytes[0] -eq 0xff -and (($bytes[1] -band 0xf0) -eq 0xf0) }
    }
  } finally { $stream.Dispose() }
}

New-Item -ItemType Directory -Force -Path $quarantine, (Join-Path $root 'approved'), $reports | Out-Null
$files = Get-ChildItem -LiteralPath $quarantine -File -Recurse
$report = @(foreach ($file in $files) {
  $extensionAllowed = $approvedExtensions -contains $file.Extension.ToLowerInvariant()
  $sidecarAllowed = $sidecarExtensions -contains $file.Extension.ToLowerInvariant()
  $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  [pscustomobject]@{
    File = $file.FullName
    Bytes = $file.Length
    ExtensionAllowed = $extensionAllowed
    SidecarAllowed = $sidecarAllowed
    MagicValid = Test-AudioMagic $file
    SHA256 = $hash.Hash
    SignatureStatus = $signature.Status.ToString()
    LastWriteTime = $file.LastWriteTimeUtc.ToString('o')
  }
})

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$jsonPath = Join-Path $reports "scan-$stamp.json"
if ($report.Count) { $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $jsonPath -Encoding utf8 }
else { '[]' | Set-Content -LiteralPath $jsonPath -Encoding utf8 }

$defender = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe'
if ($files.Count -eq 0) {
  $defenderExit = 'SkippedEmpty'
} elseif (Test-Path -LiteralPath $defender) {
  & $defender -Scan -ScanType 3 -File $quarantine
  $defenderExit = $LASTEXITCODE
} else {
  $defenderExit = 'Unavailable'
}

[pscustomobject]@{
  FilesChecked = $files.Count
  MetadataReport = $jsonPath
  DefenderExitCode = $defenderExit
  ReadyToApprove = (($report | Where-Object { -not $_.ExtensionAllowed -and -not $_.SidecarAllowed }).Count -eq 0 -and ($report | Where-Object { $_.ExtensionAllowed -and $_.MagicValid -ne $true }).Count -eq 0 -and $defenderExit -eq 0)
}
