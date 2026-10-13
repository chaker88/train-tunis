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
echo [2/3] Checking alerts.json and overrides.json ...
%PY% scripts\validate_alerts.py
if errorlevel 1 goto fail

echo.
echo [3/3] Running the tests ...
%PY% -m unittest discover tests
if errorlevel 1 goto fail

echo.
echo All good. Opening http://localhost:8000 - keep this window open while you use the site.
echo Close this window ^(or press Ctrl+C^) to stop the server.
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8000"
%PY% -m http.server 8000 --directory public
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
