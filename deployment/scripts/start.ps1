#!/usr/bin/env pwsh
param([string]$Env = "dev")

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ProjectRoot

Write-Host "Starting FaceVision ($Env environment)..." -ForegroundColor Green

Set-Location "$ProjectRoot\deployment\docker"

if ($Env -eq "dev") {
    docker compose -f docker-compose.dev.yml up -d
} else {
    docker compose up -d --build
}

Write-Host "Done! Services:"
Write-Host "  Frontend: http://localhost:3000"
Write-Host "  Backend:  http://localhost:8000/api/health"
Write-Host "  API Docs: http://localhost:8000/docs"
if ($Env -ne "dev") {
    Write-Host "  Nginx:   http://localhost"
}
