@echo off
title FordDiag OBD2
cd /d "%~dp0"
echo Pornire FordDiag OBD2...
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:8765/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8765
