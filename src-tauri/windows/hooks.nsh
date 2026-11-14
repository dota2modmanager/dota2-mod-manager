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
!macroend
