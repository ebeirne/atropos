@echo off
rem Start Atropos and the trading agent on this machine (Windows), then open the agent page.
rem
rem   scripts\start-agent.cmd            both servers in minimized windows, then the agent page
rem   scripts\start-agent.cmd --quiet    the same without opening the page (for starting at login)
rem
rem Logs: data\atropos.log and services\intel\data\agent.log. Close the two windows to stop.
rem Keys come from .env (see .env.example). Without ANTHROPIC_API_KEY the agent collects evidence but
rem proposes nothing; without a linked brokerage it refuses to size a trade.
cd /d "%~dp0.."
if not exist "services\intel\.venv\Scripts\python.exe" (
  echo The agent's Python environment is missing. In services\intel run:
  echo   uv venv .venv ^&^& uv pip install -p .venv -r requirements.txt
  exit /b 1
)
if not exist "services\intel\data" mkdir "services\intel\data"
start "Atropos" /min cmd /c "npm start > data\atropos.log 2>&1"
start "Atropos agent" /min cmd /c "cd services\intel && .venv\Scripts\python.exe -m intel serve --every 60 > data\agent.log 2>&1"
if /i not "%~1"=="--quiet" (
  timeout /t 4 /nobreak > nul
  start "" http://127.0.0.1:4411/agent.html
)
