@echo off
rem VoxTTS Studio launcher: installs dependencies, builds the UI, starts the local
rem server and opens http://localhost:3000 in your default browser.
setlocal
cd /d "%~dp0"
if "%PORT%"=="" set PORT=3000
set URL=http://localhost:%PORT%

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18.18+ is required: https://nodejs.org
  pause
  exit /b 1
)

where python >nul 2>nul || where py >nul 2>nul || echo Note: Python 3.9+ was not found. Cloud features work; install Python to run local models.

if not exist node_modules (
  echo ==^> Installing dependencies
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :fail
)

echo ==^> Building the interface
call npm run build --silent
if errorlevel 1 goto :fail

rem Open the browser once the server answers, without blocking the server window.
start "" /b powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing '%URL%/api/settings' | Out-Null; Start-Process '%URL%'; break}catch{Start-Sleep -Milliseconds 500}}"

echo ==^> Starting VoxTTS Studio on %URL% (close this window to stop)
node server\index.js
goto :eof

:fail
echo Setup failed - see the messages above.
pause
exit /b 1
