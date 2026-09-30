#Requires -Version 5.1
param([Parameter(Mandatory)][string]$Payload)
$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
if ($request.action -eq 'resume') {
  $session = (Get-Process -Id $PID).SessionId
  if (-not @(Get-Process OneDrive -ErrorAction SilentlyContinue | Where-Object SessionId -eq $session).Count) {
    $exe = @(
      (Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\OneDrive.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft OneDrive\OneDrive.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft OneDrive\OneDrive.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $exe) { throw 'OneDrive is unavailable. Start it before importing cloud folders.' }
    Start-Process -FilePath $exe -ArgumentList '/background' -WindowStyle Hidden
  }
  '{"resumed":true}'
  return
}
if ($request.action -ne 'move') { throw 'Unknown folder action.' }
Add-Type @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class CloakFolderMove {
  [StructLayout(LayoutKind.Sequential)] struct FileTime { public uint Low, High; }
  [StructLayout(LayoutKind.Sequential)] struct Info {
    public uint Attributes; public FileTime Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool MoveFileEx(string source, string target, uint flags);
  static SafeFileHandle Verified(string path, ulong device, ulong inode) {
    var handle = CreateFile(path, 0x80, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    Info info;
    if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info)) {
      int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new System.ComponentModel.Win32Exception(error);
    }
    if ((info.Attributes & 16) == 0 || info.Volume != device || (((ulong)info.IndexHigh << 32) | info.IndexLow) != inode) {
      handle.Dispose(); throw new IOException("The folder changed. Inspect it again.");
    }
    return handle;
  }
  public static int Move(string source, string target, ulong device, ulong inode, ulong parentDevice, ulong parentInode) {
    try {
      using (var folder = Verified(source, device, inode))
      using (var parent = Verified(Path.GetDirectoryName(target), parentDevice, parentInode)) {
        // No replacement, copy, deletion, or deferred-reboot flags.
        return MoveFileEx(source, target, 0) ? 0 : Marshal.GetLastWin32Error();
      }
    } catch (System.ComponentModel.Win32Exception error) { return error.NativeErrorCode; }
  }
}
'@
$code = [CloakFolderMove]::Move($request.source, $request.target, [uint64]$request.dev, [uint64]$request.ino, [uint64]$request.parentDev, [uint64]$request.parentIno)
[pscustomobject]@{ code=$code; message=$(if ($code) { [ComponentModel.Win32Exception]::new($code).Message } else { '' }) } | ConvertTo-Json -Compress
