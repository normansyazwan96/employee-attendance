param(
  [ValidateRange(20, 250)]
  [int]$Users = 100
)

$ErrorActionPreference = "Stop"

$projectId = "delicate-unit-13004329"
$baseUrl = "https://employee-attendance-staging.floweaversolutions.workers.dev"

function New-SigningSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

function Set-StagingSigningSecret([string]$secret) {
  $secret | npx wrangler secret put JWT_SECRET --env staging | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Unable to rotate the staging signing secret" }
}

$connectionLines = & npx neonctl connection-string staging --project-id $projectId --database-name neondb 2>$null
$connectionString = $connectionLines | Where-Object { $_ -match '^postgres(ql)?://' } | Select-Object -Last 1
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($connectionString)) {
  throw "Unable to obtain the staging database connection string"
}

$testSecret = New-SigningSecret
$finalSecret = New-SigningSecret
$loadExitCode = 1

try {
  Set-StagingSigningSecret $testSecret
  Start-Sleep -Seconds 20
  $env:DATABASE_URL = $connectionString.Trim()
  $env:LOAD_TEST_BASE_URL = $baseUrl
  $env:LOAD_TEST_JWT_SECRET = $testSecret
  $env:LOAD_TEST_CONFIRM = "STAGING_ONLY"
  $env:LOAD_TEST_USERS = $Users.ToString()
  npm run load:staging-clock-actions
  $loadExitCode = $LASTEXITCODE
} finally {
  Set-StagingSigningSecret $finalSecret
  Remove-Item Env:DATABASE_URL, Env:LOAD_TEST_BASE_URL, Env:LOAD_TEST_JWT_SECRET, Env:LOAD_TEST_CONFIRM, Env:LOAD_TEST_USERS -ErrorAction SilentlyContinue
}

exit $loadExitCode
