$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $root 'downloads\OllamaSetup.exe'
$runtime = Join-Path $root 'runtime\ollama'
$modelDir = Join-Path $root 'models\ollama'
$log = Join-Path $root 'downloads\model-install.log'

"[$(Get-Date -Format s)] 等待 Ollama 安装包下载完成" | Set-Content -Path $log -Encoding utf8
while (Get-Process curl -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 10 }

$file = Get-Item -LiteralPath $installer
if ($file.Length -lt 1GB) { throw "安装包不完整：$($file.Length) bytes" }
$signature = Get-AuthenticodeSignature -LiteralPath $installer
if ($signature.Status -ne 'Valid') { throw "安装包签名校验失败：$($signature.Status)" }

"[$(Get-Date -Format s)] 安装 Ollama 到 $runtime" | Add-Content -Path $log -Encoding utf8
$install = Start-Process -FilePath $installer -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',('/DIR="{0}"' -f $runtime) -Wait -PassThru
if ($install.ExitCode -ne 0) { throw "Ollama 安装失败：exit $($install.ExitCode)" }

$ollama = Join-Path $runtime 'ollama.exe'
if (-not (Test-Path -LiteralPath $ollama)) {
  $ollama = Get-ChildItem -LiteralPath $runtime -Filter ollama.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ollama) { throw '找不到 ollama.exe' }

$env:OLLAMA_MODELS = $modelDir
Start-Process -FilePath $ollama -ArgumentList 'serve' -WindowStyle Hidden
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-RestMethod 'http://localhost:11434/api/version' | Out-Null; break } catch { Start-Sleep -Seconds 2 }
}

$models = @('qwen3:4b','qwen3:8b','deepseek-r1:7b','qwen3-vl:4b')
foreach ($model in $models) {
  "[$(Get-Date -Format s)] 开始下载 $model" | Add-Content -Path $log -Encoding utf8
  & $ollama pull $model *>> $log
  if ($LASTEXITCODE -ne 0) { "[$(Get-Date -Format s)] 下载失败 $model" | Add-Content -Path $log -Encoding utf8 }
}
"[$(Get-Date -Format s)] Ollama 模型队列结束" | Add-Content -Path $log -Encoding utf8
