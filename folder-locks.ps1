param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
if ($request.action -notin @('inspect', 'close', 'end')) { throw 'Unknown folder-lock action.' }
# Protect Cloak, this helper, its launching processes and Windows services.
$processTable = @(Get-CimInstance Win32_Process)
$protectedIds = [Collections.Generic.HashSet[int]]::new()
$ancestor = [int]$request.owner
while ($ancestor -gt 0 -and $protectedIds.Add($ancestor)) {
  $entry = $processTable | Where-Object ProcessId -EQ $ancestor | Select-Object -First 1
  if (-not $entry) { break }
  $ancestor = [int]$entry.ParentProcessId
}
[void]$protectedIds.Add($PID)
$ownerProcess = [Diagnostics.Process]::GetProcessById([int]$request.owner)
$results = @()
foreach ($candidate in $request.processes) {
  $appProcess = $null
  try {
    $appProcess = [Diagnostics.Process]::GetProcessById([int]$candidate.pid)
    $protected = $protectedIds.Contains($appProcess.Id) -or
      $appProcess.SessionId -ne $ownerProcess.SessionId -or
      $appProcess.ProcessName -in @('Cloak', 'System', 'Registry', 'smss', 'csrss', 'wininit', 'winlogon', 'services', 'lsass')
    $started = ''
    if (-not $protected) {
      # Pin the process object so PID reuse cannot redirect validation or Kill.
      $heldHandle = $appProcess.Handle
      $started = $appProcess.StartTime.ToUniversalTime().Ticks.ToString()
    }
    if ($request.action -ne 'inspect') {
      if ($protected -or $started -ne $candidate.started) { continue }
      if ($request.action -eq 'end') {
        # Kill only this verified process instance, never an entire process tree.
        $appProcess.Kill()
        [void]$appProcess.WaitForExit(3000)
      } elseif ($appProcess.MainWindowHandle -ne [IntPtr]::Zero) {
        [void]$appProcess.CloseMainWindow()
      }
    } else {
      $results += [pscustomobject]@{
        pid = $appProcess.Id; name = $candidate.name; started = $started
        protected = $protected; canClose = ($appProcess.MainWindowHandle -ne [IntPtr]::Zero)
      }
    }
  } catch [ArgumentException] {
    # A task that exited after the scan no longer needs closing.
  } catch {
    if ($request.action -eq 'inspect') {
      # Keep inaccessible holders visible without offering to close them.
      $results += [pscustomobject]@{ pid = [int]$candidate.pid; name = $candidate.name; started = ''; protected = $true; canClose = $false }
    } else {
      # A pinned process can exit while a normal close or Kill is pending.
      if ($appProcess) {
        try { if ($appProcess.HasExited) { continue } } catch { }
      }
      throw
    }
  } finally {
    if ($appProcess) { $appProcess.Dispose() }
  }
}
$ownerProcess.Dispose()
ConvertTo-Json -InputObject @($results) -Compress
