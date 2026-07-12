#Requires -Version 5.1
<#
  cloakd - cloak's background daemon (pause mode).

  Watches configurable project roots. On file activity: gracefully shuts down
  OneDrive so it can't dehydrate, lock, or serve stale reads while tools work.
  When every root has been idle for idleSeconds: relaunches OneDrive, which
  syncs everything that changed. maxPauseMinutes guarantees backup is never
  indefinitely stale, and the daemon always resumes OneDrive on exit.

  Run:      pwsh -File cloakd.ps1            (foreground, colored log)
  Install:  see install.ps1 (registers a logon Scheduled Task)
#>
[CmdletBinding()]
param([string]$ConfigPath = (Join-Path $PSScriptRoot 'config.jsonc'))

$ErrorActionPreference = 'Stop'

$LogFile = Join-Path $env:LOCALAPPDATA 'cloak\cloakd.log'
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
function Log($t, $c = 'Gray') {
  $line = "[$(Get-Date -Format HH:mm:ss)] $t"
  Write-Host $line -ForegroundColor $c
  Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

# ---------- config ----------
if (-not (Test-Path $ConfigPath)) { Log "config not found: $ConfigPath" Red; exit 2 }
$jsonc = (Get-Content $ConfigPath -Raw) -replace '(?m)^\s*//.*$','' -replace '(?s)/\*.*?\*/',''
$cfg = $jsonc | ConvertFrom-Json
$watchRoots  = @($cfg.watchRoots | Where-Object { Test-Path $_ })
$ignoreDirs  = @($cfg.ignoreDirs)
$ignoreFiles = @($cfg.ignoreFiles)
$idleSeconds = [int]$cfg.idleSeconds
$maxPause    = [TimeSpan]::FromMinutes([double]$cfg.maxPauseMinutes)
$poll        = [int]$cfg.pollSeconds
if (-not $watchRoots.Count) { Log "no existing watchRoots in config" Red; exit 2 }

$oneDriveExe = @("$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe",
                 "C:\Program Files\Microsoft OneDrive\OneDrive.exe") |
               Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $oneDriveExe) { Log "OneDrive.exe not found" Red; exit 2 }

# ---------- OneDrive control ----------
function OneDrive-Running { [bool](Get-Process OneDrive -ErrorAction SilentlyContinue) }

function Pause-OneDrive {
  # Terminate the process directly instead of `OneDrive.exe /shutdown`. /shutdown
  # pops a "Could not shut down OneDrive" dialog whenever it can't exit cleanly;
  # killing the process is silent, instant, and releases its file handles the
  # same way. OneDrive resumes any in-flight upload on next launch.
  $procs = @(Get-Process OneDrive -ErrorAction SilentlyContinue)
  if (-not $procs.Count) { return }
  Log "activity detected -> pausing OneDrive" Yellow
  foreach ($p in $procs) { try { $p.Kill() } catch {} }
}

function Resume-OneDrive {
  if (OneDrive-Running) { return }
  Log "idle -> resuming OneDrive (sync will catch up)" Green
  Start-Process $oneDriveExe -ArgumentList '/background'
}

# ---------- activity watchers ----------
# Shared state: event actions run in their own dynamic module, so a plain
# $script: variable is NOT visible from them - use a synchronized hashtable
# handed in via MessageData.
$shared = [hashtable]::Synchronized(@{ last = [DateTime]::MinValue })
$ignoreRegex = if ($ignoreDirs.Count) {
  '\\(' + (($ignoreDirs | ForEach-Object { [regex]::Escape($_) }) -join '|') + ')\\'
} else { $null }

$watchers = @()
$handlers = @()
foreach ($root in $watchRoots) {
  $w = New-Object System.IO.FileSystemWatcher $root
  $w.IncludeSubdirectories = $true
  $w.NotifyFilter = [IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName -bor [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::Size
  $action = {
    $data = $Event.MessageData
    $p = $Event.SourceEventArgs.FullPath
    if ($data.rx -and $p -match $data.rx) { return }         # ignored directory
    if ($data.files) {
      $leaf = [System.IO.Path]::GetFileName($p)
      foreach ($g in $data.files) { if ($leaf -like $g) { return } }  # ignored filename
    }
    $data.state.last = Get-Date
  }
  $msg = @{ rx = $ignoreRegex; files = $ignoreFiles; state = $shared }
  foreach ($ev in 'Changed','Created','Deleted','Renamed') {
    $handlers += Register-ObjectEvent -InputObject $w -EventName $ev -Action $action -MessageData $msg
  }
  $w.EnableRaisingEvents = $true
  $watchers += $w
  Log "watching $root" Cyan
}

Log ("cloakd up - idle={0}s - maxPause={1}m - OneDrive: {2}" -f $idleSeconds, $maxPause.TotalMinutes, $(if (OneDrive-Running) {'running'} else {'stopped'})) Magenta

# ---------- main loop ----------
$pausedAt = $null            # when we shut OneDrive down (null = not paused by us)
try {
  while ($true) {
    Start-Sleep -Seconds $poll
    try {
      $now = Get-Date
      $idleFor = $now - $shared.last
      $running = OneDrive-Running

      if ($running) {
        # OneDrive is up. Pause on fresh activity.
        if ($shared.last -ne [DateTime]::MinValue -and $idleFor.TotalSeconds -lt $idleSeconds) {
          Pause-OneDrive
          $pausedAt = $now
        }
      } else {
        # OneDrive is down (by us or otherwise).
        if ($null -eq $pausedAt) { $pausedAt = $now }  # adopt an externally-stopped OneDrive so maxPause still applies
        $pausedLong = ($now - $pausedAt) -ge $maxPause
        $quiet = $idleFor.TotalSeconds -ge $idleSeconds
        if ($quiet -or $pausedLong) {
          if ($pausedLong -and -not $quiet) { Log "maxPause reached under continuous activity -> brief resume so backup can't go stale" Yellow }
          Resume-OneDrive
          $pausedAt = $null
          if ($pausedLong -and -not $quiet) {
            # give it a window to actually sync before activity re-pauses it
            Start-Sleep -Seconds 60
          }
        }
      }
    } catch {
      # One bad iteration must never kill the daemon (it would strand OneDrive).
      Log "loop error: $($_.Exception.Message)" Red
    }
  }
}
finally {
  # Never exit leaving OneDrive stopped.
  foreach ($h in $handlers) { Unregister-Event -SourceIdentifier $h.Name -ErrorAction SilentlyContinue }
  foreach ($w in $watchers) { $w.EnableRaisingEvents = $false; $w.Dispose() }
  if (-not (OneDrive-Running)) {
    Log "daemon exiting -> resuming OneDrive (fail-safe)" Green
    Start-Process $oneDriveExe -ArgumentList '/background'
  }
  Log "cloakd stopped" Magenta
}
