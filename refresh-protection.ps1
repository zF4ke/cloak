#Requires -Version 5.1
param([Parameter(Mandatory)][string]$StateDir)
$ErrorActionPreference = 'Stop'
$directory = [IO.Path]::GetFullPath($StateDir).TrimEnd('\')
if ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Protection folder is redirected.' }
$deployed = Join-Path $directory 'cloakd.ps1'
$source = Join-Path $PSScriptRoot 'cloakd.ps1'
if (-not (Test-Path -LiteralPath $deployed -PathType Leaf)) { return }
if ((Get-Item -LiteralPath $deployed -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Protection script is redirected.' }
$before = [IO.File]::ReadAllBytes($deployed)
$after = [IO.File]::ReadAllBytes($source)
if ([Convert]::ToBase64String($before) -eq [Convert]::ToBase64String($after)) { return }
$parseErrors = $null; $tokens = $null
[Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count) { throw 'Updated protection script is invalid.' }
$pattern = '(?i)-File\s+"?' + [Regex]::Escape($deployed) + '"?(?:\s|$)'
$session = (Get-Process -Id $PID).SessionId
$holders = @()
foreach ($candidate in @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.SessionId -eq $session -and $_.CommandLine -match $pattern })) {
  try {
    $process = [Diagnostics.Process]::GetProcessById([int]$candidate.ProcessId)
    $pinned = $process.Handle
    # CIM truncates its creation timestamp to microseconds. The pinned handle
    # prevents PID reuse after this check; accept only that sub-microsecond loss.
    if ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - $candidate.CreationDate.ToUniversalTime().Ticks) -ge 10) { $process.Dispose(); continue }
    $holders += $process
  } catch [ArgumentException] {}
}
$temporary = Join-Path $directory ('cloakd-' + [Guid]::NewGuid().ToString('N') + '.tmp')
function Restart-Protection {
  if ($holders.Count) {
    $config = Join-Path $directory 'config.jsonc'
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $deployed + '"'),'-ConfigPath',('"' + $config + '"')) -WindowStyle Hidden | Out-Null
  }
}
try {
  [IO.File]::WriteAllBytes($temporary, $after)
  foreach ($process in $holders) { if (-not $process.HasExited) { $process.Kill(); if (-not $process.WaitForExit(5000)) { throw 'Protection did not stop for its update.' } } }
  [IO.File]::Replace($temporary, $deployed, [System.Management.Automation.Language.NullString]::Value)
  Restart-Protection
} catch {
  $failure = $_
  [IO.File]::WriteAllBytes($deployed, $before)
  try { Restart-Protection } catch {}
  throw $failure
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  foreach ($process in $holders) { $process.Dispose() }
}
