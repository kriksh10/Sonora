@echo off
setlocal DisableDelayedExpansion
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ then reopen this file.
  pause
  exit /b 1
)
node "%~dp0artifacts\sonora-ai\desktop\build-windows.cjs"
set "BUILD_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %BUILD_RESULT%
