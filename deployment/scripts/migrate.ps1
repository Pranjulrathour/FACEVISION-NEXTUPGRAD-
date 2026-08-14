#!/usr/bin/env pwsh
param([string]$MigrationFile = "001_init_schema.sql")

$DatabaseDir = Split-Path -Parent $PSScriptRoot
$DatabaseDir = Split-Path -Parent $DatabaseDir
$DatabaseDir = Join-Path $DatabaseDir "database"
$MigrationPath = Join-Path $DatabaseDir "migrations\$MigrationFile"

if (-not (Test-Path $MigrationPath)) {
    Write-Host "Migration file not found: $MigrationPath" -ForegroundColor Red
    exit 1
}

$env:PGPASSWORD = "facevision"
$Content = Get-Content -Raw $MigrationPath

Write-Host "Applying migration: $MigrationFile" -ForegroundColor Cyan
$result = $Content | psql -h localhost -U facevision -d facevision -v ON_ERROR_STOP=1 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Migration FAILED:" -ForegroundColor Red
    Write-Host $result
    exit 1
}

Write-Host "Migration applied successfully." -ForegroundColor Green
