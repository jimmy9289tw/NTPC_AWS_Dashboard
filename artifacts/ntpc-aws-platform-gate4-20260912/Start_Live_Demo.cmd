@echo off
powershell.exe -NoProfile -File "%~dp0Start_Live_Demo.ps1"
if errorlevel 1 pause
