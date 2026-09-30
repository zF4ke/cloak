#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Target, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$targetPath = [IO.Path]::GetFullPath($Target).TrimEnd('\')
$paths = @([Environment]::GetEnvironmentVariable('Path','User') -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $targetPath })
if (-not $Remove) { $paths = @($targetPath) + $paths }
[Environment]::SetEnvironmentVariable('Path',($paths -join ';'),'User')
