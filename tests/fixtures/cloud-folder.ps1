param([string]$Root, [switch]$Cleanup)
$ErrorActionPreference='Stop'
$rootPath = [IO.Path]::GetFullPath($Root)
if (-not $rootPath.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\cloak-cloud-', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Cloud fixtures must stay in an isolated temporary folder.'
}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class CloudFixture {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Registration {
  public uint Size; public string Name,Version; public IntPtr RootIdentity; public uint RootLength;
  public IntPtr FileIdentity; public uint FileLength; public Guid Provider;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Policy { public ushort Primary,Modifier; }
 [StructLayout(LayoutKind.Sequential)] public struct Policies { public uint Size; public Policy Hydration,Population; public uint InSync,HardLink,Management; }
 [StructLayout(LayoutKind.Sequential)] public struct Basic { public long Creation,Access,Write,Change; public uint Attributes; }
 [StructLayout(LayoutKind.Sequential)] public struct Metadata { public Basic Basic; public long Size; }
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct Placeholder { public string Name; public Metadata Metadata; public IntPtr Identity; public uint Length,Flags; public int Result; public long Usn; }
 [DllImport("cldapi.dll",CharSet=CharSet.Unicode)] public static extern int CfRegisterSyncRoot(string root, ref Registration reg,ref Policies policy,uint flags);
 [DllImport("cldapi.dll",CharSet=CharSet.Unicode)] public static extern int CfUnregisterSyncRoot(string root);
 [DllImport("cldapi.dll",CharSet=CharSet.Unicode)] public static extern int CfCreatePlaceholders(string root,ref Placeholder placeholder,uint count,uint flags,out uint done);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool MoveFileEx(string source,string target,uint flags);
 public static int Move(string source,string target) { return MoveFileEx(source,target,0) ? 0 : Marshal.GetLastWin32Error(); }
 public static void Create(string root) {
  var reg=new Registration { Size=(uint)Marshal.SizeOf(typeof(Registration)),Name="Cloak isolated fixture",Version="1",Provider=Guid.NewGuid() };
  var policy=new Policies { Size=(uint)Marshal.SizeOf(typeof(Policies)),Hydration=new Policy { Primary=1 },Population=new Policy { Primary=2 } };
  var rootIdentity=Marshal.AllocHGlobal(1); Marshal.WriteByte(rootIdentity,1); reg.RootIdentity=rootIdentity; reg.RootLength=1; reg.FileIdentity=rootIdentity; reg.FileLength=1;
  try { Marshal.ThrowExceptionForHR(CfRegisterSyncRoot(root,ref reg,ref policy,0)); } finally { Marshal.FreeHGlobal(rootIdentity); }
  var identity=Marshal.AllocHGlobal(1); Marshal.WriteByte(identity,1);
  var time=DateTime.UtcNow.ToFileTimeUtc();
  var ph=new Placeholder { Name="project", Metadata=new Metadata { Basic=new Basic { Attributes=16,Creation=time,Access=time,Write=time,Change=time } }, Flags=3, Identity=identity,Length=1 };
  try { uint done; Marshal.ThrowExceptionForHR(CfCreatePlaceholders(root,ref ph,1,0,out done)); Marshal.ThrowExceptionForHR(ph.Result); } finally { Marshal.FreeHGlobal(identity); }
 }
}
'@
if($Cleanup) {
  $result = [CloudFixture]::CfUnregisterSyncRoot($Root)
  if ($result -ne -2147024506) { [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result) }
  return
}
[CloudFixture]::Create($Root)
