param(
    [string]$PackageRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
)

$manifestPath = Join-Path $PackageRoot 'FILE_MANIFEST_SHA256.csv'
$rows = Get-ChildItem -LiteralPath $PackageRoot -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath } |
    ForEach-Object {
        [pscustomobject]@{
            relative_path = $_.FullName.Substring($PackageRoot.Length + 1).Replace('\', '/')
            size_bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } |
    Sort-Object relative_path

$lines = @('relative_path,size_bytes,sha256')
$lines += $rows | ForEach-Object { '{0},{1},{2}' -f $_.relative_path, $_.size_bytes, $_.sha256 }
$lines | Set-Content -LiteralPath $manifestPath -Encoding utf8BOM

Write-Output ("WROTE={0} ROWS={1}" -f $manifestPath, $rows.Count)
