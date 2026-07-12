#Requires -Version 5.1
<#
  cloak installer. Idempotent: run again any time to update or repair.

    pwsh -File install.ps1              install (asks for your folders)
    pwsh -File install.ps1 -Yes         install without prompts (keeps existing config)
    pwsh -File install.ps1 -Status      show what's installed / running
    pwsh -File install.ps1 -Uninstall   stop daemon, remove the task
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$Status, [switch]$Yes)

$ErrorActionPreference = 'Stop'
$TaskName = 'cloakd'
$Repo     = $PSScriptRoot
$Daemon   = Join-Path $Repo 'cloakd.ps1'
$Config   = Join-Path $Repo 'config.jsonc'

function Head($t) { Write-Host "`n$t" -ForegroundColor Magenta }
function Ok($t)   { Write-Host "  + $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  x $t" -ForegroundColor Red }
function Info($t) { Write-Host "    $t" -ForegroundColor DarkGray }
function Ask($q, $default) {
  Write-Host "  ? $q " -ForegroundColor Cyan -NoNewline
  Write-Host "[$default]" -ForegroundColor DarkGray -NoNewline
  $a = Read-Host ' '
  if ([string]::IsNullOrWhiteSpace($a)) { $default } else { $a.Trim().Trim('"') }
}

function Get-Pwsh {
  $c = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  (Get-Command powershell).Source
}
function Daemon-Pids {
  @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*cloakd.ps1*' } | Select-Object -ExpandProperty ProcessId)
}
function Read-Config {
  if (-not (Test-Path $Config)) { return $null }
  $jsonc = (Get-Content $Config -Raw) -replace '(?m)^\s*//.*$','' -replace '(?s)/\*.*?\*/',''
  try { $jsonc | ConvertFrom-Json } catch { $null }
}

$BinDir = Join-Path $env:LOCALAPPDATA 'cloak\bin'
$Shim   = Join-Path $BinDir 'cloak.cmd'
function Add-ToPath {
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  # A tiny .cmd shim so `cloak <args>` works from any shell. Absolute paths so
  # it doesn't depend on pwsh being on PATH or the repo location.
  "@echo off`r`n`"$(Get-Pwsh)`" -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $Repo 'cloak.ps1')`" %*" |
    Set-Content -Path $Shim -Encoding ASCII
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  if (($userPath -split ';') -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $BinDir), 'User')
    Ok "added 'cloak' to PATH (open a new terminal to use it)"
  } else { Ok "'cloak' command ready" }
}
function Remove-FromPath {
  if (Test-Path $Shim) { Remove-Item $Shim -Force }
  $userPath = [Environment]::GetEnvironmentVariable('Path','User')
  $kept = ($userPath -split ';' | Where-Object { $_ -and $_ -ne $BinDir }) -join ';'
  if ($kept -ne $userPath) { [Environment]::SetEnvironmentVariable('Path', $kept, 'User'); Ok "removed 'cloak' from PATH" }
}

Write-Host ""
Write-Host "cloak" -ForegroundColor Magenta

if ($Status) {
  Head "status"
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Ok "scheduled task registered (state: $($task.State))" } else { Warn "no scheduled task registered" }
  $pids = Daemon-Pids
  if ($pids.Count) { Ok "daemon running (PID $($pids -join ', '))" } else { Warn "daemon not running" }
  if (Get-Process OneDrive -ErrorAction SilentlyContinue) { Ok "OneDrive running (not paused)" } else { Warn "OneDrive stopped (paused by cloak, or not started)" }
  $log = Join-Path $env:LOCALAPPDATA 'cloak\cloakd.log'
  if (Test-Path $log) { Info "recent log:"; Get-Content $log -Tail 5 | ForEach-Object { Info $_ } }
  Write-Host ""
  return
}

if ($Uninstall) {
  Head "uninstall"
  foreach ($id in Daemon-Pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Ok "stopped daemon PID $id" }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok "removed scheduled task"
  } else { Info "no scheduled task to remove" }
  Remove-FromPath
  if (-not (Get-Process OneDrive -ErrorAction SilentlyContinue)) {
    $exe = @("$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe","C:\Program Files\Microsoft OneDrive\OneDrive.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($exe) { Start-Process $exe -ArgumentList '/background'; Ok "resumed OneDrive" }
  }
  Write-Host ""
  Write-Host "done. your folders were never touched." -ForegroundColor Cyan
  Write-Host ""
  return
}

# ---------------- configure ----------------
$existing = Read-Config
if (-not $Yes) {
  Head "setup"
  $defaultRoot = if ($existing -and $existing.watchRoots) { $existing.watchRoots[0] }
                 elseif ($env:OneDrive) { Join-Path $env:OneDrive 'Projects' }
                 else { "$env:USERPROFILE\Projects" }
  $root = Ask "projects folder to watch" $defaultRoot
  while (-not (Test-Path $root)) {
    Bad "not found: $root"
    $root = Ask "projects folder to watch" $defaultRoot
  }
  $defaultScratch = if ($existing -and $existing.scratchDir) { $existing.scratchDir } else { Join-Path $env:LOCALAPPDATA 'cloak\scratch' }
  $scratch = Ask "local folder for junction mode (cloak.ps1 on/off)" $defaultScratch

  $rootJson    = $root -replace '\\','\\'
  $scratchJson = $scratch -replace '\\','\\'
  @"
{
  // folders to watch for work activity. any change here pauses OneDrive;
  // when everything is quiet for idleSeconds, OneDrive resumes and syncs.
  "watchRoots": [
    "$rootJson"
  ],

  // activity in these directory names is ignored (build output, VCS internals,
  // and runtime dirs of apps left running inside a watched folder)
  "ignoreDirs": [".git", "node_modules", "build", "target", "dist", "out", "__pycache__", "logs", ".gradle", ".next"],

  // activity on files matching these globs is ignored
  "ignoreFiles": ["*.log", "*.tmp", "*.temp", "*.lock"],

  // quiet time (seconds) before OneDrive resumes
  "idleSeconds": 90,

  // never stay paused longer than this, even under constant activity
  "maxPauseMinutes": 45,

  // daemon check interval (seconds)
  "pollSeconds": 5,

  // where cloak.ps1 (junction mode) keeps a folder's real bytes while cloaked
  "scratchDir": "$scratchJson"
}
"@ | Set-Content -Path $Config -Encoding UTF8
  Ok "wrote config.jsonc"
}

# ---------------- checks ----------------
Head "checks"
if (-not (Test-Path $Daemon)) { Bad "cloakd.ps1 not found next to installer"; exit 2 }
$cfg = Read-Config
if (-not $cfg) { Bad "config.jsonc missing or invalid"; exit 2 }
$roots = @($cfg.watchRoots | Where-Object { Test-Path $_ })
if (-not $roots.Count) { Bad "none of the watchRoots exist"; exit 2 }
Ok "watching: $($roots -join ', ')"

if ($env:OneDrive -and (Test-Path $env:OneDrive)) { Ok "OneDrive root: $env:OneDrive" }
else { Warn "no OneDrive root detected; cloak will run but has nothing to protect" }

$fodHit = $null
foreach ($r in $roots) {
  $fodHit = Get-ChildItem $r -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { ($_.Attributes -band 0x400000) -or ($_.Attributes -band 0x40000) } |
    Select-Object -First 1
  if ($fodHit) { break }
}
if ($fodHit) {
  Warn "Files-On-Demand placeholders found (e.g. $($fodHit.Name))"
  Warn "fix in OneDrive settings: 'Download all files', or right-click the folder > 'Always keep on this device'"
} else {
  Ok "no cloud placeholders under watched folders"
}

# ---------------- install ----------------
Head "install"
foreach ($id in Daemon-Pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Info "stopped old daemon PID $id" }

$pwshExe  = Get-Pwsh
$action   = New-ScheduledTaskAction -Execute $pwshExe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Daemon`""
$trigger  = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Ok "updated scheduled task (runs at logon)"
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'cloak: pause OneDrive during active work in project folders' | Out-Null
  Ok "registered scheduled task (runs at logon)"
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
if ((Daemon-Pids).Count) { Ok "daemon running" }
else { Bad "daemon did not start. run it manually to see why:  pwsh -File `"$Daemon`"" }

Add-ToPath

Write-Host ""
Write-Host "installed. work normally; OneDrive pauses while you work and syncs when you go idle." -ForegroundColor Cyan
Write-Host "manage it with:  cloak status  |  cloak stop  |  cloak uninstall" -ForegroundColor DarkGray
Write-Host ""
