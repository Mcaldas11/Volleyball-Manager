@echo off
rem Opens the virtual Android phone (a Pixel 7 on Android 15) to try the game on, and puts the
rem newest build of the game on it. Made by "npm run emulator" in mobile/ or a double click.
setlocal
for %%I in ("%USERPROFILE%\.android-build") do set "TOOLS=%%~sI"
set "ANDROID_HOME=%TOOLS%\sdk"
set "ANDROID_SDK_ROOT=%TOOLS%\sdk"
set "ANDROID_AVD_HOME=%TOOLS%\avd"
set "ADB=%TOOLS%\sdk\platform-tools\adb.exe"
set "APK=%~dp0..\release\volleyball-manager-0.2.0-android.apk"

echo A ligar o telemovel virtual... (a primeira vez demora um ou dois minutos)
start "" "%TOOLS%\sdk\emulator\emulator.exe" -avd VolleyballPixel7 -no-snapshot-save -no-boot-anim

rem Wait for the phone to finish starting up (the phone itself waits, in its own shell).
"%ADB%" wait-for-device shell "while [ \"$(getprop sys.boot_completed)\" != 1 ]; do sleep 1; done"

for %%F in ("%~dp0..\release\*-android.apk") do set "APK=%%F"
if exist "%APK%" (
  echo A instalar o jogo: %APK%
  "%ADB%" install -r "%APK%"
  "%ADB%" shell monkey -p com.miguelcaldas.volleyballmanager -c android.intent.category.LAUNCHER 1 >nul
) else (
  echo Nao encontrei o .apk em mobile\release. Corre "npm run apk" na pasta mobile primeiro.
)
echo Pronto. Podes fechar esta janela.
timeout /t 5 >nul
