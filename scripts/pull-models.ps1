$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$env:OLLAMA_MODELS = Join-Path $projectRoot 'models\ollama'
$ollama = Join-Path $projectRoot 'runtime\ollama\ollama.exe'
$log = Join-Path $projectRoot 'downloads\model-pull.log'
$models = @('qwen3:4b','qwen3:8b','deepseek-r1:7b','qwen3-vl:4b')
"[$(Get-Date -Format s)] 模型下载队列启动" | Set-Content -Path $log -Encoding utf8
foreach ($model in $models) {
  $installed = & $ollama list 2>$null | Select-String -SimpleMatch $model
  if ($installed) { "[$(Get-Date -Format s)] 已存在，跳过 $model" | Add-Content $log; continue }
  "[$(Get-Date -Format s)] 开始下载 $model" | Add-Content $log
  & $ollama pull $model *>> $log
  "[$(Get-Date -Format s)] $model 结束，退出码 $LASTEXITCODE" | Add-Content $log
}
"[$(Get-Date -Format s)] 全部模型队列结束" | Add-Content $log
