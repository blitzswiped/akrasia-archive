param(
  [switch]$Watch,
  [ValidateRange(5, 3600)]
  [int]$RefreshSeconds = 20,
  [ValidateRange(1024, 65535)]
  [int]$Port = 8765
)

$backupRoot = Join-Path $PSScriptRoot '..\bandlab downloading\BandLab Backup'
$statePath = Join-Path $backupRoot 'akrasia_analysis_state.json'

function Show-AnalyzerServiceProgress {
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status?limit=1" -TimeoutSec 2
  } catch {
    return $false
  }

  $counts = $status.counts
  $total = [int]$counts.queued + [int]$counts.running + [int]$counts.complete + [int]$counts.failed
  $processed = [int]$counts.complete + [int]$counts.failed
  $percent = if ($total) { [Math]::Round(($processed / $total) * 100, 1) } else { 0 }
  $barWidth = 34
  $filled = if ($total) { [Math]::Floor(($processed / $total) * $barWidth) } else { 0 }
  $bar = ('#' * $filled).PadRight($barWidth, '-')
  $current = $status.current

  Write-Host 'akrasia private analyzer' -ForegroundColor White
  Write-Host "[$bar] $percent%"
  Write-Host "service    $(if ($status.paused) { 'paused' } else { 'running' }) / $($status.mode)"
  Write-Host "processed  $processed / $total"
  Write-Host "queued     $([int]$counts.queued)"
  Write-Host "complete   $([int]$counts.complete)"
  Write-Host "failed     $([int]$counts.failed)"
  Write-Host "current    $(if ($current) { "$($current.project_title) / $($current.revision_number) / $($current.stage) / $([Math]::Round([double]$current.progress * 100))%" } else { '--' })"
  Write-Host "monitor    http://127.0.0.1:$Port/"
  return $true
}

function Get-CurrentProjectName([string]$ProjectId) {
  if ([string]::IsNullOrWhiteSpace($ProjectId)) { return '--' }
  $shortId = $ProjectId.Split('-')[0]
  $folder = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like "*[$shortId]*" -or $_.Name -like "*$shortId*" } |
    Select-Object -First 1
  if ($folder) { return $folder.Name }
  return $shortId
}

function Show-LyricProgress {
  if (Show-AnalyzerServiceProgress) { return }
  if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'No lyric-analysis state file exists yet.' -ForegroundColor Yellow
    return
  }

  try { $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
  catch {
    Write-Host 'The state file is being replaced. Try again in a moment.' -ForegroundColor Yellow
    return
  }

  $total = [int]$state.counts.revisions
  $cached = [int]$state.counts.skipped
  $newlyCompleted = [int]$state.counts.complete
  $failed = [int]$state.counts.failed
  $processed = [Math]::Min($total, $cached + $newlyCompleted + $failed)
  $remaining = [Math]::Max(0, $total - $processed)
  $percent = if ($total) { [Math]::Round(($processed / $total) * 100, 1) } else { 0 }
  $barWidth = 34
  $filled = if ($total) { [Math]::Floor(($processed / $total) * $barWidth) } else { 0 }
  $bar = ('#' * $filled).PadRight($barWidth, '-')
  $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like '*akrasia_enrichment.py*' }).Count -gt 0
  $project = Get-CurrentProjectName ([string]$state.current.projectId)
  $version = [string]$state.current.revisionNumber
  $updated = (Get-Item -LiteralPath $statePath).LastWriteTime

  Write-Host 'akrasia lyric analysis' -ForegroundColor White
  Write-Host "[$bar] $percent%"
  Write-Host "processed  $processed / $total"
  Write-Host "remaining  $remaining"
  Write-Host "cached     $cached previously completed"
  Write-Host "new        $newlyCompleted completed this run"
  Write-Host "failed     $failed"
  Write-Host "current    $project / $version"
  Write-Host "process    $(if ($running) { 'running' } else { 'not running' })"
  Write-Host "updated    $($updated.ToString('M/d/yyyy h:mm:ss tt'))"
}

do {
  if ($Watch) { Clear-Host }
  Show-LyricProgress
  if ($Watch) {
    Write-Host "`nrefreshing every $RefreshSeconds seconds / Ctrl+C to stop watching" -ForegroundColor DarkGray
    Start-Sleep -Seconds $RefreshSeconds
  }
} while ($Watch)
