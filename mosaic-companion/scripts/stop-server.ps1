$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $listener) {
  Write-Output 'No process is listening on port 8787.'
  exit 0
}

$process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
if ($process.ProcessName -ne 'node') {
  throw "Port 8787 belongs to $($process.ProcessName), not Node. It was not stopped."
}

Stop-Process -Id $process.Id -Force
Write-Output "Stopped Node process $($process.Id) that was listening on port 8787."
