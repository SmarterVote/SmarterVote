# Google Cloud Storage bucket for sv-data
resource "google_storage_bucket" "sv_data" {
  name     = "${var.project_id}-sv-data-${var.environment}"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true

  # The bucket holds private drafts alongside published data. Nothing reads it
  # anonymously: the public site is built from copies the Cloudflare deploy
  # workflow fetches with the deploy identity, and the races API reads it with
  # its own service account. Enforced prevention blocks any future allUsers /
  # allAuthenticatedUsers grant (which would also expose drafts/). Serve
  # public static data from a separate bucket if VITE_PUBLIC_DATA_URL is ever
  # needed. No CORS policy for the same reason: no browser reads this bucket.
  public_access_prevention = "enforced"

  # The deployed environment is named "dev", so the previous
  # `environment == "prod"` test left force_destroy on for the only real data
  # bucket. Key it on the protection flag alone.
  force_destroy = !var.prevent_destroy_prod

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age            = 90
      matches_prefix = ["retired/"]
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age                   = 60
      matches_storage_class = ["STANDARD"]
      matches_prefix        = ["retired/"]
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age            = 30
      matches_prefix = ["artifacts/"]
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age            = 7
      matches_prefix = ["checkpoints/"]
    }
    action {
      type = "Delete"
    }
  }

  # Prevent accidental deletion and ignore certain changes
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      # Ignore changes to labels that might be managed externally
      labels,
    ]
  }

  labels = local.storage_labels

  depends_on = [google_project_service.apis]
}

# Create folder structure for published data
resource "google_storage_bucket_object" "folders" {
  for_each = toset([
    "races/",
    "drafts/",
    "retired/",
    "artifacts/",
    "checkpoints/",
  ])

  name    = each.value
  bucket  = google_storage_bucket.sv_data.name
  content = " " # Empty content to create folder structure
}
