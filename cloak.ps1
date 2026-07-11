#Requires -Version 5.1
<#
  cloak - command line for the OneDrive pause daemon.

    cloak status                 daemon / task / OneDrive state + recent log
    cloak install                install (or repair) and add cloak to PATH
    cloak uninstall              remove the daemon and PATH entry
    cloak start | stop           start / stop the daemon
    cloak log [-Follow]          show the daemon log
    cloak probe                  test how OneDrive treats junctions here

  Manual junction mode (fully hide a folder from OneDrive until you turn it off):
    cloak on   <path>            move the folder to local disk, junction in place
    cloak off  <path>            restore it (OneDrive re-syncs)
    cloak list                   show junction-cloaked folders
    cloak restore-all            restore every junction-cloaked folder
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Arg,
  [switch]$Follow
)

$ErrorActionPreference = 'Stop'
$Repo      = $PSScriptRoot
$StateDir  = Join-Path $env:LOCALAPPDATA 'cloak'
$StateFile = Join-Path $StateDir 'state.json'
$LogFile   = Join-Path $StateDir 'cloakd.log'
$Host_     = $env:COMPUTERNAME

function Ok($t)   { Write-Host "  + $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  ! $t" -ForegroundColor Yellow }
function Bad($t)  { Write-Host "  x $t" -ForegroundColor Red }
function Info($t) { Write-Host "    $t" -ForegroundColor DarkGray }

# ---------------- daemon control ----------------
function Cmd-Start {
  schtasks /Run /TN cloakd *> $null
  if ($LASTEXITCODE -eq 0) { Ok "daemon started" } else { Bad "no scheduled task 'cloakd' - run: cloak install" }
}
function Cmd-Stop {
  schtasks /End /TN cloakd *> $null
  Get-CimInstance Win32_Process -Filter "Name='pwsh.exe' OR Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*cloakd.ps1*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Ok "daemon stopped"
}
function Cmd-Log {
  if (-not (Test-Path $LogFile)) { Warn "no log yet ($LogFile)"; return }
  if ($Follow) { Get-Content $LogFile -Tail 30 -Wait } else { Get-Content $LogFile -Tail 30 }
}

# ---------------- junction mode ----------------
function Load-State {
  if (-not (Test-Path $StateFile)) { return @() }
  try {
    $raw = Get-Content $StateFile -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
    return @(($raw | ConvertFrom-Json) | Where-Object { $_ -and $_.path })
  } catch { return @() }
}
function Save-State($entries) {
  New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
  $clean = @($entries | Where-Object { $_ -and $_.path })
  if ($clean.Count -eq 0) { Set-Content -Path $StateFile -Value '[]' -Encoding UTF8; return }
  ConvertTo-Json -InputObject $clean -Depth 5 | Set-Content -Path $StateFile -Encoding UTF8
}
function Is-Junction($p) { (Test-Path $p) -and ((([int](Get-Item $p -Force).Attributes) -band 0x400) -ne 0) }

function Scratch-For($target) {
  $tvol = Split-Path -Qualifier $target
  $lvol = Split-Path -Qualifier $env:LOCALAPPDATA
  $cfgScratch = $null
  $cfgPath = Join-Path $Repo 'config.jsonc'
  if (Test-Path $cfgPath) {
    try {
      $jsonc = (Get-Content $cfgPath -Raw) -replace '(?m)^\s*//.*$','' -replace '(?s)/\*.*?\*/',''
      $cfgScratch = ($jsonc | ConvertFrom-Json).scratchDir
    } catch {}
  }
  $base = if ($cfgScratch -and (Split-Path -Qualifier $cfgScratch) -eq $tvol) { $cfgScratch }
          elseif ($tvol -eq $lvol) { Join-Path $env:LOCALAPPDATA 'cloak\scratch' }
          else { Join-Path "$tvol\" '.cloak-scratch' }
  $name = Split-Path $target -Leaf
  $hash = ([BitConverter]::ToString(
             (New-Object Security.Cryptography.SHA1Managed).ComputeHash(
               [Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant()))) -replace '-','').Substring(0,8).ToLower()
  Join-Path $base "$name-$hash"
}

function Cloak-On($target) {
  if (-not $target) { Bad "usage: cloak on <path>"; return }
  $target = (Resolve-Path -LiteralPath $target).Path.TrimEnd('\')
  if (Is-Junction $target) { Warn "Already cloaked: $target"; return }
  if (-not (Test-Path $target -PathType Container)) { Bad "Not a folder: $target"; return }
  $od = $env:OneDrive
  if ($od -and -not $target.ToLower().StartsWith($od.ToLower())) { Warn "Not under OneDrive - cloaking is harmless but pointless here." }
  $scratch = Scratch-For $target
  New-Item -ItemType Directory -Force -Path (Split-Path $scratch) | Out-Null
  if (Test-Path $scratch) { Bad "Scratch already exists ($scratch). A previous cloak may be dangling; run: cloak restore-all"; return }
  $state = @(Load-State | Where-Object { $_.path -ne $target })
  $entry = [pscustomobject]@{ path = $target; scratch = $scratch; host = $Host_; cloakedAt = (Get-Date).ToString('o') }
  Save-State ($state + $entry)
  try { Move-Item -LiteralPath $target -Destination $scratch -ErrorAction Stop }
  catch { Save-State $state; Bad "Couldn't move $target (a file open or a shell inside it?): $($_.Exception.Message)"; return }
  New-Item -ItemType Junction -Path $target -Target $scratch | Out-Null
  Ok "Cloaked: $target"
  Info "bytes moved to $scratch (OneDrive now ignores the junction)"
}

function Cloak-Off($target) {
  if (-not $target) { Bad "usage: cloak off <path>"; return }
  if (Test-Path -LiteralPath $target) { $target = (Resolve-Path -LiteralPath $target).Path.TrimEnd('\') }
  $state = @(Load-State)
  $entry = $state | Where-Object { $_.path -eq $target } | Select-Object -First 1
  if (-not $entry) {
    if (Is-Junction $target) { Bad "$target is a junction but not tracked by cloak. Remove it manually if intended." }
    else { Warn "Not cloaked: $target" }
    return
  }
  if (Is-Junction $target) { [System.IO.Directory]::Delete($target, $false) }
  elseif (Test-Path $target) { Bad "$target exists but isn't a junction. Not restoring over real data."; return }
  if (Test-Path $entry.scratch) {
    Move-Item -LiteralPath $entry.scratch -Destination $target -ErrorAction Stop
    Ok "Uncloaked: $target (OneDrive will re-sync)"
  } else { Bad "Scratch missing ($($entry.scratch)). Nothing to restore; state cleared." }
  Save-State (@($state | Where-Object { $_.path -ne $target }))
}

function Show-List {
  $state = @(Load-State)
  Write-Host ""
  Write-Host "  junction-cloaked folders" -ForegroundColor Cyan
  if (-not $state.Count) { Info "none."; Write-Host ""; return }
  foreach ($e in $state) {
    $live = if (Is-Junction $e.path) { 'CLOAKED' } else { 'stale?' }
    Write-Host ("  [{0}] {1}" -f $live, $e.path) -ForegroundColor $(if ($live -eq 'CLOAKED') {'Green'} else {'Yellow'})
    Write-Host ("          scratch: {0}  since {1}" -f $e.scratch, $e.cloakedAt) -ForegroundColor DarkGray
  }
  Write-Host ""
}
function Restore-All {
  $state = @(Load-State)
  if (-not $state.Count) { Info "Nothing to restore."; return }
  Write-Host "  restoring $($state.Count) folder(s)..." -ForegroundColor Cyan
  foreach ($e in $state) { Cloak-Off $e.path }
}

function Show-Help {
  Write-Host ""
  Write-Host "cloak - pause OneDrive while you work" -ForegroundColor Magenta
  Write-Host ""
  Write-Host "  cloak status              daemon / task / OneDrive state + recent log"
  Write-Host "  cloak install             install or repair, add cloak to PATH"
  Write-Host "  cloak uninstall           remove daemon and PATH entry"
  Write-Host "  cloak start | stop        start / stop the daemon"
  Write-Host "  cloak log [-Follow]       show the daemon log"
  Write-Host "  cloak probe               test how OneDrive treats junctions here"
  Write-Host ""
  Write-Host "  cloak on <path>           manually hide a folder from OneDrive (junction)" -ForegroundColor DarkGray
  Write-Host "  cloak off <path>          restore it" -ForegroundColor DarkGray
  Write-Host "  cloak list                show junction-cloaked folders" -ForegroundColor DarkGray
  Write-Host "  cloak restore-all         restore all of them" -ForegroundColor DarkGray
  Write-Host ""
}

switch ($Command.ToLower()) {
  'status'      { & "$Repo\install.ps1" -Status }
  'install'     { & "$Repo\install.ps1" }
  'uninstall'   { & "$Repo\install.ps1" -Uninstall }
  'start'       { Cmd-Start }
  'stop'        { Cmd-Stop }
  'log'         { Cmd-Log }
  'probe'       { & "$Repo\probe.ps1" }
  'on'          { Cloak-On $Arg }
  'off'         { Cloak-Off $Arg }
  'list'        { Show-List }
  'restore-all' { Restore-All }
  default       { Show-Help }
}
