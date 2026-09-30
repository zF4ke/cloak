#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Target)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'cloak\app'))
if ([IO.Path]::GetFullPath($Target) -ine $expected) { throw 'Unexpected installation folder. Nothing was removed.' }
if (Get-Process Cloak -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq (Join-Path $expected 'Cloak.exe') }) { throw 'Quit Cloak from its tray menu before uninstalling.' }
& (Join-Path $PSScriptRoot 'register-cli.ps1') -Target $expected -Remove
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
foreach ($name in 'Cloak','cloak') {
  $value = (Get-ItemProperty -LiteralPath $run -Name $name -ErrorAction SilentlyContinue).$name
  if ($value -and $value.Contains($expected)) { Remove-ItemProperty -LiteralPath $run -Name $name }
}
$protection = Join-Path $env:LOCALAPPDATA 'cloak\install.ps1'
if (Test-Path -LiteralPath $protection) { & $protection -Uninstall }
