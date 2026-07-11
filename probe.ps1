#Requires -Version 5.1
<#
  cloak — OneDrive behavior probe
  --------------------------------
  Cloak isolates a project from OneDrive *while you work* by replacing the
  synced folder with a junction to a local scratch dir, then restores it when
  you stop. The whole design rests on ONE assumption:

      "When a folder inside OneDrive is a junction to a local dir, OneDrive
       leaves it alone — it does not follow the junction, create placeholders,
       upload the target, or produce conflict copies."

  This is widely relied on (the classic `node_modules` trick), but it varies by
  OneDrive version and Files-On-Demand settings. So we MEASURE it on this
  machine instead of assuming. This probe is read-only toward your real data:
  it only ever touches a throwaway `__cloak_probe__` folder and cleans up after
  itself, even on error.

  Run:  pwsh -File probe.ps1        (add -KeepArtifacts to skip cleanup)
#>
[CmdletBinding()]
param([switch]$KeepArtifacts)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8

# ---------- colored output ----------
function Step($t) { Write-Host "`n▸ $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  ✓ $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  ✗ $t" -ForegroundColor Red }
function Info($t) { Write-Host "  · $t" -ForegroundColor DarkGray }

# Windows cloud-filter / dehydration attribute bits (not all named in .NET enum)
$ATTR = @{
  ReparsePoint        = 0x00000400
  Offline             = 0x00001000
  RecallOnOpen        = 0x00040000  # FILE_ATTRIBUTE_RECALL_ON_OPEN
  RecallOnDataAccess  = 0x00400000  # FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS
  Pinned              = 0x00080000  # FILE_ATTRIBUTE_PINNED (OneDrive "always keep")
  Unpinned            = 0x00100000  # FILE_ATTRIBUTE_UNPINNED
}
function AttrNames([int]$a) {
  ($ATTR.GetEnumerator() | Where-Object { ($a -band $_.Value) -ne 0 } | ForEach-Object { $_.Key }) -join ', '
}
function CloudTouched([int]$a) {
  (($a -band $ATTR.Offline) -ne 0) -or
  (($a -band $ATTR.RecallOnOpen) -ne 0) -or
  (($a -band $ATTR.RecallOnDataAccess) -ne 0)
}

Write-Host ""
Write-Host "  ┌─────────────────────────────────────────────┐" -ForegroundColor Magenta
Write-Host "  │  cloak · probe                              │" -ForegroundColor Magenta
Write-Host "  │  how does OneDrive treat junctions here?    │" -ForegroundColor Magenta
Write-Host "  └─────────────────────────────────────────────┘" -ForegroundColor Magenta

# ---------- environment ----------
Step "Environment"
$od = $env:OneDrive
if (-not $od) { $od = $env:OneDriveConsumer }
if (-not $od) { $od = $env:OneDriveCommercial }
if (-not $od -or -not (Test-Path $od)) {
  Bad "No OneDrive root found (`$env:OneDrive is empty or missing). Is OneDrive set up on this account?"
  exit 2
}
Ok "OneDrive root: $od"

$odProc = Get-Process OneDrive -ErrorAction SilentlyContinue
if ($odProc) { Ok "OneDrive process running (PID $(($odProc | Select-Object -First 1).Id))" }
else { Warn "OneDrive process is NOT running — start it for a meaningful result, otherwise sync behavior can't be observed." }

$scratchRoot = Join-Path $env:LOCALAPPDATA "cloak\probe-scratch"
$odVol = Split-Path -Qualifier $od
$scVol = Split-Path -Qualifier $scratchRoot
if ($odVol -eq $scVol) { Ok "OneDrive and local scratch share volume $odVol → isolate/restore will be an instant metadata move." }
else { Warn "OneDrive ($odVol) and scratch ($scVol) are on different volumes → isolate/restore would COPY, not rename. cloak should place scratch on $odVol." }

# ---------- the test ----------
$probe   = Join-Path $od "__cloak_probe__"
$proj    = Join-Path $probe "project"
$scratch = Join-Path $scratchRoot "project"
$findings = [ordered]@{}

try {
  Step "Create a throwaway synced folder"
  if (Test-Path $probe) { Remove-Item $probe -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $proj | Out-Null
  Set-Content -Path (Join-Path $proj "baseline.txt") -Value "synced baseline $(Get-Date -Format o)" -Encoding UTF8
  Ok "Created $proj with baseline.txt"
  Info "Giving OneDrive ~15s to notice and sync it..."
  Start-Sleep -Seconds 15
  $baseAttr = [int](Get-Item (Join-Path $proj "baseline.txt") -Force).Attributes
  Info "baseline.txt attributes: $(AttrNames $baseAttr)"

  Step "Isolate: move contents local + drop a junction in its place"
  New-Item -ItemType Directory -Force -Path (Split-Path $scratch) | Out-Null
  if (Test-Path $scratch) { Remove-Item $scratch -Recurse -Force }
  Move-Item -Path $proj -Destination $scratch
  New-Item -ItemType Junction -Path $proj -Target $scratch | Out-Null
  $isReparse = ([int](Get-Item $proj -Force).Attributes -band $ATTR.ReparsePoint) -ne 0
  if ($isReparse) { Ok "$proj is now a junction (reparse point) → $scratch" }
  else { Bad "Expected a reparse point but didn't get one — junction creation may have failed." }
  $findings.JunctionCreated = $isReparse

  Step "Write a file THROUGH the junction while 'cloaked'"
  $isoFile = Join-Path $proj "isolated-write.txt"
  Set-Content -Path $isoFile -Value "written while cloaked $(Get-Date -Format o)" -Encoding UTF8
  $target = Join-Path $scratch "isolated-write.txt"
  if (Test-Path $target) { Ok "Write landed on the local target ($target)" }
  else { Bad "Write did not reach the local target — junction not transparent." }

  Info "Watching for OneDrive interference for ~30s..."
  Start-Sleep -Seconds 30

  Step "Did OneDrive touch the cloaked folder?"
  $tgtAttr  = [int](Get-Item $target -Force).Attributes
  $baseNow  = [int](Get-Item (Join-Path $scratch "baseline.txt") -Force).Attributes
  Info "isolated-write.txt attributes: $(AttrNames $tgtAttr)"
  Info "baseline.txt (in scratch) attributes: $(AttrNames $baseNow)"

  $cloudTouched = (CloudTouched $tgtAttr) -or (CloudTouched $baseNow)
  # conflict copies OneDrive tends to leave behind
  $conflicts = @(Get-ChildItem $probe -Recurse -Force -ErrorAction SilentlyContinue |
                 Where-Object { $_.Name -match '(-[A-Za-z0-9]+\.\w+$)' -and $_.Name -match $env:COMPUTERNAME })
  $stillJunction = ([int](Get-Item $proj -Force).Attributes -band $ATTR.ReparsePoint) -ne 0

  $findings.CloudPlaceholderedTarget = $cloudTouched
  $findings.ConflictCopies           = $conflicts.Count
  $findings.JunctionSurvived         = $stillJunction

  if (-not $cloudTouched) { Ok "No cloud placeholder/recall attributes appeared on the target — OneDrive is NOT following the junction." }
  else { Bad "Cloud recall/offline attributes appeared on the target — OneDrive followed the junction into local scratch." }
  if ($conflicts.Count -eq 0) { Ok "No OneDrive conflict copies created." }
  else { Warn "$($conflicts.Count) possible conflict file(s) appeared: $($conflicts.Name -join ', ')" }
  if ($stillJunction) { Ok "Junction is intact (OneDrive didn't replace it)." }
  else { Warn "Junction no longer a reparse point — OneDrive may have rewritten the folder." }

  Step "Restore: remove junction, move bytes back (no data touched)"
  [System.IO.Directory]::Delete($proj, $false)   # removes the junction only, never the target
  Move-Item -Path $scratch -Destination $proj
  $restored = (Test-Path (Join-Path $proj "baseline.txt")) -and (Test-Path (Join-Path $proj "isolated-write.txt"))
  if ($restored) { Ok "Folder restored with both files intact." } else { Bad "Restore incomplete — check $proj and $scratch." }
  $findings.RestoreClean = $restored
}
finally {
  if (-not $KeepArtifacts) {
    Step "Cleanup"
    foreach ($p in @($probe, (Join-Path $env:LOCALAPPDATA "cloak\probe-scratch"))) {
      if (Test-Path $p) { try { Remove-Item $p -Recurse -Force -ErrorAction Stop; Info "removed $p" } catch { Warn "could not remove $p — $($_.Exception.Message)" } }
    }
  } else { Warn "Left probe artifacts in place (-KeepArtifacts)." }
}

# ---------- verdict ----------
Step "Verdict"
$junctionSafe = $findings.JunctionCreated -and (-not $findings.CloudPlaceholderedTarget) -and ($findings.ConflictCopies -eq 0)
if ($junctionSafe) {
  Write-Host "  ➜ JUNCTION MECHANISM IS SAFE on this machine." -ForegroundColor Green
  Write-Host "    cloak can isolate by junctioning the project to local scratch; OneDrive ignores it." -ForegroundColor Green
} else {
  Write-Host "  ➜ JUNCTION MECHANISM IS RISKY here — OneDrive interfered." -ForegroundColor Red
  Write-Host "    Fall back to: pause OneDrive during the isolate/restore swap, or same-volume move-out." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  findings:" -ForegroundColor DarkGray
$findings.GetEnumerator() | ForEach-Object { Write-Host ("    {0,-26} {1}" -f $_.Key, $_.Value) -ForegroundColor Gray }
Write-Host ""
