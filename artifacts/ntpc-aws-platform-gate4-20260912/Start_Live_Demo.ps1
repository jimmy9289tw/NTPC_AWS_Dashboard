$ErrorActionPreference = 'Stop'
$demoRoot = $PSScriptRoot
$demoServer = Join-Path $demoRoot 'preview_roa.py'
$demoPython = 'C:\Users\jimmy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (-not (Test-Path -LiteralPath $demoPython)) { $demoPython = (Get-Command python -ErrorAction Stop).Source }
$demoRunning = $false
try { $demoHealth = Invoke-RestMethod 'http://127.0.0.1:8893/api/health' -TimeoutSec 2; $demoRunning = $demoHealth.mode -eq 'LOCAL_DEMO' } catch {}
if (-not $demoRunning) {
    if (Get-NetTCPConnection -LocalPort 8893 -State Listen -ErrorAction SilentlyContinue) { throw '8893 port is in use by another application. Please close that application first.' }
    $demoProcess = Start-Process -FilePath $demoPython -ArgumentList @('-X', 'utf8', "`"$demoServer`"") -WorkingDirectory $demoRoot -WindowStyle Hidden -PassThru
    for ($demoTry = 0; $demoTry -lt 20; $demoTry++) {
        Start-Sleep -Milliseconds 300
        try { $demoHealth = Invoke-RestMethod 'http://127.0.0.1:8893/api/health' -TimeoutSec 1; if ($demoHealth.mode -eq 'LOCAL_DEMO') { $demoRunning = $true; break } } catch {}
    }
    if (-not $demoRunning) { throw 'Local demo did not start. Check preview_roa.py and live-bootstrap.json.' }
}
Start-Process 'http://127.0.0.1:8893/'
Write-Output 'Local demo: http://127.0.0.1:8893/ ; Internal: http://127.0.0.1:8893/internal/?view=policy'
