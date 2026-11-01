@echo off
cd /d "%~dp0"
title Volna server
set "PATH=%~dp0tools\node;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto havenode
echo Node.js not found, downloading portable Node.js - one time only...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\get-node.ps1"
where node >nul 2>nul
if errorlevel 1 goto nonode
:havenode
if exist node_modules\express\package.json goto run
echo Installing dependencies - one time only...
call npm install --no-audit --no-fund --omit=dev
:run
start "" http://localhost:3000
set VOLNA_LOOP=1
:loop
node server.js --tunnel
if "%errorlevel%"=="75" goto loop
pause
exit /b
:nonode
echo Could not install Node.js. Install it from https://nodejs.org and run start.bat again.
start https://nodejs.org
pause
