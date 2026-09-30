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
# Settling after a resume: OneDrive's own catch-up sync touches the watched
# folders (it IS the sync client), and pausing on that activity creates an
# infinite pause/resume loop where sync never finishes. A fixed timer can't
# work - sync duration depends on the backlog - so instead we watch the
# OneDrive process's actual I/O counters and only arm the pause-watcher once
# they go quiet (sync genuinely done). settleMaxMinutes is a safety cap.
$settleMax = [TimeSpan]::FromMinutes($(if ($null -ne $cfg.settleMaxMinutes) { [double]$cfg.settleMaxMinutes } else { 30 }))
if (-not $watchRoots.Count) { Log "no existing watchRoots in config" Red; exit 2 }

$oneDriveExe = @("$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe",
                 "C:\Program Files\Microsoft OneDrive\OneDrive.exe") |
               Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $oneDriveExe) { Log "OneDrive.exe not found" Red; exit 2 }

# ---------- OneDrive control ----------
function OneDrive-Running { [bool](Get-Process OneDrive -ErrorAction SilentlyContinue) }

function Cloud-AccessActive {
  foreach ($file in @(Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'cloak') -Filter 'cloud-access-*.json' -File -ErrorAction SilentlyContinue)) {
    try {
      $lease = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if ([long]$lease.expires -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -and
          [int]$lease.pid -gt 0 -and (Get-Process -Id ([int]$lease.pid) -ErrorAction SilentlyContinue)) { return $true }
    } catch {}
  }
  return $false
}

function Pause-OneDrive($trigger) {
  # Terminate the process directly instead of `OneDrive.exe /shutdown`. /shutdown
  # pops a "Could not shut down OneDrive" dialog whenever it can't exit cleanly;
  # killing the process is silent, instant, and releases its file handles the
  # same way. OneDrive resumes any in-flight upload on next launch.
  $procs = @(Get-Process OneDrive -ErrorAction SilentlyContinue)
  if (-not $procs.Count) { return }
  # Always name the file that tripped the watcher, so "what was writing?" is
  # never a guess.
  Log "activity ($trigger) -> pausing OneDrive" Yellow
  foreach ($p in $procs) { try { $p.Kill() } catch {} }
}

function Resume-OneDrive {
  if (OneDrive-Running) { return }
  Log "idle -> resuming OneDrive (sync will catch up)" Green
  Start-Process $oneDriveExe -ArgumentList '/background'
}

# Total bytes OneDrive has read+written since start (WMI transfer counters,
# summed across its processes). The delta between polls tells us whether it is
# actively syncing or sitting idle.
function OneDrive-IoBytes {
  $total = [uint64]0
  foreach ($p in @(Get-CimInstance Win32_Process -Filter "Name='OneDrive.exe'" -ErrorAction SilentlyContinue)) {
    $total += [uint64]$p.ReadTransferCount + [uint64]$p.WriteTransferCount
  }
  $total
}

# ---------- activity watchers ----------
# Shared state: event actions run in their own dynamic module, so a plain
# $script: variable is NOT visible from them - use a synchronized hashtable
# handed in via MessageData.
$shared = [hashtable]::Synchronized(@{ last = [DateTime]::MinValue; lastPath = '' })
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
    $data.state.lastPath = $p
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
# While OneDrive runs the daemon is in one of two modes:
#   settling - OneDrive is (or may be) syncing its backlog; its own writes into
#              the watched folder must not count as activity. We watch its I/O
#              counters and only arm the watcher once they go quiet.
#   armed    - sync is done; fresh folder activity means real work -> pause.
$IO_QUIET_BYTES  = 512KB     # per-poll I/O delta below this counts as "quiet"
$IO_QUIET_POLLS  = 3         # consecutive quiet polls required to arm
$pausedAt   = $null          # when we shut OneDrive down (null = not paused by us)
$settling   = $true          # start settling: OneDrive may have a backlog right now
$settleFrom = Get-Date
$ioPrev     = OneDrive-IoBytes
$ioQuiet    = 0
try {
  while ($true) {
    Start-Sleep -Seconds $poll
    try {
      $now = Get-Date
      $idleFor = $now - $shared.last
      $running = OneDrive-Running

      if (Cloud-AccessActive) {
        # Imports need the cloud provider to release placeholder metadata.
        Resume-OneDrive
        $pausedAt = $null
        $settling = $true
        $settleFrom = $now
        $ioPrev = OneDrive-IoBytes
        $ioQuiet = 0
        continue
      }

      if ($running) {
        if ($settling) {
          $ioNow = OneDrive-IoBytes
          # Counter reset (OneDrive restarted) reads as negative - treat as busy.
          $delta = if ($ioNow -ge $ioPrev) { $ioNow - $ioPrev } else { [uint64]::MaxValue }
          $ioPrev = $ioNow
          if ($delta -lt $IO_QUIET_BYTES) { $ioQuiet++ } else { $ioQuiet = 0 }
          # Long backlogs can take minutes; say so instead of looking hung.
          $settlingFor = $now - $settleFrom
          if ([int]$settlingFor.TotalSeconds % 60 -lt $poll -and $settlingFor.TotalSeconds -ge 60) {
            Log ("settling: OneDrive still syncing ({0:N0}s, last delta {1:N1} MB)" -f $settlingFor.TotalSeconds, ($delta/1MB)) DarkGray
          }
          if ($ioQuiet -ge $IO_QUIET_POLLS) {
            $settling = $false
            # Everything that happened before this moment has been synced (that's
            # what I/O-quiet means) - consume it so we don't pause on stale
            # activity. Real ongoing work produces a fresh event within seconds.
            $shared.last = [DateTime]::MinValue
            $shared.lastPath = ''
            Log "OneDrive I/O quiet -> sync caught up, watcher armed" Green
          } elseif ($settlingFor -ge $settleMax) {
            $settling = $false
            Log "settle cap reached ($($settleMax.TotalMinutes)m) -> arming watcher anyway" Yellow
          }
        } elseif ($shared.last -ne [DateTime]::MinValue -and $idleFor.TotalSeconds -lt $idleSeconds) {
          Pause-OneDrive $shared.lastPath
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
          $pausedAt   = $null
          $settling   = $true
          $settleFrom = Get-Date
          $ioPrev     = OneDrive-IoBytes
          $ioQuiet    = 0
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
