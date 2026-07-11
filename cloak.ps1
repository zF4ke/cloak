#Requires -Version 5.1
<#
  cloak — isolate a OneDrive-synced folder behind a junction while you work.

  Commands:
    cloak.ps1 on   <path>     Cloak: move bytes to local scratch, junction in place.
    cloak.ps1 off  <path>     Uncloak: remove junction, move bytes back (OneDrive re-syncs).
    cloak.ps1 status          Show every managed project and its state.
    cloak.ps1 restore-all     Uncloak everything still cloaked (fail-safe; run at logon).

  Design notes:
    - Scratch lives on the SAME volume as the target, so cloak/uncloak is an
      instant metadata move, never a copy.
    - State is recorded BEFORE the junction is created and cleared AFTER restore,
      so a crash never loses data — restore-all reconciles on next run.
    - `off` and `restore-all` remove ONLY the junction (never the target), then
      move the real bytes back.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][ValidateSet('on','off','status','restore-all')]
  [string]$Command = 'status',
  [Parameter(Position = 1)][string]$Path
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

$StateDir  = Join-Path $env:LOCALAPPDATA 'cloak'
$StateFile = Join-Path $StateDir 'state.json'
$Host_     = $env:COMPUTERNAME

function Ok($t)   { Write-Host "  ✓ $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  ✗ $t" -ForegroundColor Red }
function Info($t) { Write-Host "  · $t" -ForegroundColor DarkGray }

function Load-State {
  if (-not (Test-Path $StateFile)) { return @() }
  try {
    $raw = Get-Content $StateFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    $data = $raw | ConvertFrom-Json
    return @($data | Where-Object { $_ -and $_.path })
  } catch { return @() }
}
function Save-State($entries) {
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $clean = @($entries | Where-Object { $_ -and $_.path })
  if ($clean.Count -eq 0) { Set-Content -Path $StateFile -Value '[]' -Encoding UTF8; return }
  ConvertTo-Json -InputObject $clean -Depth 5 | Set-Content -Path $StateFile -Encoding UTF8
}

function Is-Junction($p) {
  (Test-Path $p) -and ((([int](Get-Item $p -Force).Attributes) -band 0x400) -ne 0)
}

# Scratch path on the SAME volume as the target (instant rename). Uses
# scratchDir from config.jsonc when set and on the right volume; otherwise
# LOCALAPPDATA, or a hidden dir at the target's volume root.
function Scratch-For($target) {
  $tvol = Split-Path -Qualifier $target
  $lvol = Split-Path -Qualifier $env:LOCALAPPDATA
  $cfgScratch = $null
  $cfgPath = Join-Path $PSScriptRoot 'config.jsonc'
  if (Test-Path $cfgPath) {
    try {
      $jsonc = (Get-Content $cfgPath -Raw) -replace '(?m)^\s*//.*$','' -replace '(?s)/\*.*?\*/',''
      $cfgScratch = ($jsonc | ConvertFrom-Json).scratchDir
    } catch {}
  }
  $base = if ($cfgScratch -and (Split-Path -Qualifier $cfgScratch) -eq $tvol) { $cfgScratch }
          elseif ($tvol -eq $lvol) { Join-Path $env:LOCALAPPDATA 'cloak\scratch' }
          else { Join-Path "$tvol\" '.cloak-scratch' }
  $name = (Split-Path $target -Leaf)
  $hash = ([BitConverter]::ToString(
             (New-Object Security.Cryptography.SHA1Managed).ComputeHash(
               [Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant()))) -replace '-','').Substring(0,8).ToLower()
  Join-Path $base "$name-$hash"
}

function Cloak-On($target) {
  $target = (Resolve-Path -LiteralPath $target).Path.TrimEnd('\')
  if (Is-Junction $target) { Warn "Already cloaked: $target"; return }
  if (-not (Test-Path $target -PathType Container)) { Bad "Not a folder: $target"; return }
  $od = $env:OneDrive
  if ($od -and -not $target.ToLower().StartsWith($od.ToLower())) {
    Warn "Not under OneDrive ($od) — cloaking is harmless but pointless here."
  }
  $scratch = Scratch-For $target
  New-Item -ItemType Directory -Force -Path (Split-Path $scratch) | Out-Null
  if (Test-Path $scratch) { Bad "Scratch already exists ($scratch) — a previous cloak may be dangling. Run restore-all."; return }

  # Record intent BEFORE mutating, so a crash mid-op is recoverable.
  $state = @(Load-State | Where-Object { $_.path -ne $target })
  $entry = [pscustomobject]@{ path = $target; scratch = $scratch; host = $Host_; cloakedAt = (Get-Date).ToString('o') }
  Save-State ($state + $entry)

  try {
    Move-Item -LiteralPath $target -Destination $scratch -ErrorAction Stop
  } catch {
    Save-State $state  # roll back the record
    Bad "Couldn't move $target — is a file open or a shell sitting in it? ($($_.Exception.Message))"
    return
  }
  New-Item -ItemType Junction -Path $target -Target $scratch | Out-Null
  Ok "Cloaked: $target"
  Info "bytes → $scratch  (OneDrive now ignores the junction)"
}

function Cloak-Off($target) {
  if (Test-Path -LiteralPath $target) { $target = (Resolve-Path -LiteralPath $target).Path.TrimEnd('\') }
  $state = @(Load-State)
  $entry = $state | Where-Object { $_.path -eq $target } | Select-Object -First 1
  if (-not $entry) {
    if (Is-Junction $target) { Bad "$target is a junction but not tracked by cloak — refusing to guess. Remove it manually if intended." }
    else { Warn "Not cloaked: $target" }
    return
  }
  if (Is-Junction $target) { [System.IO.Directory]::Delete($target, $false) }  # junction only
  elseif (Test-Path $target) { Bad "$target exists but isn't a junction — not restoring over real data."; return }

  if (Test-Path $entry.scratch) {
    Move-Item -LiteralPath $entry.scratch -Destination $target -ErrorAction Stop
    Ok "Uncloaked: $target  (OneDrive will re-sync)"
  } else {
    Bad "Scratch missing ($($entry.scratch)) — nothing to restore. State cleared."
  }
  Save-State (@($state | Where-Object { $_.path -ne $target }))
}

function Show-Status {
  $state = @(Load-State)
  Write-Host ""
  Write-Host "  cloak — managed projects" -ForegroundColor Cyan
  if (-not $state.Count) { Info "none cloaked."; Write-Host ""; return }
  foreach ($e in $state) {
    $live = if (Is-Junction $e.path) { 'CLOAKED' } else { 'stale?' }
    $col  = if ($live -eq 'CLOAKED') { 'Green' } else { 'Yellow' }
    Write-Host ("  [{0}] {1}" -f $live, $e.path) -ForegroundColor $col
    Write-Host ("           scratch: {0}  since {1}" -f $e.scratch, $e.cloakedAt) -ForegroundColor DarkGray
  }
  Write-Host ""
}

function Restore-All {
  $state = @(Load-State)
  if (-not $state.Count) { Info "Nothing to restore."; return }
  Write-Host "  restoring $($state.Count) project(s)..." -ForegroundColor Cyan
  foreach ($e in $state) { Cloak-Off $e.path }
}

switch ($Command) {
  'on'          { if (-not $Path) { Bad "usage: cloak.ps1 on <path>"; exit 1 }; Cloak-On $Path }
  'off'         { if (-not $Path) { Bad "usage: cloak.ps1 off <path>"; exit 1 }; Cloak-Off $Path }
  'status'      { Show-Status }
  'restore-all' { Restore-All }
}
