resource "google_firestore_field" "pipeline_queue_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "pipeline_queue"
  field      = "ttl_at"

  ttl_config {}
}

resource "google_firestore_field" "pipeline_run_logs_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "logs"
  field      = "ttl_at"

  ttl_config {}
}

resource "google_firestore_field" "search_cache_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "search_cache"
  field      = "ttl_at"

  ttl_config {}
}

resource "google_firestore_field" "page_cache_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "page_cache"
  field      = "ttl_at"

  ttl_config {}
}

resource "google_firestore_field" "rate_limits_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "rate_limits"
  field      = "expires_at"

  ttl_config {}
}

# Raw analytics events written by races-api carry an `expires_at` timestamp so
# per-request rows age out instead of accumulating indefinitely.
resource "google_firestore_field" "analytics_events_ttl" {
  project    = var.project_id
  database   = "(default)"
  collection = "analytics_events"
  field      = "expires_at"

  ttl_config {}
}
