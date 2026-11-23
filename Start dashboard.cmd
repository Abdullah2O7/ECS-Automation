@echo off
title ECS dashboard
rem Starts the ECS dashboard with a double-click - no VS Code, no commands to type. It gets the team's latest first, then
rem opens the dashboard in the browser. When the dashboard is restarted from its page (a teammate updated it), it starts
rem again here by itself. Close this window to stop the dashboard.

cd /d "%~dp0"
if not exist "package.json" goto noproject

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules\@playwright\test" goto nopackages

set DASHBOARD_LAUNCHER=1
set OPEN=

:start
echo.
echo   Starting the ECS dashboard - it opens in your browser in a moment.
echo   Keep this window open while you use it. Close it to stop the dashboard.
echo.
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src\scripts\team\latest-on-start.ts
if errorlevel 1 goto stopped
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src\scripts\dashboard\server.ts %OPEN%
rem 76: restart after installing the packages; 75: restart (the page in the browser comes back by itself)
if errorlevel 77 goto stopped
if errorlevel 76 goto install
if errorlevel 75 goto restart
goto stopped

:install
echo.
echo   Installing the packages your teammates added (about a minute) ...
call npm.cmd install --no-audit --no-fund

:restart
set OPEN=--no-open
goto start

:stopped
echo.
echo   The dashboard has stopped. If it says "port 4400 is already in use", the dashboard is already open
echo   in another window: use that one, or close it first.
pause
exit /b 0

:noproject
echo   This file must stay in the project folder (next to package.json).
pause
exit /b 1

:nonode
echo   Node.js is not installed (or not on this computer's path). Install Node.js LTS from nodejs.org, then try again.
pause
exit /b 1

:nopackages
echo   The project's packages are not installed yet: double-click Setup.cmd first.
pause
exit /b 1
