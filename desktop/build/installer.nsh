; electron-builder uses the npm package name for a per-user one-click folder.
; Change only that folder; keep the application GUID, appId and update identity.
!undef APP_FILENAME
!define APP_FILENAME "Pockymoe"

; electron-builder normally prefers a preserved Start-menu link for relaunch.
; A link can still target another (older/test) install. Launch this install's
; executable directly; retain the user's shortcut choices and --updated handling.
!macro customInstall
  StrCpy $launchLink "$appExe"
!macroend
