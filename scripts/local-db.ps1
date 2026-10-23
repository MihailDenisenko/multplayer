param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$localDir = Join-Path $projectDir '.local'
$dataDir = Join-Path $localDir 'postgres'
$binDir = 'C:\Program Files\PostgreSQL\15\bin'
$envPath = Join-Path $projectDir '.env.local'
if (!(Test-Path (Join-Path $binDir 'pg_ctl.exe'))) {
  throw 'PostgreSQL 15 binaries were not found. Set binDir in scripts/local-db.ps1.'
}
if ($Stop) {
  & "$binDir\pg_ctl.exe" -D $dataDir -m fast -w stop
  exit $LASTEXITCODE
}
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
if (!(Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  if (Test-Path $envPath) { throw '.env.local already exists; refusing to overwrite it.' }
  $password = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $passwordFile = Join-Path $localDir 'init-password.tmp'
  try {
    [IO.File]::WriteAllText($passwordFile, $password)
    & "$binDir\initdb.exe" -D $dataDir -U paper_game --pwfile=$passwordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed' }
    Add-Content -LiteralPath (Join-Path $dataDir 'postgresql.conf') -Value "`nport = 5433`nlisten_addresses = '127.0.0.1'"
    [IO.File]::WriteAllText($envPath, "DATABASE_URL=postgresql://paper_game:${password}@127.0.0.1:5433/paper_game`n")
  } finally {
    if (Test-Path $passwordFile) { Remove-Item -LiteralPath $passwordFile }
  }
}
& "$binDir\pg_ctl.exe" -D $dataDir status
if ($LASTEXITCODE -ne 0) {
  & "$binDir\pg_ctl.exe" -D $dataDir -l (Join-Path $localDir 'postgres.log') -w start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start; inspect .local/postgres.log' }
}
Push-Location $projectDir
try {
  @'
const { loadEnvConfig } = require('@next/env');
const { Client } = require('pg');
loadEnvConfig(process.cwd());
async function main() {
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/paper_game') {
    throw new Error('Expected the dedicated local paper_game database on port 5433');
  }
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'paper_game'");
    if (!result.rowCount) await client.query('CREATE DATABASE paper_game');
    console.log('Local paper_game database is ready on 127.0.0.1:5433');
  } finally { await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
'@ | node
  if ($LASTEXITCODE -ne 0) { throw 'Database setup failed' }
} finally { Pop-Location }
