; The Tauri installer's hooks (tauri.conf.json bundle.windows.nsis.installerHooks): the removal
; questions build/installer.nsh asks for the Electron build, asked the same way.
;
; The uninstaller runs the app once with --uninstall. Its window asks what goes along with the
; program, does what was ticked, and answers with the exit code:
;
;   3  the person changed their mind - nothing at all is removed
;   4  done, and the app's own folder should go too
;   *  done (or never ran) - carry on with the plain uninstall
;
; Anything unexpected - the exe missing, a crash - carries on with the uninstall: somebody
; removing a program that is already broken must not be stopped by the broken program.

Var d2mmWipeData

!macro NSIS_HOOK_PREUNINSTALL
  StrCpy $d2mmWipeData "0"

  ; An update is an uninstall too, and it must ask nothing and remove nothing. Tauri's installer
  ; replaces a version by running the old uninstaller with /UPDATE (and /P when it runs passive,
  ; as the updater does), and un.onInit has read both into $UpdateMode and $PassiveMode.
  ; A silent run has no interface, and a window asking questions is one. Windows' own uninstall
  ; entry passes none of these, which is exactly when the questions should be asked.
  ${If} $UpdateMode = 1
  ${OrIf} $PassiveMode = 1
  ${OrIf} ${Silent}
    Goto d2mmNothingToAsk
  ${EndIf}

  IfFileExists "$INSTDIR\${MAINBINARYNAME}.exe" 0 d2mmNothingToAsk
    ; The template's own check runs only after this hook. A copy still running (in the tray, say)
    ; would take the --uninstall start as a second instance and end it at once, unasked.
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ClearErrors
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --uninstall' $0
    ${IfNot} ${Errors}
      ${If} $0 = 3
        SetErrorLevel 1
        Quit
      ${EndIf}
      ${If} $0 = 4
        StrCpy $d2mmWipeData "1"
      ${EndIf}
    ${EndIf}
  d2mmNothingToAsk:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $d2mmWipeData == "1"
    ; The app's own folder (src-tauri/src/main.rs: %APPDATA%\Dota 2 Mod Manager, the folder the
    ; Electron build kept too) and the window's WebView2 data under the bundle id. The app does not
    ; delete its own folder: it runs out of it with its log open; down here nothing holds it.
    RMDir /r "$APPDATA\Dota 2 Mod Manager"
    RMDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}
  ; the d2mm:// handler goes with the program, unless an update puts it straight back or it is
  ; another program's by now
  ${If} $UpdateMode <> 1
    ReadRegStr $R7 HKCU "Software\Classes\d2mm\shell\open\command" ""
    ${If} $R7 == '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
      DeleteRegKey HKCU "Software\Classes\d2mm"
    ${EndIf}
  ${EndIf}
!macroend

; ---------- the way over from the Electron build ----------
;
; The last Electron release hands its update to this installer: electron-updater runs it as
; `setup.exe --updated /S --force-run`. The Electron build lives in
; %LOCALAPPDATA%\Programs\dota2-mod-manager under electron-builder's own keys (the GUID is
; electron-builder's uuid v5 of the appId com.thefleece.dota2modmanager). This build moves into
; that same folder, under the same exe name (tauri.conf.json mainBinaryName), so a taskbar pin, a
; shortcut and the sign-in entry keep pointing at a program that is there. userData stays where
; both builds keep it, %APPDATA%\Dota 2 Mod Manager.
!define D2MM_ELECTRON_KEY "Software\c6184bef-ce59-56eb-9f33-76c285700bc8"
!define D2MM_ELECTRON_UNINSTALL "Software\Microsoft\Windows\CurrentVersion\Uninstall\c6184bef-ce59-56eb-9f33-76c285700bc8"
!define D2MM_ELECTRON_UNINSTALLER "Uninstall Dota 2 Mod Manager.exe"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R0 HKCU "${D2MM_ELECTRON_KEY}" "InstallLocation"
  ${If} $R0 != ""
  ${AndIf} ${FileExists} "$R0\*.*"
    StrCpy $INSTDIR $R0
    SetOutPath $INSTDIR
    ; the Electron copy may still be in the tray: its files cannot go while it runs
    !insertmacro CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ; Its own uninstaller, told it is an update (build/installer.nsh asks nothing then and keeps
    ; the shortcuts and the app's data), run in place so it waits for it to finish.
    ${If} ${FileExists} "$R0\${D2MM_ELECTRON_UNINSTALLER}"
      ExecWait '"$R0\${D2MM_ELECTRON_UNINSTALLER}" /S --updated /KEEP_APP_DATA _?=$R0'
      Delete "$R0\${D2MM_ELECTRON_UNINSTALLER}"
    ${EndIf}
    DeleteRegKey HKCU "${D2MM_ELECTRON_UNINSTALL}"
    DeleteRegKey HKCU "${D2MM_ELECTRON_KEY}"
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; d2mm:// links (a preset, a mod) open this app, as Electron's setAsDefaultProtocolClient did
  WriteRegStr HKCU "Software\Classes\d2mm" "" "URL:d2mm"
  WriteRegStr HKCU "Software\Classes\d2mm" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\d2mm\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
  ; electron-updater asks the installer to start the app again once it is in place
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "--force-run" $R9
  ${IfNot} ${Errors}
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
  ${EndIf}
!macroend
