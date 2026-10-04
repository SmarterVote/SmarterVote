# SmarterVote Infrastructure Deployment Script (PowerShell)
#
# Usage: .\deploy.ps1 -AppVersion <verified commit SHA>   (or set $env:APP_VERSION)
#
# The normal deploy path is the "Deploy Infrastructure" GitHub workflow, which
# applies only images CI built and scanned for a commit. This script is for
# break-glass use and deploys the same immutable, SHA-tagged images; it never
# builds or pushes anything and refuses to run without an explicit version.
param(
    [string]$AppVersion = $env:APP_VERSION
)

if ([string]::IsNullOrWhiteSpace($AppVersion) -or $AppVersion -eq "latest") {
    Write-Host "Error: an immutable app version is required." -ForegroundColor Red
    Write-Host "Usage: .\deploy.ps1 -AppVersion <full commit SHA already published by CI>" -ForegroundColor Yellow
    Write-Host "Prefer: GitHub Actions -> Deploy Infrastructure -> Run workflow (action=apply, deploy_sha=<sha>)" -ForegroundColor Yellow
    exit 1
}

Write-Host "SmarterVote Infrastructure Deployment" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

# Check if secrets.tfvars exists
if (!(Test-Path "secrets.tfvars")) {
    Write-Host "Error: secrets.tfvars file not found" -ForegroundColor Red
    Write-Host "Please copy secrets.tfvars.example to secrets.tfvars and fill in your values" -ForegroundColor Yellow
    exit 1
}

# Check if required tools are installed
try {
    terraform --version | Out-Null
} catch {
    Write-Host "Error: terraform is required but not installed." -ForegroundColor Red
    exit 1
}

try {
    gcloud --version | Out-Null
} catch {
    Write-Host "Error: gcloud CLI is required but not installed." -ForegroundColor Red
    exit 1
}

# Check if user is authenticated with gcloud
$activeAccount = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null
if ([string]::IsNullOrEmpty($activeAccount)) {
    Write-Host "Error: Not authenticated with gcloud. Please run: gcloud auth login" -ForegroundColor Red
    exit 1
}

Write-Host "Prerequisites check passed" -ForegroundColor Green

# Get project ID from secrets.tfvars
$projectId = (Get-Content secrets.tfvars | Where-Object { $_ -match 'project_id' } | ForEach-Object { ($_ -split '"')[1] })
$region = (Get-Content secrets.tfvars | Where-Object { $_ -match 'region' } | ForEach-Object { ($_ -split '"')[1] })
if ([string]::IsNullOrEmpty($region)) { $region = "us-central1" }

Write-Host "Project ID: $projectId" -ForegroundColor Cyan
Write-Host "Region: $region" -ForegroundColor Cyan
Write-Host "App version: $AppVersion" -ForegroundColor Cyan

# Set gcloud project
Write-Host "Setting gcloud project..." -ForegroundColor Yellow
gcloud config set project $projectId

# Initialize Terraform
Write-Host "Initializing Terraform..." -ForegroundColor Yellow
terraform init

# Validate configuration
Write-Host "Validating Terraform configuration..." -ForegroundColor Yellow
terraform validate

# Plan deployment
Write-Host "Planning deployment..." -ForegroundColor Yellow
terraform plan -var-file=secrets.tfvars -var "app_version=$AppVersion" -out=tfplan

# Ask for confirmation
$confirmation = Read-Host "Do you want to proceed with the deployment? (y/N)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Host "Deployment cancelled" -ForegroundColor Red
    Remove-Item -ErrorAction SilentlyContinue tfplan
    exit 0
}

# Apply configuration
Write-Host "Deploying infrastructure..." -ForegroundColor Green
terraform apply tfplan
Remove-Item -ErrorAction SilentlyContinue tfplan

Write-Host "Infrastructure deployment completed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Verify the deployed API: curl `"$(terraform output -raw races_api_url)/health`"" -ForegroundColor White
Write-Host "2. Queue a smoke race through the admin UI" -ForegroundColor White
