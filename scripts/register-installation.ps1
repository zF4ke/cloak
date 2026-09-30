#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Target, [Parameter(Mandatory)][string]$Version)
$ErrorActionPreference = 'Stop'
$expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'cloak\app'))
if ([IO.Path]::GetFullPath($Target) -ine $expected) { throw 'Unexpected installation folder.' }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version.' }
$start = Join-Path ([Environment]::GetFolderPath('Programs')) 'Cloak'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Cloak'
$values = @{ DisplayName='Cloak'; DisplayVersion=$Version; Publisher='zF4ke'; InstallLocation=$expected; DisplayIcon=(Join-Path $expected 'Cloak.exe'); UninstallString=('"' + (Join-Path $expected 'Uninstall.exe') + '"') }
$keyExisted = Test-Path -LiteralPath $key
$previous = if ($keyExisted) { Get-ItemProperty -LiteralPath $key } else { $null }
$pathBefore = (Get-Item -LiteralPath 'HKCU:\Environment').GetValue('Path','','DoNotExpandEnvironmentNames')
$pathKind = try { (Get-Item -LiteralPath 'HKCU:\Environment').GetValueKind('Path').ToString() } catch { 'ExpandString' }
$links = @((Join-Path $start 'Cloak.lnk'), (Join-Path $start 'Uninstall Cloak.lnk'))
$originalLinks = @{}
foreach ($link in $links) { if (Test-Path -LiteralPath $link) { $originalLinks[$link] = [IO.File]::ReadAllBytes($link) } }
try {
  New-Item -ItemType Directory -Path $start -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  for ($i=0; $i -lt $links.Count; $i++) {
    $shortcut = $shell.CreateShortcut($links[$i])
    $shortcut.TargetPath = Join-Path $expected $(if ($i -eq 0) { 'Cloak.exe' } else { 'Uninstall.exe' })
    $shortcut.WorkingDirectory = $expected
    $shortcut.IconLocation = (Join-Path $expected 'Cloak.exe') + ',0'
    $shortcut.Save()
  }
  New-Item -Path $key -Force | Out-Null
  foreach ($name in $values.Keys) { New-ItemProperty -LiteralPath $key -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null }
  & (Join-Path $PSScriptRoot 'register-cli.ps1') -Target $expected
} catch {
  $failure = $_
  foreach ($link in $links) {
    if ($originalLinks.ContainsKey($link)) { [IO.File]::WriteAllBytes($link,$originalLinks[$link]) }
    elseif (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force }
  }
  if ($keyExisted) {
    foreach ($name in $values.Keys) {
      if ($previous.PSObject.Properties.Name -contains $name) { Set-ItemProperty -LiteralPath $key -Name $name -Value $previous.$name }
      else { Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue }
    }
  } elseif (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Force }
  Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name Path -Value $pathBefore -Type $pathKind
  throw $failure
}
