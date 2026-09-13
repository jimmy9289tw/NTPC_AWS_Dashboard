$ErrorActionPreference = 'Stop'
$demoScript = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'preview_roa.py'))
$demoConnections = Get-NetTCPConnection -LocalPort 8893 -State Listen -ErrorAction SilentlyContinue
foreach ($demoConnection in $demoConnections) {
    $demoInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($demoConnection.OwningProcess)"
    if ($demoInfo.CommandLine -and $demoInfo.CommandLine.Contains($demoScript) -and $demoInfo.Name -match '^python(?:w)?\.exe$') {
        Stop-Process -Id $demoInfo.ProcessId
        Write-Output 'Stopped the local demo server.'
    } else { Write-Warning 'The process is not this demo server; it was not stopped.' }
}
