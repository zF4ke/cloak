#Requires -Version 5.1
[CmdletBinding()]
param([string]$SkillsFolder = (Join-Path $env:USERPROFILE '.codex\skills'), [string]$Source = (Join-Path $PSScriptRoot '..\..\skills\personal-ui'))
$ErrorActionPreference = 'Stop'
$source = $Source
$destination = Join-Path $SkillsFolder 'personal-ui'
if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md'))) { throw 'Clone zF4ke/skills alongside Cloak, or pass -Source with the personal-ui skill folder.' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
Write-Host "Installed personal-ui and its references in $destination"
Write-Host 'Start a new agent session to discover the skill. Invoke it with $personal-ui.'
