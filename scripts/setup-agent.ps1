# Sets up Atropos and its trading agent on this Windows computer, start to finish:
#   1. installs what's missing (Git, Node.js, uv) with winget
#   2. gets the code into C:\atropos, or updates it if it's already there
#   3. installs the agent's Python packages and Atropos's Node packages
#   4. asks for your keys and writes them to C:\atropos\.env, on this computer only
#   5. starts both at login, starts them now, and opens the agent page so you can link Fidelity
#
# Run it with one line in PowerShell (it's safe to run again: it updates the code and keeps your keys):
#   irm https://raw.githubusercontent.com/ebeirne/atropos/main/scripts/setup-agent.ps1 | iex
#
# Optional, set before running:  $env:ATROPOS_DIR = "D:\atropos"   (somewhere else; keep the path short)
#                                $env:ATROPOS_NO_STARTUP = "1"     (don't start it at login)

$ErrorActionPreference = 'Stop'
$Dir = if ($env:ATROPOS_DIR) { $env:ATROPOS_DIR } else { 'C:\atropos' }
$Repo = 'https://github.com/ebeirne/atropos.git'

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
# run a program; stop with its name if it fails (native programs don't throw on their own)
function Run($what) {
  $exe, $rest = $args
  & $exe @rest
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit code $LASTEXITCODE)." }
}
function Need($cmd, $id, $name) {
  if (Have $cmd) { Write-Host "$name is installed."; return }
  if (-not (Have 'winget')) { throw "$name is missing and winget isn't available to install it. Install $name, then run this again." }
  Write-Host "Installing $name (winget may ask you to accept its terms)..."
  winget install --id $id -e --silent
  RefreshPath
  if (-not (Have $cmd)) { throw "$name was installed but this window can't see it yet. Close PowerShell, open a new one, and run this again." }
}

# ---------------------------------------------------------------- 1. tools
Step 'Checking the tools it needs'
Need 'git' 'Git.Git' 'Git'
Need 'node' 'OpenJS.NodeJS.LTS' 'Node.js'
Need 'uv' 'astral-sh.uv' 'uv (it installs the right Python by itself)'

# ----------------------------------------------------------------- 2. code
Step "Getting the code into $Dir"
if (Test-Path (Join-Path $Dir '.git')) {
  Run 'Updating the code' git -C $Dir pull --ff-only
} else {
  Run 'Downloading the code' git clone $Repo $Dir
}

# ------------------------------------------------------------- 3. packages
Step 'Installing the agent (Python)'
Push-Location (Join-Path $Dir 'services\intel')
try {
  if (-not (Test-Path '.venv\Scripts\python.exe')) { Run 'Creating the Python environment' uv venv .venv --python 3.12 }
  Run 'Installing Python packages' uv pip install -p .venv\Scripts\python.exe -r requirements.txt
} finally { Pop-Location }

Step 'Installing Atropos (Node.js)'
Push-Location $Dir
try { Run 'Installing Node packages' npm install --no-audit --no-fund } finally { Pop-Location }

# ----------------------------------------------------------------- 4. keys
Step "Your keys (they stay in $Dir\.env, on this computer only)"
$envFile = Join-Path $Dir '.env'
if (-not (Test-Path $envFile)) { Copy-Item (Join-Path $Dir '.env.example') $envFile }

function Get-EnvValue($key) {
  foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    if ($line -match "^$key=(.*)$") { return $Matches[1].Trim().Trim('"') }
  }
  return ''
}
function Set-EnvValue($key, $value) {
  $lines = [Collections.Generic.List[string]]([IO.File]::ReadAllLines($envFile))
  $at = -1
  for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match "^$key=") { $at = $i; break } }
  if ($at -ge 0) { $lines[$at] = "$key=$value" } else { $lines.Add("$key=$value") }
  [IO.File]::WriteAllLines($envFile, $lines)   # UTF-8 without a BOM
}
function Ask($key, $prompt, [switch]$Secret, [string]$Wrap = '') {
  if (Get-EnvValue $key) { Write-Host "$key is already set."; return }
  if ($Secret) {
    $secure = Read-Host $prompt -AsSecureString
    $value = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  } else { $value = Read-Host $prompt }
  $value = $value.Trim()
  if (-not $value) { Write-Host "Skipped $key; run this again to add it." -ForegroundColor Yellow; return }
  if ($Wrap) { $value = '"' + ($Wrap -f $value) + '"' }
  Set-EnvValue $key $value
}
Write-Host 'Paste each one and press Enter (keys are hidden as you type). See SETUP-AGENT.md for where to get them.'
Ask 'ANTHROPIC_API_KEY' 'Claude API key (console.anthropic.com, API keys)' -Secret
Ask 'SNAPTRADE_CLIENT_ID' 'SnapTrade client ID (dashboard.snaptrade.com, personal keys)'
Ask 'SNAPTRADE_CONSUMER_KEY' 'SnapTrade consumer key' -Secret
Ask 'SEC_USER_AGENT' 'Your name and email, for the SEC (e.g. Jane Doe jane@example.com)' -Wrap 'Atropos research {0}'

# ------------------------------------------------------- 5. start it, now and at login
$starter = Join-Path $Dir 'scripts\start-agent.cmd'
if ($env:ATROPOS_NO_STARTUP -ne '1') {
  Step 'Starting it at login'
  $lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Atropos agent.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = Join-Path $env:WINDIR 'System32\cmd.exe'
  $s.Arguments = '/c "' + $starter + '" --quiet'
  $s.WorkingDirectory = $Dir
  $s.WindowStyle = 7   # minimized
  $s.Description = 'Starts Atropos and its trading agent at login'
  $s.Save()
  Write-Host "Added $lnk (delete it to stop starting at login)."
}

Step 'Starting it now'
foreach ($port in 4411, 8002) {
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "Something is already running on port $port; if it's an older Atropos, close its window and run this again." -ForegroundColor Yellow
  }
}
Start-Process -FilePath (Join-Path $env:WINDIR 'System32\cmd.exe') -ArgumentList ('/c "' + $starter + '" --quiet') -WindowStyle Minimized
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 2
  try { $ok = (Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4411/api/intel/health' -TimeoutSec 5).StatusCode -eq 200 } catch { }
}
if (-not $ok) { throw "It didn't come up. Look at $Dir\data\atropos.log and $Dir\services\intel\data\agent.log." }
Start-Process 'http://127.0.0.1:4411/agent.html'

Write-Host ''
Write-Host 'Done. The agent page is open in your browser:' -ForegroundColor Green
Write-Host '  1. Click Link Fidelity, sign in to Fidelity, and allow read-only access.'
Write-Host '  2. That''s it. It checks the news every hour; trades it wants to make wait on that page for you.'
Write-Host '     Approved trades become a checklist you place in Fidelity yourself.'
Write-Host "  Page: http://127.0.0.1:4411/agent.html   Logs: $Dir\services\intel\data\agent.log"
