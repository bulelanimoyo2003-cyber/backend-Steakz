param(
  [ValidateSet('Launch', 'Backend', 'Frontend')]
  [string]$Mode = 'Launch'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Get-PresentationDatabasePath {
  $envFile = Join-Path $root '.env'
  $databaseLine = Get-Content -LiteralPath $envFile |
    Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } |
    Select-Object -First 1
  if (-not $databaseLine) {
    throw 'The root .env must define DATABASE_URL before starting the presentation app.'
  }

  $databaseUrl = ($databaseLine -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
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
  return $expectedDatabasePath
}

function Test-ManagedServiceProcess {
  param(
    [int]$ProcessId,
    [ValidateSet('Backend', 'Frontend')]
    [string]$ServiceMode
  )

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process -or $process.Name -ne 'node.exe') { return $false }
  $commandLine = $process.CommandLine.Replace('/', '\')
  if ($ServiceMode -eq 'Backend') {
    $servicePath = Join-Path $root 'node_modules\tsx\dist\preflight.cjs'
    if ($commandLine.IndexOf($servicePath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $commandLine -notmatch '\bsrc[\\/]index\.ts\b') {
      return $false
    }
  } else {
    $servicePath = Join-Path $root 'frontend\node_modules'
    if ($commandLine.IndexOf($servicePath, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or $commandLine -notmatch 'vite[\\/]bin[\\/]vite\.js') {
      return $false
    }
  }

  $parentId = [int]$process.ParentProcessId
  for ($depth = 0; $depth -lt 16 -and $parentId -gt 0; $depth++) {
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if (-not $parent) { return $false }
    if ($parent.Name -match '^(powershell|pwsh)\.exe$' -and
        $parent.CommandLine -match '(?i)start-steakz\.ps1' -and
        $parent.CommandLine -match "(?i)-Mode\s+$ServiceMode(?:\s|$)") {
      return $true
    }
    if ([int]$parent.ParentProcessId -eq $parentId) { return $false }
    $parentId = [int]$parent.ParentProcessId
  }
  return $false
}

function Get-ManagedServiceListener {
  param(
    [int]$Port,
    [ValidateSet('Backend', 'Frontend')]
    [string]$ServiceMode
  )

  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($listeners.Count -eq 0) { return $null }
  $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($owner in $owners) {
    if (-not (Test-ManagedServiceProcess -ProcessId ([int]$owner) -ServiceMode $ServiceMode)) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue
      $name = if ($process) { $process.Name } else { 'exited process' }
      throw "Port $Port is occupied by $name PID $owner, which is not a verified $ServiceMode service from this checkout. If it is a stale Steakz terminal, stop it with Ctrl+C in that terminal; do not stop an unrelated process."
    }
  }
  return [int]$owners[0]
}

function Test-BackendHealth {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/api/health' -TimeoutSec 2
    return $health.status -eq 'ok'
  } catch {
    return $false
  }
}

function Test-FrontendHealth {
  try {
    $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2
    return [int]$page.StatusCode -eq 200
  } catch {
    return $false
  }
}

if ($Mode -eq 'Backend') {
  Remove-Item Env:DATABASE_URL, Env:PORT, Env:NODE_ENV, Env:FRONTEND_URL, Env:JWT_SECRET, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $databasePath = Get-PresentationDatabasePath
  $backendOwner = Get-ManagedServiceListener -Port 3001 -ServiceMode Backend
  if ($null -ne $backendOwner) {
    if (-not (Test-BackendHealth)) {
      throw "The verified local backend PID $backendOwner owns port 3001 but is not healthy. Inspect its terminal; no process was stopped."
    }
    Write-Output "Local SQLite API is already healthy on port 3001 (PID $backendOwner), using $databasePath."
    exit 0
  }
  Set-Location -LiteralPath $root
  npm.cmd run dev:api
  exit $LASTEXITCODE
}

if ($Mode -eq 'Frontend') {
  Remove-Item Env:VITE_API_URL, Env:PORT, Env:NODE_ENV -ErrorAction SilentlyContinue
  $frontendOwner = Get-ManagedServiceListener -Port 5173 -ServiceMode Frontend
  if ($null -ne $frontendOwner) {
    if (-not (Test-FrontendHealth)) {
      throw "The verified local frontend PID $frontendOwner owns port 5173 but is not healthy. Inspect its terminal; no process was stopped."
    }
    Write-Output "Local frontend is already healthy at http://127.0.0.1:5173 (PID $frontendOwner)."
    if (Test-BackendHealth) {
      Write-Output 'The frontend API proxy is reaching the healthy local API on port 3001.'
    } else {
      Write-Warning 'The frontend is running, but the API proxy is not healthy on port 3001. Start the Backend terminal.'
    }
    exit 0
  }
  Set-Location -LiteralPath (Join-Path $root 'frontend')
  npm.cmd exec -- vite --host 127.0.0.1 --port 5173 --strictPort
  exit $LASTEXITCODE
}

$databasePath = Get-PresentationDatabasePath
$backendOwner = Get-ManagedServiceListener -Port 3001 -ServiceMode Backend
if ($null -ne $backendOwner -and -not (Test-BackendHealth)) {
  throw "The verified local backend PID $backendOwner owns port 3001 but is not healthy. Inspect its terminal; no process was stopped."
}
$frontendOwner = Get-ManagedServiceListener -Port 5173 -ServiceMode Frontend
if ($null -ne $frontendOwner -and -not (Test-FrontendHealth)) {
  throw "The verified local frontend PID $frontendOwner owns port 5173 but is not healthy. Inspect its terminal; no process was stopped."
}

$scriptPath = "`"$PSCommandPath`""
$backendArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Backend"
$frontendArgs = "-NoExit -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Mode Frontend"
$backendWindow = $null
if ($null -eq $backendOwner) {
  $backendWindow = Start-Process -FilePath 'powershell.exe' -WorkingDirectory $root -ArgumentList $backendArgs -PassThru
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 1
    $backendOwner = Get-ManagedServiceListener -Port 3001 -ServiceMode Backend
    if ($null -eq $backendOwner) { continue }
    if (Test-BackendHealth) { break }
    throw "The local backend process on port 3001 did not become healthy. Inspect its console; no other process was stopped."
  }
  if ($null -eq $backendOwner) {
    throw 'The project backend did not become healthy on port 3001. Inspect its console; no frontend was started.'
  }
}

$frontendWindow = $null
if ($null -eq $frontendOwner) {
  $frontendWindow = Start-Process -FilePath 'powershell.exe' -WorkingDirectory (Join-Path $root 'frontend') -ArgumentList $frontendArgs -PassThru
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    $frontendOwner = Get-ManagedServiceListener -Port 5173 -ServiceMode Frontend
    if ($null -eq $frontendOwner) { continue }
    if (Test-FrontendHealth) { break }
    throw "The local frontend process on port 5173 did not become healthy. Inspect its console; no other process was stopped."
  }
  if ($null -eq $frontendOwner) {
    throw 'The project frontend did not become healthy on port 5173. Inspect its console.'
  }
}

Write-Output "Presentation API verified at http://127.0.0.1:3001 (PID $backendOwner)."
Write-Output "Presentation frontend verified at http://127.0.0.1:5173 (PID $frontendOwner)."
Write-Output "Database verified: $databasePath."
if ($null -eq $backendWindow -and $null -eq $frontendWindow) {
  Write-Output 'Both healthy local services were reused.'
} else {
  Write-Output 'Already-running services were reused; newly started service consoles remain open.'
}
