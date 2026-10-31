@echo off
cd /d "%~dp0"
title Volna server
where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js not found. Install LTS from https://nodejs.org and run again.
  start https://nodejs.org
  pause
  exit /b
)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000
node server.js
pause
