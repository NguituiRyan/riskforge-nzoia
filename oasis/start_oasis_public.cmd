@echo off
rem Double-click: run Oasis on this laptop for the live Risk Forge site (keep the window open).
wsl -d Ubuntu --cd "%~dp0" -- bash start_public.sh
pause
