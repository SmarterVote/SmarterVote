resource "google_firestore_index" "pipeline_queue_status_created_at" {
  project    = var.project_id
  database   = "(default)"
  collection = "pipeline_queue"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "pipeline_runs_status_started_at" {
  project    = var.project_id
  database   = "(default)"
  collection = "pipeline_runs"

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "started_at"
    order      = "DESCENDING"
  }
}

# Worker poll (pipeline_client/worker.py): oldest-first FIFO per runner/status.
# The worker falls back to a client-side sort while this index is building.
resource "google_firestore_index" "pipeline_queue_runner_status_created_at" {
  project    = var.project_id
  database   = "(default)"
  collection = "pipeline_queue"

  fields {
    field_path = "runner"
    order      = "ASCENDING"
  }

  fields {
    field_path = "status"
    order      = "ASCENDING"
  }

  fields {
    field_path = "created_at"
    order      = "ASCENDING"
  }
}
