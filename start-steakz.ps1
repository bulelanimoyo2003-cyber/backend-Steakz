param(
  [ValidateSet('Launch', 'Backend', 'Frontend')]
  [string]$Mode = 'Launch'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if ($Mode -eq 'Backend') {
  Remove-Item Env:DATABASE_URL, Env:PORT, Env:NODE_ENV, Env:FRONTEND_URL, Env:JWT_SECRET, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  Set-Location -LiteralPath $root
  npm.cmd run dev
  exit $LASTEXITCODE
}

if ($Mode -eq 'Frontend') {
  Remove-Item Env:VITE_API_URL, Env:PORT, Env:NODE_ENV -ErrorAction SilentlyContinue
  Set-Location -LiteralPath (Join-Path $root 'frontend')
  npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
  exit $LASTEXITCODE
}

$envFile = Join-Path $root '.env'
$databaseLine = Get-Content -LiteralPath $envFile |
  Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
  Select-Object -First 1
if (-not $databaseLine) {
  throw 'The root .env must define DATABASE_URL before starting the presentation app.'
}

$databaseUrl = ($databaseLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
$databasePath = $null
if ($databaseUrl -match '^file:(?:/{0,3})([A-Za-z]:[/\\].+)$') {
  $databasePath = $Matches[1].Replace('/', '\')
} elseif ($databaseUrl -match '^file:([^?]+)$') {
  $relativePath = $Matches[1].Replace('/', '\')
  if ([IO.Path]::IsPathRooted($relativePath)) {
    throw 'The root .env DATABASE_URL must be a local SQLite file URL.'
  }
  $databasePath = Join-Path (Join-Path $root 'prisma') $relativePath
} else {
  throw 'The root .env DATABASE_URL must be a local SQLite file URL.'
}
$configuredDatabasePath = [IO.Path]::GetFullPath($databasePath)
$expectedDatabasePath = [IO.Path]::GetFullPath((Join-Path $root 'backend\prisma\dev.db'))
if (-not [string]::Equals($configuredDatabasePath, $expectedDatabasePath, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'The root .env DATABASE_URL does not point to this project''s persistent presentation database; no services were started.'
}
if (-not (Test-Path -LiteralPath $expectedDatabasePath -PathType Leaf)) {
  throw 'The configured presentation database does not exist; no database was created and no services were started.'
}

foreach ($port in @(3001, 5173)) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
  if ($listeners.Count -gt 0) {
    $owners = ($listeners | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    throw "Port $port is already occupied by process ID(s) $owners. No services were started; inspect and stop the intended old app process, then retry."
  }
}

$scriptPath = "`"$PSCommandPath`""
$backendArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Backend"
$frontendArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Frontend"
$backendWindow = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList $backendArgs -PassThru

$backendReady = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
  Start-Sleep -Seconds 1
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { continue }
  $owner = [int]$listeners[0].OwningProcess
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue
  while ($process -and [int]$process.ProcessId -ne $backendWindow.Id) {
    $parentId = [int]$process.ParentProcessId
    if ($parentId -eq 0 -or $parentId -eq [int]$process.ProcessId) { $process = $null; break }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
  }
  if ($process) {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2
      $backendReady = $health.status -eq 'ok'
    } catch {
      $backendReady = $false
    }
    if ($backendReady) { break }
  }
  throw "Port 3001 was claimed by an unexpected process (PID $owner); the presentation backend was not verified. Inspect the backend console."
}
if (-not $backendReady) {
  throw 'The project backend did not become healthy on port 3001. Inspect its console; no frontend was started.'
}
$backendOwner = $owner

$frontendWindow = Start-Process -FilePath 'powershell.exe' -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList $frontendArgs -PassThru
$frontendReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  Start-Sleep -Seconds 1
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { continue }
  $owner = [int]$listeners[0].OwningProcess
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue
  while ($process -and [int]$process.ProcessId -ne $frontendWindow.Id) {
    $parentId = [int]$process.ParentProcessId
    if ($parentId -eq 0 -or $parentId -eq [int]$process.ProcessId) { $process = $null; break }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
  }
  if ($process) {
    try {
      $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5173' -TimeoutSec 2
      $frontendReady = [int]$page.StatusCode -eq 200
    } catch {
      $frontendReady = $false
    }
    if ($frontendReady) { break }
  }
  throw "Port 5173 was claimed by an unexpected process (PID $owner); the presentation frontend was not verified. Inspect the frontend console."
}
if (-not $frontendReady) {
  throw 'The project frontend did not become healthy on port 5173. Inspect its console.'
}

Write-Output "Presentation API verified at http://127.0.0.1:3001 (PID $backendOwner)."
Write-Output "Presentation frontend verified at http://127.0.0.1:5173 (PID $($listeners[0].OwningProcess))."
Write-Output 'Both service consoles remain open. The root .env database and project startup commands are in use.'
