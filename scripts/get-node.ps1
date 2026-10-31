# Downloads portable Node.js into tools\node when Node.js is not installed
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null
$v = (Invoke-RestMethod 'https://nodejs.org/dist/index.json' | Where-Object { $_.lts } | Select-Object -First 1).version
$zip = Join-Path $env:TEMP "node-$v-win-x64.zip"
Write-Host "Downloading Node.js $v ..."
Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath $tools -Force
$dst = Join-Path $tools 'node'
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Move-Item (Join-Path $tools "node-$v-win-x64") $dst
Remove-Item $zip -Force
Write-Host 'Node.js ready.'
