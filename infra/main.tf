# SmarterVote Infrastructure - Main Configuration
# Infrastructure deployment for AI agent electoral analysis pipeline

terraform {
  required_version = ">= 1.0"

  # Remote state backend for consistency and locking
  backend "gcs" {
    bucket = "smartervote-terraform-state"
    prefix = "terraform/state"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "project" {
  project_id = var.project_id
}

# Common labels for all resources
locals {
  common_labels = {
    project     = "smartervote"
    environment = var.environment
    managed_by  = "terraform"
    version     = var.app_version != "" ? var.app_version : "unknown"
  }

  pipeline_labels = merge(local.common_labels, {
    component = "pipeline"
    service   = "race-processing"
  })

  api_labels = merge(local.common_labels, {
    component = "api"
  })

  storage_labels = merge(local.common_labels, {
    component = "storage"
  })
}

# Terraform state bucket (must be created first with local backend)
resource "google_storage_bucket" "terraform_state" {
  name          = "smartervote-terraform-state"
  location      = var.region
  force_destroy = false
  project       = var.project_id

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      num_newer_versions = 10
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  # Only ever expire NONCURRENT state versions. A bare `age = 365` condition also
  # matches the live object, so a state file nobody touched for a year would be
  # deleted outright.
  lifecycle_rule {
    condition {
      age        = 365
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  labels = local.storage_labels

  depends_on = [google_project_service.apis]
}

# Enable required GCP APIs for the project
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "storage.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudscheduler.googleapis.com",
    "containerregistry.googleapis.com",
    "artifactregistry.googleapis.com",
    "bigquery.googleapis.com",
    "iam.googleapis.com",
    "maps-backend.googleapis.com",
    "places.googleapis.com"
  ])

  project                    = var.project_id
  service                    = each.value
  disable_dependent_services = false
}

# Artifact Registry for enhanced container management (recommended over GCR)
resource "google_artifact_registry_repository" "smartervote" {
  location      = var.region
  repository_id = "smartervote-${var.environment}"
  description   = "SmarterVote container images for ${var.environment} environment"
  format        = "DOCKER"

  # Delete images older than 30 days, but always KEEP the 20 most recent versions
  # of each image (KEEP policies take precedence over DELETE). Rollback deploys a
  # previous commit SHA's image, so pruning to only 5 versions / 30 days could
  # leave no image for a SHA that is only a week or two old after busy weeks.
  cleanup_policies {
    id     = "keep-minimum-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  cleanup_policies {
    id     = "delete-old-versions"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30 days
    }
  }

  depends_on = [google_project_service.apis]
}

# Created only when billing_account_id is set (CI: GCP_BILLING_ACCOUNT_ID repo
# variable). Budgets are billing-account resources: the deploy identity needs
# roles/billing.costsManager on the billing account itself, which project
# Owner/Editor does not include. Grant that before setting the variable or the
# apply fails here.
resource "google_billing_budget" "budget" {
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "SmarterVote Project Budget - ${var.environment}"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "10" # $10 budget limit
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
}
