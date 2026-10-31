@echo off
title Volna tunnel
where cloudflared >/dev/null 2>nul
if errorlevel 1 (
  echo cloudflared not found. Run in PowerShell:  winget install Cloudflare.cloudflared
  pause
  exit /b
)
echo Look for the https://....trycloudflare.com link below and send it to friends.
cloudflared tunnel --url http://localhost:3000
pause
