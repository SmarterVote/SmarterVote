# One-shot Cloud Run Job for durable race processing. Each execution receives a
# QUEUE_ITEM_ID override from races-api and runs the shared pipeline worker once.
resource "google_service_account" "pipeline_job" {
  project      = var.project_id
  account_id   = "pipeline-job-${var.environment}"
  display_name = "SmarterVote Pipeline Job SA (${var.environment})"
}

resource "google_project_iam_member" "pipeline_job_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.pipeline_job.email}"
}

# Data-bucket access is split into bucket-wide read and prefix-scoped write.
#
# This was an unconditional bucket-wide `roles/storage.objectAdmin`, which let
# the job overwrite or delete published `races/*.json` and the public
# `races/summaries.json` index — publishing is an explicit admin action that
# only races-api performs, so a worker bug or a prompt-injection path should
# never be able to reach them.
#
# What the worker actually touches (pipeline_client/ + shared/, GCP mode):
#   READS   drafts/, races/ (baseline + catalog hydration), checkpoints/
#           (continuation handoff), artifacts/ — and lists drafts/, races/,
#           artifacts/.
#   WRITES  drafts/<race>.json       AgentHandler._upload_to_gcs (overwrite)
#           retired/<race>/<ts>.json AgentHandler._archive_gcs_version (copy)
#           checkpoints/<run>.json   handoff checkpoint in AgentHandler
#           artifacts/<id>.json      GCPStorageBackend.save_artifact
#   (GCPStorageBackend.save_race_json -> races/ and save_web_content ->
#   <race>/<kind>/ exist but have no callers; they are intentionally not
#   granted.) No GCS deletes; overwriting drafts/ needs objects.delete, which
#   objectAdmin carries within the condition.
#
# Bucket IAM Conditions require uniform bucket-level access, which
# google_storage_bucket.sv_data sets. objects.list is checked against the
# bucket (not an object), so the conditional grant cannot provide it; the
# unconditional objectViewer below does.
#
# Apply ordering: this keeps the original resource address and uses
# create_before_destroy, so the new conditional binding (and, via depends_on,
# the viewer binding) exists before the old unconditional one is removed. IAM
# propagation is still eventual, so a job writing during the apply could see a
# brief 403; prefer applying with no runner="cloud_run" runs in flight. The
# local Docker worker uses developer ADC and is unaffected.
locals {
  pipeline_job_write_prefixes = ["drafts/", "retired/", "checkpoints/", "artifacts/"]
}

resource "google_storage_bucket_iam_member" "pipeline_job_storage_read" {
  bucket = google_storage_bucket.sv_data.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.pipeline_job.email}"
}

resource "google_storage_bucket_iam_member" "pipeline_job_storage" {
  bucket = google_storage_bucket.sv_data.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.pipeline_job.email}"

  condition {
    title       = "pipeline-job-write-prefixes"
    description = "Pipeline job may write only ${join(", ", local.pipeline_job_write_prefixes)}; never races/ or summaries.json."
    expression = join(" || ", [
      for prefix in local.pipeline_job_write_prefixes :
      "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.sv_data.name}/objects/${prefix}\")"
    ])
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_storage_bucket_iam_member.pipeline_job_storage_read]
}

# Secret access is granted per secret, not project-wide.
#
# This was a single project-level `roles/secretmanager.secretAccessor` binding,
# which let the pipeline job read every secret in the project — including
# `admin-api-key`, `stripe-secret-key`, `stripe-webhook-secret`, and the
# Cloudflare analytics token, none of which it has any reason to touch. The
# races-api service account already had the per-secret treatment; the job was
# missed in that pass.
#
# The four below are exactly the secrets the job's container declares as
# `secret_key_ref` env vars. Adding a fifth env secret means adding a binding
# here — the deploy fails loudly on a missing one, which is the intended
# tradeoff against a blanket grant that can never fail.
locals {
  pipeline_job_secret_ids = {
    openrouter = google_secret_manager_secret.openrouter_key.secret_id
    serper     = google_secret_manager_secret.serper_key.secret_id
    searlo     = google_secret_manager_secret.searlo_key.secret_id
    jina       = google_secret_manager_secret.jina_key.secret_id
  }
}

resource "google_secret_manager_secret_iam_member" "pipeline_job_secrets" {
  for_each = local.pipeline_job_secret_ids

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.pipeline_job.email}"
}

resource "google_cloud_run_v2_job" "pipeline" {
  name     = "pipeline-job-${var.environment}"
  location = var.region
  project  = var.project_id

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.pipeline_job.email
      timeout         = "43200s"
      max_retries     = 0

      containers {
        image = "${var.region}-docker.pkg.dev/${var.project_id}/smartervote-${var.environment}/pipeline-worker:${var.app_version}"

        env {
          name  = "WORKER_ONCE"
          value = "true"
        }
        env {
          name  = "WORKER_RUNNER"
          value = "cloud_run"
        }
        env {
          # Keeps the worker's hard deadline inside the job timeout above.
          name  = "WORKER_TASK_TIMEOUT_SECONDS"
          value = "43200"
        }
        env {
          name  = "WORKER_CONCURRENCY"
          value = "1"
        }
        env {
          name  = "PIPELINE_MODE"
          value = "gcp"
        }
        env {
          name  = "PROJECT_ID"
          value = var.project_id
        }
        env {
          name  = "FIRESTORE_PROJECT"
          value = var.project_id
        }
        env {
          name  = "GCS_BUCKET"
          value = google_storage_bucket.sv_data.name
        }
        env {
          name = "OPENROUTER_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.openrouter_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "SERPER_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.serper_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "SEARLO_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.searlo_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "JINA_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.jina_key.secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
        }
      }
    }
  }

  labels = local.pipeline_labels

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.pipeline_job_firestore,
    google_storage_bucket_iam_member.pipeline_job_storage,
    google_storage_bucket_iam_member.pipeline_job_storage_read,
    google_secret_manager_secret_iam_member.pipeline_job_secrets,
  ]
}

resource "google_cloud_run_v2_job_iam_member" "races_api_pipeline_job_runner" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_job.pipeline.name
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.races_api.email}"
}
