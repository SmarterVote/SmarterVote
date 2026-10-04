# SmarterVote Infrastructure

Terraform configuration for deploying SmarterVote on Google Cloud Platform.

## Current Deployment Model

Production race research uses one-shot Cloud Run Jobs. The removed `pipeline-client` service and the deadline-bound race Cloud Function are not part of the deployed path.

Default production flow:

```text
web admin -> races-api -> Firestore pipeline_queue
  -> Cloud Run Job execution -> shared queue processor -> AgentHandler
  -> GCS drafts/ -> admin publish -> GCS races/ (with GCS-side summaries.json updated by races-api)

```

The local Docker worker remains permanently supported and claims only queue items explicitly tagged `runner=local`.

## Quick Start

### 1. Configure

```bash
cp secrets.tfvars.example secrets.tfvars
```

Edit `secrets.tfvars`:

```hcl
project_id = "your-gcp-project-id"
region     = "us-central1"

openrouter_api_key = "sk-or-your-openrouter-key"
serper_api_key     = "your-serper-key"
searlo_api_key     = "your-searlo-key"
jina_api_key       = "your-jina-key"
admin_api_key      = "long-random-admin-key"

```

### 2. Build Runtime Artifacts

CI builds and scans the `races-api` and `pipeline-worker` containers. The deployment workflow promotes those immutable artifacts by commit SHA.

### 3. Deploy

```bash
terraform init
terraform plan -var-file=secrets.tfvars -var "app_version=<commit SHA published by CI>" -out=tfplan
terraform apply tfplan
```

### 4. Validate

```bash
curl "$(terraform output -raw races_api_url)/health"
```

Queue a race through the admin UI or `races-api`; the queue document should receive `dispatch_status=submitted`, followed by a Cloud Run Job execution and lease updates.

## Components

| Component                  | Default  | Purpose                                                                                                                                                                      |
| -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| races-api                  | enabled  | Public race API and admin queue/draft/publish API                                                                                                                            |
| Pipeline Cloud Run Job     | enabled  | One isolated, scale-to-zero execution per queued race                                                                                                                        |
| Firestore                  | enabled  | Queue items, run records, logs, race metadata, and shared API rate-limit counters                                                                                            |
| GCS bucket                 | enabled  | Private drafts, published build inputs, checkpoints, and retired versions; the web deployment copies published JSON into Cloudflare Pages                            |
| Secret Manager             | enabled  | API keys and admin secrets                                                                                                                                                   |
| Local Docker worker        | manual   | Permanent workstation runner for queue items tagged `runner=local`                                                                                                           |

## Monitoring / Alerts

All alert policies below (`infra/monitoring.tf`) are created only when `alert_email` is set — leave it empty to disable them entirely. The deploy workflow passes these optional GitHub repository variables (unset arrives as `""`, which means disabled, and the workflow emits a `::warning::` while `ALERT_EMAIL` is empty):

| GitHub variable           | Terraform variable      | Effect / prerequisite                                                                                                                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ALERT_EMAIL`             | `alert_email`           | Creates the email channel, alert policies, log metrics and the queue-backlog Cloud Scheduler job. Deploy identity needs `roles/monitoring.editor` and `roles/cloudscheduler.admin` (plus the `roles/logging.admin` Terraform already grants). |
| `GCP_BILLING_ACCOUNT_ID`  | `billing_account_id`    | Creates the $10 project budget. Deploy identity needs `roles/billing.costsManager` **on the billing account** (project roles are not enough).                              |
| `ENABLE_BILLING_EXPORT`   | `enable_billing_export` | `true` creates the `billing_export` BigQuery dataset + races-api read access. Deploy identity needs BigQuery dataset create (e.g. `roles/bigquery.admin`).                |

The queue-backlog scheduler authenticates with `X-Admin-Key`, so the admin key is stored in the Cloud Scheduler job definition (and Terraform state). races-api's `verify_token` accepts only Auth0 JWTs or that key; switching the scheduler to an OIDC token needs API-side support for Google-signed ID tokens first. Each fires to the single `google_monitoring_notification_channel.email` channel and auto-closes after 7 days if not manually resolved.

| Alert                                | Signal                                                                                                        | Notes                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `races_api_errors`                    | Cloud Run `run.googleapis.com/request_count` (5xx)                                                              | races-api only                                                                                            |
| `races_api_no_traffic`                | Absence of `run.googleapis.com/request_count`                                                                   | races-api only                                                                                            |
| `races_api_latency`                   | Cloud Run `run.googleapis.com/request_latencies` p95                                                            | races-api only                                                                                            |
| `pipeline_job_failures`               | Cloud Run Job `run.googleapis.com/job/completed_task_attempt_count` (`result = "failed"`)                       | Only the one-shot `runner="cloud_run"` path — does not cover the local worker                             |
| `queue_backlog_elevated`              | Log-based metric `pipeline_queue_pending_depth`, parsed from a `pipeline_queue_depth pending=N running=M` line races-api logs on every `GET /api/queue` | A `google_cloud_scheduler_job` polls that endpoint every 5 minutes so the signal keeps flowing even when no admin has the dashboard open; requires `admin_api_key` to be set (used as the scheduler's `X-Admin-Key` auth) |
| `local_worker_stale`                  | Log-based metric `pipeline_worker_heartbeat`, parsed from a heartbeat log line the long-lived local Docker worker (`pipeline_client/worker.py`) writes directly to Cloud Logging every `WORKER_HEARTBEAT_SECONDS` (default 300s) | Requires the workstation's `gcloud auth application-default login` identity to hold `roles/logging.logWriter` — this is **not** granted by Terraform, since the local worker deliberately has no service account (see `docker-compose.worker.yml`). Proves only that the worker process is up, not that it's running current code. |

Neither `queue_backlog_elevated` nor `local_worker_stale` had a pre-existing signal to alert on — both required adding a small amount of application instrumentation alongside the Terraform (the `pipeline_queue_depth` log line in `services/races-api/routers/queue.py`, and the Cloud Logging heartbeat in `pipeline_client/worker.py`). See the comments above each resource in `monitoring.tf` for the exact log lines they depend on.

## File Structure

```text
infra/
  main.tf                 Provider config and APIs
  variables.tf            Input variables
  outputs.tf              Terraform outputs
  bucket.tf               GCS storage
  races-api.tf            Cloud Run races API
  pipeline-job.tf        one-shot race-processing Cloud Run Job
  monitoring.tf           Firestore and monitoring resources
  secrets.tf              Secret Manager and IAM
  secrets.tfvars.example  Example local variable file
```

## Concurrency And Recovery

Each queue request starts one single-task job execution. Every task atomically claims its queue item, renews a Firestore lease, and writes terminal state through the shared queue processor. Separate executions can run in parallel; provider quotas and spend remain the practical concurrency limits.

The races API also uses transactional Firestore counters for rate limiting so
limits are consistent across Cloud Run instances. The `rate_limits` collection
has TTL cleanup on `expires_at`.

Terraform protects the remote-state bucket, production data bucket, Cloud Run
API service, and Firestore database with lifecycle deletion safeguards. Remove
those safeguards only as an explicit, separately reviewed decommissioning
change.

## Deploy Identity And IAM

GitHub Actions authenticates as `vars.GCP_DEPLOY_SERVICE_ACCOUNT` (Workload Identity Federation) or, during migration, the `GCP_SA_KEY` secret. Terraform also defines a `github-actions-<env>` service account in `secrets.tf`, but its granted roles cannot create secrets or project IAM bindings, both of which every apply does — so the identity actually applying Terraform holds additional roles granted outside Terraform. Confirm which account it is before changing deploy IAM.

Recommended narrowing, deliberately **not** applied automatically because every push to `main` runs `terraform apply` with that identity and a mid-apply permission loss would strand the deploy:

- Replace project-wide `roles/iam.serviceAccountUser` with `roles/iam.serviceAccountUser` bound only on the `races-api-<env>` and `pipeline-job-<env>` service accounts (the only identities Cloud Run resources run as). Land the SA-level bindings in one deploy and remove the project binding in a later one.
- Replace `roles/storage.admin` with bucket-scoped roles on the data and state buckets, and `roles/datastore.owner` with `roles/datastore.indexAdmin` once `create_firestore_database` is permanently false.
- Replace project-wide `roles/secretmanager.secretAccessor` with per-secret grants (the deploy workflow reads each secret it syncs).
- Retire `GCP_SA_KEY` once WIF is confirmed working and delete the key.

The pipeline Cloud Run Job's `roles/storage.objectAdmin` is also bucket-wide; scoping it to prefixes needs IAM Conditions and is left as-is.

Releases deploy only by immutable commit SHA: `app_version` has no default and rejects `latest`. Use the "Deploy Infrastructure" workflow (`action=apply`, `deploy_sha=<sha>`); `infra/deploy.sh` / `deploy.ps1` are break-glass and require the same SHA. Artifact Registry keeps at least the 20 most recent versions of each image so rollbacks have an image to deploy.

## Cleanup

```bash
terraform destroy -var-file=secrets.tfvars
```
