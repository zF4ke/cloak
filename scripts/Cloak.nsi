!include "LogicLib.nsh"
Name "Cloak ${VERSION}"
OutFile "${OUT}\Cloak-Setup-${VERSION}.exe"
Unicode True
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\cloak\app"
Icon "${ICON}"
UninstallIcon "${ICON}"
SetCompressor /SOLID lzma
SilentInstall silent
ShowUninstDetails show

Section "Cloak"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\Cloak"
  File /r "${SOURCE}\*.*"
  WriteUninstaller "$PLUGINSDIR\Cloak\Uninstall.exe"
  ExecWait '"$PLUGINSDIR\Cloak\Cloak.exe" --cloak-setup' $0
  SetErrorLevel $0
SectionEnd

Section "Uninstall"
  ; The app directory is fixed. Never recursively delete user project or data folders.
  StrCmp $INSTDIR "$LOCALAPPDATA\cloak\app" +2
  Abort "Unexpected installation folder. Nothing was removed."
  MessageBox MB_OKCANCEL "Remove Cloak? Managed projects, folder links and settings stay in place. Quit Cloak from its tray menu first." IDOK +2
  Abort
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\app\scripts\uninstall-desktop.ps1" -Target "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Cloak could not uninstall. Quit it from the tray menu and try again."
    Abort
  ${EndIf}
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Cloak\Cloak.lnk"
  Delete "$SMPROGRAMS\Cloak\Uninstall Cloak.lnk"
  RMDir "$SMPROGRAMS\Cloak"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Cloak"
SectionEnd
