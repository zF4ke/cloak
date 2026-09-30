#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Encoded)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Encoded)) | ConvertFrom-Json
$shell = New-Object -ComObject WScript.Shell
if ($request.action -eq 'read') {
  $shortcut = $shell.CreateShortcut([string]$request.path)
  @{ target = $shortcut.TargetPath; arguments = $shortcut.Arguments } | ConvertTo-Json -Compress
} elseif ($request.action -eq 'create') {
  # Generate bytes outside OneDrive, then the core publishes them without replacing a file.
  $temporary = Join-Path ([IO.Path]::GetTempPath()) (([guid]::NewGuid().ToString()) + '.lnk')
  try {
    $shortcut = $shell.CreateShortcut($temporary)
    $shortcut.TargetPath = [string]$request.target
    $shortcut.WorkingDirectory = [string]$request.target
    $shortcut.Save()
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($temporary))
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
  }
} else { throw 'Unknown shortcut action.' }
