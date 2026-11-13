# Public bucket for the static live feeds (results-live.json, forecast-live.json).
#
# sv_data enforces public access prevention because it holds private drafts, so
# the feeds need their own bucket. It holds only two small, already-public
# files; the races API overwrites them whenever results are published.
# Objects carry `Cache-Control: public, max-age=30` (set by the writer).
resource "google_storage_bucket" "live_feeds" {
  name     = "${var.project_id}-live-feeds-${var.environment}"
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "inherited"
  force_destroy               = true # contents are regenerated on the next publish

  # Browsers on smarter.vote read the files cross-origin.
  cors {
    origin          = ["https://smarter.vote", "https://www.smarter.vote"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }

  labels = local.storage_labels

  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "live_feeds_public_read" {
  bucket = google_storage_bucket.live_feeds.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# objectAdmin (create + overwrite) is needed because each publish replaces the
# existing object. The bucket holds nothing else.
resource "google_storage_bucket_iam_member" "live_feeds_races_api_write" {
  bucket = google_storage_bucket.live_feeds.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.races_api.email}"
}

output "live_feeds_bucket" {
  description = "Public bucket for the static live feeds; set VITE_LIVE_FEEDS_URL to https://storage.googleapis.com/<this bucket>"
  value       = google_storage_bucket.live_feeds.name
}
