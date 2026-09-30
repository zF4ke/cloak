#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Target, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$targetPath = [IO.Path]::GetFullPath($Target).TrimEnd('\')
$paths = @([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $targetPath })
if (-not $Remove) { $paths = @($targetPath) + $paths }
[Environment]::SetEnvironmentVariable('Path',($paths -join ';'),'User')
if (-not ('Cloak.EnvironmentNotification' -as [type])) {
  Add-Type -Namespace Cloak -Name EnvironmentNotification -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint Msg, System.UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out System.UIntPtr lpdwResult);
'@
}
$notificationResult = [UIntPtr]::Zero
[Cloak.EnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$notificationResult) | Out-Null
