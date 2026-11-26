@echo off
rem PULSEFRAME Studio: update, build and start. Double-click this file, or run it from a command window.
rem Written 2026-11-26; not yet run on Windows by anyone. If a step fails the window stays open with the message.
cd /d "%~dp0"
if exist "%~dp0.artifacts\speech\venv\Scripts\python.exe" if not defined PF_SPEECH_PYTHON set "PF_SPEECH_PYTHON=%~dp0.artifacts\speech\venv\Scripts\python.exe"
if exist "%~dp0.artifacts\speech\tts-venv\Scripts\python.exe" if not defined PF_VOICE_PYTHON set "PF_VOICE_PYTHON=%~dp0.artifacts\speech\tts-venv\Scripts\python.exe"
echo [1/4] git pull
call git pull --ff-only || goto failed
echo [2/4] pnpm install
call pnpm install || goto failed
echo [3/4] pnpm build
call pnpm build || goto failed
echo [4/4] pnpm start
echo Open the "Editor (owner)" link that appears below in Chrome. Ctrl+C in this window stops the editor.
if not defined PF_OPEN_BROWSER set "PF_OPEN_BROWSER=1"
call pnpm start
goto done
:failed
echo.
echo A step failed. Copy everything in this window and send it.
:done
pause
