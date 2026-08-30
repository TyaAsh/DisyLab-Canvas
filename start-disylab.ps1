$ErrorActionPreference = 'Stop'

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$localUrl = 'http://127.0.0.1:1420/'
$port = 1420
$logPath = Join-Path $projectPath '.disylab-dev.log'
$errorLogPath = Join-Path $projectPath '.disylab-dev-error.log'
$launcherMutex = [System.Threading.Mutex]::new($false, 'Local\DisyLab-1420-Launcher')
$hasLauncherLock = $false

function Show-DisyLabError([string]$message) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($message, 'DisyLab 启动器', 'OK', 'Error') | Out-Null
}

function Test-DisyLabReady {
  try {
    $response = Invoke-WebRequest -Uri $localUrl -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content.ToString() -match 'DisyLab'
  } catch {
    return $false
  }
}

function Stop-PortOccupant {
  $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    if ($listener.OwningProcess -and $listener.OwningProcess -ne $PID) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  if ($listeners) { Start-Sleep -Milliseconds 500 }
}

try {
  $hasLauncherLock = $launcherMutex.WaitOne([TimeSpan]::FromSeconds(75))
  if (-not $hasLauncherLock) {
    Show-DisyLabError '另一个 DisyLab 启动任务长时间未完成，请稍后重试。'
    exit 1
  }

  if (-not (Test-Path (Join-Path $projectPath 'node_modules'))) {
    Show-DisyLabError "项目依赖不存在，请先在项目目录运行 npm install。`n`n$projectPath"
    exit 1
  }

  if (-not (Test-DisyLabReady)) {
    Stop-PortOccupant
    Remove-Item -LiteralPath $logPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $errorLogPath -Force -ErrorAction SilentlyContinue

    $npmPath = (Get-Command npm.cmd -ErrorAction Stop).Source
    Start-Process `
      -FilePath $npmPath `
      -ArgumentList @('run', 'dev', '--', '--host', '127.0.0.1', '--port', '1420', '--strictPort') `
      -WorkingDirectory $projectPath `
      -WindowStyle Hidden `
      -RedirectStandardOutput $logPath `
      -RedirectStandardError $errorLogPath | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
      Start-Sleep -Milliseconds 500
      if (Test-DisyLabReady) {
        $ready = $true
        break
      }
    }

    if (-not $ready) {
      $details = if (Test-Path $errorLogPath) { (Get-Content -LiteralPath $errorLogPath -Tail 12 -ErrorAction SilentlyContinue) -join "`n" } else { '' }
      Show-DisyLabError "DisyLab 未能在 60 秒内启动。`n`n日志：$errorLogPath`n`n$details"
      exit 1
    }
  }

  # Use Explorer explicitly so a hidden PowerShell launcher does not swallow
  # the browser launch on Windows file associations.
  Start-Process -FilePath 'explorer.exe' -ArgumentList $localUrl
} catch {
  Show-DisyLabError "启动失败：$($_.Exception.Message)`n`n日志：$errorLogPath"
  exit 1
} finally {
  if ($hasLauncherLock) { $launcherMutex.ReleaseMutex() }
  $launcherMutex.Dispose()
}
