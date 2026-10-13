@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
title Next Train - local server

set "PY=python"
where python >nul 2>nul || set "PY=py"
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^), then run start.bat again.
  goto fail
)

echo.
echo [1/3] Building the timetables from data\raw ...
%PY% scripts\build_data.py
if errorlevel 1 goto fail

echo.
echo [2/3] Checking alerts.json, overrides.json and sw-kill.json ...
%PY% scripts\validate_alerts.py
if errorlevel 1 goto fail

echo.
echo [3/3] Running the tests ...
%PY% -m unittest discover tests
if errorlevel 1 goto fail

if /i "%~1"=="lan" goto lan

echo.
echo All good. Opening http://localhost:8000 - keep this window open while you use the site.
echo Close this window ^(or press Ctrl+C^) to stop the server.
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8000"
%PY% -m http.server 8000 --directory public
goto served

:lan
set "IP="
for /f "delims=" %%i in ('%PY% scripts\lan_ip.py') do set "IP=%%i"
echo.
echo ============================================================
if defined IP (
  echo  This PC: %IP%
  echo  On your phone ^(same Wi-Fi^), open:  http://%IP%:8000
) else (
  echo  Could not find this PC's address. Run "ipconfig" and use the
  echo  IPv4 Address of your Wi-Fi adapter:  http://^<that address^>:8000
)
echo  On this PC you can also use:  http://localhost:8000
echo.
echo  If Windows asks, allow Python on PRIVATE networks only.
echo  Keep this window open; close it to stop the server.
echo ============================================================
%PY% -m http.server 8000 --bind 0.0.0.0 --directory public

:served
if errorlevel 1 (
  echo.
  echo The server could not start. Port 8000 may already be in use: close the other window running the site and try again.
  goto fail
)
exit /b 0

:fail
echo.
echo ============================================================
echo  Something needs fixing. Read the message above, correct the
echo  file it names, then double-click start.bat again.
echo ============================================================
pause
exit /b 1
