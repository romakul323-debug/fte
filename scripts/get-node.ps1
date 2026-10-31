# Downloads portable Node.js into tools\node when Node.js is not installed
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root 'tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

# Known-good LTS; try to find a newer 22.x LTS, but never fail because of the lookup
$v = 'v22.23.4'
try {
  $list = Invoke-RestMethod 'https://nodejs.org/dist/index.json' -UseBasicParsing
  $lts = @($list) | ForEach-Object { $_ } | Where-Object { $_.lts -and $_.version -like 'v22.*' } | Select-Object -First 1
  if ($lts -and ($lts.version -match '^v\d+\.\d+\.\d+$')) { $v = $lts.version }
} catch { }

$zip = Join-Path $env:TEMP "node-$v-win-x64.zip"
Write-Host "Downloading Node.js $v ..."
Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-win-x64.zip" -OutFile $zip -UseBasicParsing
Write-Host 'Unpacking ...'
Expand-Archive $zip -DestinationPath $tools -Force
$dst = Join-Path $tools 'node'
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Move-Item (Join-Path $tools "node-$v-win-x64") $dst
Remove-Item $zip -Force
Write-Host 'Node.js ready.'
