#Requires -Version 5.1
<#
  cloak — installer
  Registers cloakd as a logon Scheduled Task, starts it now, and sanity-checks
  your OneDrive setup. Idempotent: run it again any time to update/repair.

    pwsh -File install.ps1              install / repair
    pwsh -File install.ps1 -Uninstall   stop daemon, remove the task
    pwsh -File install.ps1 -Status      show what's installed / running
#>
[CmdletBinding()]
param([switch]$Uninstall, [switch]$Status)

$ErrorActionPreference = 'Stop'
$TaskName  = 'cloakd'
$Repo      = $PSScriptRoot
$Daemon    = Join-Path $Repo 'cloakd.ps1'
$Config    = Join-Path $Repo 'config.jsonc'

function Head($t) { Write-Host "`n  $t" -ForegroundColor Magenta }
function Ok($t)   { Write-Host "  ✓ $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  ✗ $t" -ForegroundColor Red }
function Info($t) { Write-Host "  · $t" -ForegroundColor DarkGray }

function Get-Pwsh {
  $c = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  (Get-Command powershell).Source
}
function Daemon-Pids {
  @(Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*cloakd.ps1*' } | Select-Object -ExpandProperty ProcessId)
}

Write-Host ""
Write-Host "  ┌───────────────────────────────┐" -ForegroundColor Magenta
Write-Host "  │  🧥 cloak · installer          │" -ForegroundColor Magenta
Write-Host "  └───────────────────────────────┘" -ForegroundColor Magenta

if ($Status) {
  Head "Status"
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($task) { Ok "Scheduled task '$TaskName' registered (state: $($task.State))" } else { Warn "No scheduled task registered." }
  $pids = Daemon-Pids
  if ($pids.Count) { Ok "Daemon running (PID $($pids -join ', '))" } else { Warn "Daemon not running." }
  if (Get-Process OneDrive -ErrorAction SilentlyContinue) { Ok "OneDrive running (not currently paused)" } else { Warn "OneDrive is stopped — paused by cloak, or not started." }
  $log = Join-Path $env:LOCALAPPDATA 'cloak\cloakd.log'
  if (Test-Path $log) { Info "recent log:"; Get-Content $log -Tail 5 | ForEach-Object { Info "  $_" } }
  Write-Host ""
  return
}

if ($Uninstall) {
  Head "Uninstall"
  foreach ($id in Daemon-Pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Ok "stopped daemon PID $id" }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Ok "removed scheduled task '$TaskName'"
  } else { Info "no scheduled task to remove" }
  if (-not (Get-Process OneDrive -ErrorAction SilentlyContinue)) {
    $exe = @("$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe","C:\Program Files\Microsoft OneDrive\OneDrive.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($exe) { Start-Process $exe -ArgumentList '/background'; Ok "resumed OneDrive (was paused)" }
  }
  Write-Host ""
  Write-Host "  cloak uninstalled. Your folders were never touched." -ForegroundColor Cyan
  Write-Host ""
  return
}

# ---------------- install ----------------
Head "Checks"
if (-not (Test-Path $Daemon)) { Bad "cloakd.ps1 not found next to installer"; exit 2 }
if (-not (Test-Path $Config)) { Bad "config.jsonc not found — create it (see README)"; exit 2 }
$jsonc = (Get-Content $Config -Raw) -replace '(?m)^\s*//.*$','' -replace '(?s)/\*.*?\*/',''
try { $cfg = $jsonc | ConvertFrom-Json } catch { Bad "config.jsonc is not valid JSON: $($_.Exception.Message)"; exit 2 }
$roots = @($cfg.watchRoots | Where-Object { Test-Path $_ })
if (-not $roots.Count) { Bad "None of the watchRoots in config.jsonc exist."; exit 2 }
Ok "config valid — watching $($roots.Count) root(s):"
$roots | ForEach-Object { Info "  $_" }

if (-not ($env:OneDrive -and (Test-Path $env:OneDrive))) { Warn "No OneDrive root detected — cloak will run but has nothing to protect." }
else { Ok "OneDrive root: $env:OneDrive" }

# Files-On-Demand advisory: placeholder files under the watched roots mean FoD
# is still dehydrating project files — that bug class is fixed in OneDrive
# settings, not by cloakd.
$fodHit = $null
foreach ($r in $roots) {
  $fodHit = Get-ChildItem $r -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { ($_.Attributes -band 0x400000) -or ($_.Attributes -band 0x40000) } |
    Select-Object -First 1
  if ($fodHit) { break }
}
if ($fodHit) {
  Warn "Files-On-Demand placeholders found (e.g. $($fodHit.FullName))."
  Warn "Recommended: OneDrive Settings → Sync and backup → Advanced → 'Download all files',"
  Warn "or right-click your project roots → 'Always keep on this device'."
} else {
  Ok "No cloud placeholders under watched roots (Files-On-Demand not dehydrating your projects)."
}

Head "Install"
foreach ($id in Daemon-Pids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; Info "stopped old daemon PID $id" }

$pwshExe = Get-Pwsh
$action  = New-ScheduledTaskAction -Execute $pwshExe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Daemon`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Ok "updated scheduled task '$TaskName' (runs at logon, auto-restarts)"
} else {
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'cloak: pause OneDrive during active work in project folders' | Out-Null
  Ok "registered scheduled task '$TaskName' (runs at logon, auto-restarts)"
}

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
$pids = Daemon-Pids
if ($pids.Count) { Ok "daemon running now (PID $($pids -join ', '))" }
else { Bad "daemon did not start — run manually to see why:  pwsh -File `"$Daemon`"" }

Write-Host ""
Write-Host "  cloak installed. Work normally — OneDrive pauses while you work" -ForegroundColor Cyan
Write-Host "  in your project folders and syncs the moment you go idle." -ForegroundColor Cyan
Write-Host "  status:     pwsh -File install.ps1 -Status" -ForegroundColor DarkGray
Write-Host "  uninstall:  pwsh -File install.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
