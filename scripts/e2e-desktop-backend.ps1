# Same isolated fixture as the Bash wrapper; no installed runtime is discovered.
$env:PYTHONUTF8 = '1'
& python (Join-Path $PSScriptRoot 'desktop-fixture/backend.py') @args
exit $LASTEXITCODE
