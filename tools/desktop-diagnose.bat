@echo off
rem Collect desktop / wallpaper-layer info into a txt on the Desktop. See desktop-diagnose.ps1.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop-diagnose.ps1" %*
pause
