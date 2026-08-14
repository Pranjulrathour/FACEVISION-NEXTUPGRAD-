#!/usr/bin/env pwsh
param([string]$Env = "dev")

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ProjectRoot
Set-Location "$ProjectRoot\deployment\docker"

Write-Host "Stopping FaceVision ($Env environment)..." -ForegroundColor Yellow

if ($Env -eq "dev") {
    docker compose -f docker-compose.dev.yml down
} else {
    docker compose down
}

Write-Host "Services stopped."
