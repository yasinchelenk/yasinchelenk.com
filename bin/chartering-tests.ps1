# Runs the chartering engine tests in headless Edge and prints the result.
# Needs the local dev server:  php -S localhost:8000 -t public public/index.php
param([string]$Url = 'http://localhost:8000/assets/panel/chartering/tests/index.html', [switch]$All)

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Error 'Microsoft Edge not found'; exit 2 }

$profileDir = Join-Path $env:TEMP 'chartering-tests-edge'
$dom = & $edge --headless=new --disable-gpu --no-first-run "--user-data-dir=$profileDir" --virtual-time-budget=8000 --dump-dom $Url 2>$null | Out-String

$title = [regex]::Match($dom, '<title>(.*?)</title>').Groups[1].Value
Write-Output $title
$start = [Math]::Max(0, $dom.IndexOf('<div id="out">'))
$end = $dom.IndexOf('<script', $start)
$results = if ($end -gt $start) { $dom.Substring($start, $end - $start) } else { $dom.Substring($start) }
$pattern = if ($All) { '<li class="(?:pass|fail)">(.*?)</li>' } else { '<li class="fail">(.*?)</li>' }
foreach ($m in [regex]::Matches($results, $pattern)) {
    Write-Output ('  ' + ($m.Groups[1].Value -replace '<small>', '  — ' -replace '<[^>]+>', ''))
}
if ($title -notlike 'PASS*') { exit 1 }
