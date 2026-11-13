$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$demoPidFile = Join-Path (Get-Location) '.local/demo/application.pid'
if (Test-Path -LiteralPath $demoPidFile) {
  $demoPid = [int](Get-Content -LiteralPath $demoPidFile)
  $demoProcess = Get-Process -Id $demoPid -ErrorAction SilentlyContinue
  if ($demoProcess) {
    if ($demoProcess.ProcessName -ne 'node') { throw 'DEMO PID belongs to a different process.' }
    $demoPattern = '^\s*TCP\s+127\.0\.0\.1:3001\s+\S+\s+LISTENING\s+' + $demoPid + '\s*$'
    if (-not (netstat -ano -p tcp | Select-String $demoPattern)) { throw 'DEMO listener could not be verified.' }
    $demoHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 5
    if ($demoHealth.demoDatabase -ne 'istasyonos_demo') { throw 'Port 3001 is not the isolated DEMO service; process preserved.' }
    Stop-Process -Id $demoPid
  }
}
if (netstat -ano -p tcp | Select-String '^\s*TCP\s+\S+:3001\s+\S+\s+LISTENING') { throw 'Port 3001 is in use; existing process preserved.' }
$demoStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$demoNew = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'scripts/demo-server.mjs' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput ".local/demo/application-$demoStamp.out.log" -RedirectStandardError ".local/demo/application-$demoStamp.err.log" -PassThru
Set-Content -LiteralPath $demoPidFile $demoNew.Id
Write-Output "DEMO PID: $($demoNew.Id)"
