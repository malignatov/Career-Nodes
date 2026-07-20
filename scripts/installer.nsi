; Career Nodes - per-user Windows installer. Compiled with makensis (works
; cross-platform, e.g. `brew install nsis` on macOS); invoked by
; scripts/package-app.sh after the win32 folder build:
;   makensis -DSRCDIR=<built folder> -DOUTFILE=<setup.exe> scripts/installer.nsi
; Per-user ($LOCALAPPDATA) so friends never see a UAC admin prompt.

Unicode true
!include "MUI2.nsh"

!define APPNAME "Career Nodes"
Name "${APPNAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\${APPNAME}"
RequestExecutionLevel user
; Per-file lzma, small dictionary: /SOLID buffers the whole ~600MB payload
; and aborts makensis with bad_alloc on this build.
SetCompressor lzma
SetCompressorDictSize 16

!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPNAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Open ${APPNAME}"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}/*"
  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPNAME}.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APPNAME}.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "Mikhail Ignatov"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Per-user install dir under $LOCALAPPDATA - safe to remove wholesale.
  ; (User artifacts live in Electron's userData under %APPDATA%, untouched.)
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
