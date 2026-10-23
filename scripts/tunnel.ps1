param(
  [switch]$Stop,
  [string]$Target = $env:LOCALHOST_RUN_TARGET,
  [string]$Domain = $env:LOCALHOST_RUN_DOMAIN
)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$localDir = Join-Path $projectDir '.local'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
$statePath = Join-Path $localDir 'tunnel.json'
$stopPath = Join-Path $localDir 'tunnel.stop'
if ($Stop) { [IO.File]::WriteAllText($stopPath, 'stop'); exit 0 }
if ([string]::IsNullOrWhiteSpace($Target)) { $Target = 'nokey@localhost.run' }
if ($Target -notmatch '^(?:[a-zA-Z0-9._-]+@)?localhost\.run$') {
  throw 'LOCALHOST_RUN_TARGET must be localhost.run or a user@localhost.run target.'
}
if (![string]::IsNullOrWhiteSpace($Domain)) {
  $Domain = $Domain.Trim().ToLowerInvariant()
  if ($Domain -notmatch '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$' -or $Domain -notmatch '\.') {
    throw 'LOCALHOST_RUN_DOMAIN must be a valid hostname, for example game.example.com.'
  }
  if ($Target -eq 'nokey@localhost.run') {
    throw 'A custom domain requires an authenticated localhost.run account. Set LOCALHOST_RUN_TARGET=plan@localhost.run.'
  }
} elseif ($Target -eq 'nokey@localhost.run') {
  Write-Warning 'Anonymous free tunnels rotate their hostname. Use LOCALHOST_RUN_DOMAIN with a localhost.run custom-domain plan for a stable game address.'
} else {
  Write-Warning 'Authenticated free tunnels can live longer but may still rotate. Configure LOCALHOST_RUN_DOMAIN for a guaranteed stable address.'
}
$remoteForward = if ($Domain) { "${Domain}:80:127.0.0.1:3000" } else { '80:127.0.0.1:3000' }
Write-Host "Tunnel target: $Target"
if ($Domain) { Write-Host "Requested public address: https://$Domain" }
try { $lock = [IO.File]::Open((Join-Path $localDir 'tunnel.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { throw 'A tunnel supervisor is already running. Use npm.cmd run tunnel:stop first.' }
if (Test-Path $stopPath) { Remove-Item -LiteralPath $stopPath }
function Publish-State($status, $publicUrl, $processId) {
  $state = @{ status=$status; publicUrl=$publicUrl; checkedAt=[DateTime]::UtcNow.ToString('o'); processId=$processId; supervisorId=$PID }
  $temp = $statePath + '.tmp'
  [IO.File]::WriteAllText($temp, ($state | ConvertTo-Json -Compress))
  Move-Item -LiteralPath $temp -Destination $statePath -Force
}
function Test-Game($publicUrl) {
  try {
    $response = Invoke-WebRequest -Uri ($publicUrl + '/api/health') -UseBasicParsing -TimeoutSec 8 -Headers @{ 'Cache-Control'='no-cache' }
    return $response.StatusCode -eq 200 -and ($response.Content | ConvertFrom-Json).ok -eq $true
  } catch { return $false }
}
$tunnelProcess = $null
try {
  while (!(Test-Path $stopPath)) {
    Publish-State 'connecting' $null $null
    $attemptId = [Guid]::NewGuid().ToString('N')
    $log = Join-Path $localDir "ssh-$attemptId.log"
    $errorLog = Join-Path $localDir "ssh-$attemptId-error.log"
    $sshArgs = @('-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', 'UserKnownHostsFile=.local/known_hosts',
      '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes',
      '-R', $remoteForward, $Target)
    $tunnelProcess = Start-Process -FilePath 'ssh.exe' -ArgumentList $sshArgs -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $errorLog -PassThru
    try {
      $publicUrl = $null
      for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $tunnelProcess.Refresh()
        if ($tunnelProcess.HasExited -or (Test-Path $stopPath)) { break }
        if ($Domain -and $attempt -ge 1) { $publicUrl = "https://$Domain"; break }
        $output = Get-Content -LiteralPath $log -Raw -ErrorAction SilentlyContinue
        if ($output -match 'https://[a-zA-Z0-9.-]+\.lhr\.life') { $publicUrl=$Matches[0]; break }
        Start-Sleep -Seconds 1
      }
      if (!$publicUrl) { Write-Host 'No public URL received. Reconnecting...'; continue }
      $failures = 0
      while (!(Test-Path $stopPath)) {
        $tunnelProcess.Refresh()
        if ($tunnelProcess.HasExited) { break }
        if (Test-Game $publicUrl) {
          if ($failures -ne 0 -or !(Test-Path $statePath) -or ((Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json).publicUrl -ne $publicUrl)) {
            Write-Host "Game address: $publicUrl"
          }
          $failures = 0
          Publish-State 'ready' $publicUrl $tunnelProcess.Id
        } else {
          $failures++
          Publish-State 'connecting' $publicUrl $tunnelProcess.Id
          # A transient HTTP failure does not mean the SSH forward is dead.
          # Preserve the current session and let SSH keepalives decide when a reconnect is required.
          if ($failures -eq 1 -or ($failures % 6) -eq 0) {
            Write-Host "Public address health check failed ($failures attempt(s)). Keeping the existing tunnel..."
          }
        }
        for ($waitSecond = 0; $waitSecond -lt 10 -and !(Test-Path $stopPath); $waitSecond++) { Start-Sleep -Seconds 1 }
      }
    } finally {
      $tunnelProcess.Refresh()
      if (!$tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id }
      $tunnelProcess = $null
    }
    if (!(Test-Path $stopPath)) { Start-Sleep -Seconds 2 }
  }
} finally {
  if ($tunnelProcess) { $tunnelProcess.Refresh(); if (!$tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id } }
  Publish-State 'offline' $null $null
  $lock.Dispose()
}
