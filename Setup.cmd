@echo off
title ECS setup
rem The first time on a computer, after getting the project: installs what the tests need and creates your .env.
rem Double-click it; it can be run again at any time (it only does what is missing or out of date).

cd /d "%~dp0"
if not exist "package.json" goto noproject

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 goto oldnode

where git >nul 2>nul
if errorlevel 1 echo   Note: Git is not installed - Get latest and Share my work need it (git-scm.com, default options).

echo.
echo   1/3  Installing the project's packages (a few minutes) ...
call npm.cmd ci --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo   2/3  Installing the video tool the test reports use ...
call npx.cmd playwright install ffmpeg
if errorlevel 1 goto failed

echo.
if exist ".env" (
  echo   3/3  Your .env is already there - kept as it is.
  goto done
)
copy /y ".env.example" ".env" >nul
echo   3/3  Your .env was created. Notepad opens it now: fill in YOUR OWN back-office account
echo        (CMS_CONTENT_USERNAME and CMS_CONTENT_PASSWORD), save it and close Notepad.
start /wait notepad ".env"

:done
echo.
echo   Setup is done. From now on, double-click "Start dashboard.cmd" to work.
choice /c YN /m "  Start the dashboard now"
if errorlevel 2 exit /b 0
call "Start dashboard.cmd"
exit /b 0

:failed
echo.
echo   The setup stopped (see the red lines above). Check that the VPN and the internet connection are on, then run it again.
pause
exit /b 1

:noproject
echo   This file must stay in the project folder (next to package.json).
pause
exit /b 1

:nonode
echo   Node.js is not installed. Install Node.js LTS from nodejs.org (22.18 or newer), then run this again.
pause
exit /b 1

:oldnode
echo   This Node.js is too old: install Node.js LTS from nodejs.org (22.18 or newer), then run this again.
pause
exit /b 1
