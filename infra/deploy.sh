#!/bin/bash

# SmarterVote Infrastructure Deployment Script

set -euo pipefail

# Usage: APP_VERSION=<verified commit SHA> ./deploy.sh   (or ./deploy.sh <sha>)
#
# The normal deploy path is the "Deploy Infrastructure" GitHub workflow, which
# applies only images CI built and scanned for a commit. This script exists for
# break-glass use and deploys the same immutable, SHA-tagged images: it never
# builds or pushes anything, and it refuses to run without an explicit version.
APP_VERSION="${1:-${APP_VERSION:-}}"
if [ -z "$APP_VERSION" ] || [ "$APP_VERSION" = "latest" ]; then
    echo "Error: an immutable app version is required."
    echo "Usage: APP_VERSION=<full commit SHA already published by CI> ./deploy.sh"
    echo "Prefer: GitHub Actions -> Deploy Infrastructure -> Run workflow (action=apply, deploy_sha=<sha>)"
    exit 1
fi

echo "SmarterVote Infrastructure Deployment"
echo "========================================"

# Check if secrets.tfvars exists
if [ ! -f "secrets.tfvars" ]; then
    echo "Error: secrets.tfvars file not found"
    echo "Please copy secrets.tfvars.example to secrets.tfvars and fill in your values"
    exit 1
fi

# Check if required tools are installed
command -v terraform >/dev/null 2>&1 || { echo "Error: terraform is required but not installed."; exit 1; }
command -v gcloud >/dev/null 2>&1 || { echo "Error: gcloud CLI is required but not installed."; exit 1; }

# Check if user is authenticated with gcloud
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "Error: Not authenticated with gcloud. Please run: gcloud auth login"
    exit 1
fi

echo "Prerequisites check passed"

# Get project ID and region from secrets.tfvars
PROJECT_ID=$(grep 'project_id' secrets.tfvars | cut -d'"' -f2 || true)
REGION=$(grep 'region' secrets.tfvars | cut -d'"' -f2 || true)
if [ -z "${REGION:-}" ]; then
    REGION="us-central1"
fi

echo "Project ID: $PROJECT_ID"
echo "Region: $REGION"
echo "App version: $APP_VERSION"

# Set gcloud project
echo "Setting gcloud project..."
gcloud config set project "$PROJECT_ID"

# Initialize Terraform
echo "Initializing Terraform..."
terraform init

# Validate configuration
echo "Validating Terraform configuration..."
terraform validate

# Plan deployment
echo "Planning deployment..."
terraform plan -var-file=secrets.tfvars -var "app_version=$APP_VERSION" -out=tfplan

# Ask for confirmation
read -p "Do you want to proceed with the deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    rm -f tfplan
    exit 0
fi

# Apply configuration
echo "Deploying infrastructure..."
terraform apply tfplan
rm -f tfplan

echo "Infrastructure deployment completed!"
echo ""
echo "Next steps:"
echo "1. Verify the deployed API: curl \"\$(terraform output -raw races_api_url)/health\""
echo "2. Queue a smoke race through the admin UI"
