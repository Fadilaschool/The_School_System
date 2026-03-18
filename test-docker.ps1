# =============================================================================
# HR Platform - Docker Test Script
# Run from PowerShell in the project root folder:
#   .\test-docker.ps1
# =============================================================================

$ROOT = $PSScriptRoot

function OK   { param($msg) Write-Host "[PASS] $msg" -ForegroundColor Green }
function FAIL { param($msg) Write-Host "[FAIL] $msg" -ForegroundColor Red }
function INFO { param($msg) Write-Host "  --> $msg" -ForegroundColor Cyan }
function WARN { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function HEAD { param($msg) Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# =============================================================================
HEAD "STEP 1 - Checking Prerequisites"
# =============================================================================

# Check Docker engine is running
$dockerCheck = docker ps 2>&1
if ($LASTEXITCODE -ne 0) {
    FAIL "Docker Desktop engine is NOT running."
    Write-Host "  Please open Docker Desktop, wait for the green whale icon, then re-run." -ForegroundColor Yellow
    exit 1
}
OK "Docker Desktop engine is running"

# Check docker-compose.yml exists
if (Test-Path "$ROOT\docker-compose.yml") {
    OK "docker-compose.yml found"
} else {
    FAIL "docker-compose.yml not found. Make sure you are in the project root folder."
    exit 1
}

# Check .env exists
if (Test-Path "$ROOT\.env") {
    OK ".env file found"
} else {
    FAIL ".env file missing. Copy .env.example to .env and fill in your values."
    exit 1
}

# =============================================================================
HEAD "STEP 2 - Starting PostgreSQL Only (DB Test)"
# =============================================================================

INFO "Starting the postgres container..."
docker compose up -d postgres
if ($LASTEXITCODE -ne 0) {
    FAIL "Failed to start postgres container."
    exit 1
}

INFO "Waiting 10 seconds for postgres to be ready..."
Start-Sleep -Seconds 10

INFO "Testing database connection..."
docker compose exec -T postgres psql -U postgres -d hr_operations_platform -c "SELECT version();" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    OK "Database connection OK - hr_operations_platform is accessible"
} else {
    WARN "Database not ready yet or DB name mismatch. Check logs with: docker compose logs postgres"
}

# =============================================================================
HEAD "STEP 3 - Building All Docker Images (first time takes 5-10 minutes)"
# =============================================================================

INFO "Building all images in parallel..."
docker compose build --parallel
if ($LASTEXITCODE -ne 0) {
    FAIL "Build failed. See errors above."
    exit 1
}
OK "All Docker images built successfully"

# =============================================================================
HEAD "STEP 4 - Starting All Services"
# =============================================================================

INFO "Starting all 13 services in background..."
docker compose up -d
if ($LASTEXITCODE -ne 0) {
    FAIL "docker compose up failed."
    exit 1
}

INFO "Waiting 20 seconds for services to initialize..."
Start-Sleep -Seconds 20

# =============================================================================
HEAD "STEP 5 - Container Status"
# =============================================================================

docker compose ps

# =============================================================================
HEAD "STEP 6 - Health Check All Service Endpoints"
# =============================================================================

$services = @(
    [PSCustomObject]@{ Name="Auth Service          "; Url="http://localhost:3001/health" },
    [PSCustomObject]@{ Name="User Management       "; Url="http://localhost:3002/health" },
    [PSCustomObject]@{ Name="Department Service    "; Url="http://localhost:3003/health" },
    [PSCustomObject]@{ Name="Meeting Service       "; Url="http://localhost:3005/health" },
    [PSCustomObject]@{ Name="Payment Service       "; Url="http://localhost:3006/health" },
    [PSCustomObject]@{ Name="Notification Service  "; Url="http://localhost:3007/health" },
    [PSCustomObject]@{ Name="Attendance Service    "; Url="http://localhost:3000/health" },
    [PSCustomObject]@{ Name="Request Service       "; Url="http://localhost:3009/health" },
    [PSCustomObject]@{ Name="Timetable Service     "; Url="http://localhost:3011/health" },
    [PSCustomObject]@{ Name="Salary Service        "; Url="http://localhost:3010/health" },
    [PSCustomObject]@{ Name="HR Tasks Service      "; Url="http://localhost:3020/health" },
    [PSCustomObject]@{ Name="Frontend (Nginx)      "; Url="http://localhost:8080" }
)

$passed = 0
$failed = 0
$failedList = @()

foreach ($svc in $services) {
    try {
        $resp = Invoke-WebRequest -Uri $svc.Url -TimeoutSec 6 -UseBasicParsing -ErrorAction Stop
        if ($resp.StatusCode -lt 400) {
            OK "$($svc.Name) http $($resp.StatusCode) - $($svc.Url)"
            $passed++
        } else {
            FAIL "$($svc.Name) http $($resp.StatusCode) - $($svc.Url)"
            $failed++
            $failedList += $svc.Name.Trim()
        }
    } catch {
        FAIL "$($svc.Name) NOT RESPONDING - $($svc.Url)"
        $failed++
        $failedList += $svc.Name.Trim()
    }
}

# =============================================================================
HEAD "STEP 7 - Results"
# =============================================================================

Write-Host ""
Write-Host "  Services Passed : $passed" -ForegroundColor Green
Write-Host "  Services Failed : $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failed -gt 0) {
    WARN "Some services did not respond. Check their logs:"
    Write-Host ""
    foreach ($name in $failedList) {
        $logName = $name.ToLower().Replace(" ", "-")
        Write-Host "  docker compose logs -f $logName" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  Common fixes:" -ForegroundColor Cyan
    Write-Host "  - Service still starting? Wait 30s and re-run step 6 manually."
    Write-Host "  - DB connection error? Run: docker compose logs postgres"
    Write-Host "  - Port conflict? Run: docker compose ps to see what is running"
} else {
    OK "ALL SERVICES ARE RUNNING!"
    Write-Host ""
    Write-Host "  Open your browser: http://localhost:8080" -ForegroundColor Green
    Write-Host ""
}
