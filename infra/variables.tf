# Core Variables
variable "project_id" {
  description = "GCP Project ID - used across all resources"
  type        = string
}

variable "region" {
  description = "GCP Region for all resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Environment (dev/staging/prod)"
  type        = string
  default     = "dev"
}

# API Keys for AI Services
variable "openrouter_api_key" {
  description = "OpenRouter API key for all LLM calls"
  type        = string
  sensitive   = true
  default     = ""
}

variable "serper_api_key" {
  description = "Serper.dev API key for web search"
  type        = string
  sensitive   = true
  default     = ""
}

variable "searlo_api_key" {
  description = "Searlo API key used when Serper credits are exhausted"
  type        = string
  sensitive   = true
  default     = ""
}

variable "jina_api_key" {
  description = "Jina Reader API key for authenticated page-fetch proxy quota"
  type        = string
  sensitive   = true
  default     = ""
}

# Deployment and versioning variables
variable "app_version" {
  description = <<-EOT
    Immutable container image tag to deploy (the verified commit SHA). No default:
    CI passes the SHA it built and scanned, and a mutable tag such as "latest"
    would let an unreviewed local build replace production and break rollback.
  EOT
  type        = string

  validation {
    condition     = length(trimspace(var.app_version)) > 0 && var.app_version != "latest"
    error_message = "app_version must be an immutable image tag (the deployed commit SHA), not empty or \"latest\"."
  }
}

variable "prevent_destroy_prod" {
  description = "Prevent destruction of resources in production"
  type        = bool
  default     = true
}

variable "auth0_domain" {
  description = "Auth0 domain for races-api admin authentication"
  type        = string
  default     = ""
}

variable "auth0_audience" {
  description = "Auth0 audience for races-api admin authentication"
  type        = string
  default     = ""
}

# Monitoring / alerting
variable "alert_email" {
  description = <<-EOT
    Email address to receive GCP monitoring alerts. Leave empty (or unset) to
    disable every alert policy. CI passes the ALERT_EMAIL repository variable,
    which arrives as "" when that variable is not configured.
  EOT
  type        = string
  default     = ""
  nullable    = false
}

variable "admin_api_key" {
  description = "Secret key that protects the /analytics/* endpoints on the races API"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_analytics_api_token" {
  description = "Read-only Cloudflare API token for Web Analytics GraphQL queries"
  type        = string
  sensitive   = true
  default     = ""
}

variable "cloudflare_analytics_account_tag" {
  description = "Cloudflare account ID containing the Web Analytics site"
  type        = string
  default     = ""
}

variable "cloudflare_analytics_site_tag" {
  description = "Cloudflare Web Analytics site token used to filter GraphQL data"
  type        = string
  default     = ""
}

variable "create_firestore_database" {
  description = "Set to true only on first deploy — requires Owner/Editor. Leave false if the (default) Firestore database already exists."
  type        = bool
  default     = false
}

# Stripe payment keys
variable "stripe_secret_key" {
  description = "Stripe secret API key (sk_live_... or sk_test_...) for creating Checkout sessions"
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = (var.stripe_secret_key == "") == (var.stripe_webhook_secret == "")
    error_message = "stripe_secret_key and stripe_webhook_secret must either both be set or both be empty."
  }
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_...) for verifying webhook event signatures"
  type        = string
  sensitive   = true
  default     = ""
}

variable "billing_account_id" {
  description = <<-EOT
    GCP Billing Account ID (XXXXXX-XXXXXX-XXXXXX). If empty, the budget alert
    resource is not created. CI passes the GCP_BILLING_ACCOUNT_ID repository
    variable ("" when unset).
    NOTE: the budget lives on the billing account, not the project, so the
    deploy service account needs roles/billing.costsManager (or
    roles/billing.admin) granted ON THE BILLING ACCOUNT before this is set;
    project-level Owner/Editor is not enough and the apply fails without it.
  EOT
  type        = string
  default     = ""
  nullable    = false
}

variable "enable_billing_export" {
  description = <<-EOT
    Create the BigQuery dataset + IAM that receive the Cloud Billing export
    (the export toggle itself is enabled once in the Console).
    NOTE: requires the CI/CD deploy service account to have BigQuery dataset
    create permission (e.g. roles/bigquery.admin). Until that role is granted,
    leave this false or the deploy fails on dataset creation.
  EOT
  type        = bool
  default     = false
  nullable    = false
}

variable "bigquery_location" {
  description = "Location for the billing-export BigQuery dataset (multi-region recommended, e.g. US)."
  type        = string
  default     = "US"
}

variable "developer_gcp_identities" {
  description = "List of developer GCP emails (e.g. user:email@example.com) allowed to impersonate service accounts locally"
  type        = list(string)
  default     = []
}
