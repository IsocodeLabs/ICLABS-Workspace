# Launch pieces (M6): candidate uploads, interviews (Google Calendar), scheduled jobs.

variable "ai_review_enabled" {
  type        = bool
  default     = true
  description = "Claude review suggestions via Vertex AI (suggestions only)."
}

variable "scan_mode" {
  type        = string
  default     = "none"
  description = "Set to \"clamav\" once the scanner service is deployed (launch blocker per R-SEC)."
}

variable "cron_secret" {
  type        = string
  sensitive   = true
  description = "Same value as the CRON_SECRET secret. Lands in state: keep the state bucket private."
}

locals {
  runtime_env = {
    NODE_ENV           = "production"
    DATABASE_POOL_MAX  = "5"
    TEAM_EMAIL_DOMAIN  = "isocodelabs.com"
    EMAIL_TRANSPORT    = "ses"
    AWS_REGION         = "ap-south-1"
    STORAGE_DRIVER     = "gcs"
    GCS_BUCKET         = google_storage_bucket.uploads.name
    SCAN_MODE          = var.scan_mode
    CALENDAR_DRIVER    = "google"
    CALENDAR_ORGANIZER = "hiring@isocodelabs.com"
    CALENDAR_SA_EMAIL  = google_service_account.calendar.email
    AI_REVIEW_ENABLED  = tostring(var.ai_review_enabled)
    VERTEX_PROJECT_ID  = var.project_id
    VERTEX_REGION      = "global"
    CLAUDE_MODEL       = "claude-opus-5-5"
  }
}

# ─── Candidate uploads: private, signed URLs only ─────────────────────────────
resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-workspace-uploads-${var.env}"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = false
  }
  cors {
    origin          = ["https://${var.domain}"]
    method          = ["PUT"]
    response_header = ["Content-Type", "x-goog-content-length-range"]
    max_age_seconds = 600
  }
  # Deletion is driven by the app's retention job (12 months after a cycle closes).
}

resource "google_storage_bucket_iam_member" "web_uploads" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.web.email}"
}

# Signed URLs without keys: the web SA signs blobs as itself.
resource "google_service_account_iam_member" "web_sign_self" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.web.email}"
}

# ─── Interviews: Google Calendar via domain-wide delegation ───────────────────
# After apply, a Workspace super-admin grants this SA's client ID the scope
# https://www.googleapis.com/auth/calendar (Admin console → Security → API controls →
# Domain-wide delegation), and its key goes into the workspace-calendar-sa-key secret.
resource "google_service_account" "calendar" {
  account_id   = "workspace-calendar"
  display_name = "Workspace interview scheduling (Calendar DWD)"
}

# ─── Scheduled jobs ──────────────────────────────────────────────────────────
locals {
  cron_jobs = {
    "email-outbox"    = { path = "/api/cron/email-outbox", schedule = "* * * * *" }
    "stages-sweep"    = { path = "/api/cron/stages", schedule = "* * * * *" }
    "retention-purge" = { path = "/api/cron/retention", schedule = "30 20 * * *" } # 02:00 IST
  }
}

resource "google_cloud_scheduler_job" "cron" {
  for_each         = local.cron_jobs
  name             = "workspace-${each.key}"
  region           = var.region
  schedule         = each.value.schedule
  time_zone        = "Etc/UTC"
  attempt_deadline = "120s"
  retry_config {
    retry_count = 1
  }
  http_target {
    uri         = "${google_cloud_run_v2_service.web.uri}${each.value.path}"
    http_method = "POST"
    headers = {
      Authorization = "Bearer ${var.cron_secret}"
    }
  }
  depends_on = [google_project_service.apis]
}
