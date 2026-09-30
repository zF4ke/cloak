#Requires -Version 5.1
[CmdletBinding()]
param([string]$Action, [string]$StateDir = (Join-Path $env:LOCALAPPDATA 'cloak'), [string]$Target)
$ErrorActionPreference = 'Stop'
if ($Action -eq 'status') {
  $procs = @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe' OR Name='wscript.exe'" | Where-Object { $_.CommandLine -match 'cloakd\.ps1|cloak-daemon\.vbs' })
  $log = Join-Path $StateDir 'cloakd.log'
  $legacy = Join-Path $StateDir 'state.json'
  $entries = @()
  if (Test-Path -LiteralPath $legacy) { $entries = @(Get-Content -LiteralPath $legacy -Raw | ConvertFrom-Json | Where-Object { $_.path }) }
  $lines = @()
  if (Test-Path -LiteralPath $log) { $lines = @(Get-Content -LiteralPath $log -Tail 30) }
  [pscustomobject]@{ daemon = [bool]$procs.Count; installed = (Test-Path -LiteralPath (Join-Path ([Environment]::GetFolderPath('Startup')) 'cloak-daemon.vbs')); oneDrive = [bool](Get-Process OneDrive -ErrorAction SilentlyContinue); log = $lines; legacy = $entries } | ConvertTo-Json -Depth 5 -Compress
  return
}
if ($Action -eq 'install') {
  # Use the UI's saved configuration without changing the repository template.
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  foreach ($name in 'cloak.ps1','cloakd.ps1','install.ps1','probe.ps1') {
    $from = Join-Path $PSScriptRoot $name
    $to = Join-Path $StateDir $name
    if ([IO.Path]::GetFullPath($from) -ne [IO.Path]::GetFullPath($to)) { Copy-Item -LiteralPath $from -Destination $to -Force }
  }
  $cli = Join-Path $PSScriptRoot 'dist\cli.cjs'
  if (Test-Path -LiteralPath $cli) {
    New-Item -ItemType Directory -Force -Path (Join-Path $StateDir 'dist') | Out-Null
    Copy-Item -LiteralPath $cli -Destination (Join-Path $StateDir 'dist\cli.cjs') -Force
  }
  & (Join-Path $StateDir 'install.ps1') -Yes
} elseif ($Action -eq 'uninstall') {
  & (Join-Path $PSScriptRoot 'install.ps1') -Uninstall
} elseif ($Action -in 'start','stop','probe','restore-all','on','off') {
  & (Join-Path $PSScriptRoot 'cloak.ps1') -Command $Action -Arg $Target
} else { throw 'Unknown action.' }
