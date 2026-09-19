@echo off
REM ============================================================
REM  House of Ghouls - one-click launcher (Windows)
REM  Double-click this file to install (first time), start the
REM  server + client, and open the game in your browser.
REM  Close this window (or press Ctrl-C) to stop everything.
REM ============================================================
title House of Ghouls
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required and was not found.
  echo   Install the LTS version from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

node scripts\play.mjs

echo.
echo   House of Ghouls has stopped.
pause
