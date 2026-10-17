# Isocode Workspace: Google Cloud foundations (M0).
# Not applied yet. Review, then:
#   terraform init -backend-config="bucket=<state-bucket>"
#   terraform plan -var-file=env/staging.tfvars
# launch.tf adds the uploads bucket, the calendar service account and Cloud Scheduler.
# Still to add before launch: the load balancer, Cloud Armor and the ClamAV scanner.

terraform {
  required_version = ">= 1.9"
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  backend "gcs" {
    prefix = "iclabs-workspace"
  }
}

variable "project_id" {
  type        = string
  description = "GCP project. Production: project-0fbee011-38fa-4913-a64. Staging: TBD."
}

variable "env" {
  type        = string
  description = "staging or production"
  validation {
    condition     = contains(["staging", "production"], var.env)
    error_message = "env must be staging or production."
  }
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "image" {
  type        = string
  description = "Container image for workspace-web (pushed by CI)."
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "domain" {
  type        = string
  description = "workspace.isocodelabs.com or workspace-stg.isocodelabs.com"
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudtasks.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iamcredentials.googleapis.com",
    "aiplatform.googleapis.com",
    "servicenetworking.googleapis.com",
    "compute.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  service            = each.value
  disable_on_destroy = false
}

# ─── Container registry ──────────────────────────────────────────────────────
resource "google_artifact_registry_repository" "app" {
  repository_id = "iclabs-workspace"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.apis]
}

# ─── Service accounts (least privilege, no user-managed keys) ────────────────
resource "google_service_account" "web" {
  account_id   = "workspace-web"
  display_name = "Workspace web (Cloud Run)"
}

resource "google_project_iam_member" "web_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/secretmanager.secretAccessor",
    "roles/aiplatform.user",
    "roles/logging.logWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.web.email}"
}

# ─── Database ────────────────────────────────────────────────────────────────
resource "google_sql_database_instance" "main" {
  name             = "iclabs-workspace-${var.env}"
  database_version = "POSTGRES_16"
  region           = var.region
  settings {
    tier              = var.env == "production" ? "db-custom-1-3840" : "db-f1-micro"
    availability_type = "ZONAL"
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = var.env == "production"
    }
    ip_configuration {
      # Reachable only through the Cloud SQL connector (no authorized networks, TLS required).
      # Switch to private IP when the VPC module lands (TDD §13).
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
  deletion_protection = var.env == "production"
  depends_on          = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = "iclabs"
  instance = google_sql_database_instance.main.name
}

# ─── Secrets (values are added out of band, never in Terraform state) ─────────
resource "google_secret_manager_secret" "app" {
  for_each = toset([
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "EMAIL_PAYLOAD_KEY",
    "CRON_SECRET",
    "SNS_TOPIC_ARN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "CALENDAR_SA_KEY",
  ])
  secret_id = "workspace-${lower(replace(each.value, "_", "-"))}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# ─── Cloud Run ───────────────────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "web" {
  name     = "workspace-web"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email
    scaling {
      min_instance_count = var.env == "production" ? 1 : 0
      max_instance_count = 10
    }
    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      env {
        name  = "BETTER_AUTH_URL"
        value = "https://${var.domain}"
      }
      dynamic "env" {
        for_each = local.runtime_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = google_secret_manager_secret.app
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
  }
  depends_on = [google_project_iam_member.web_roles]
}

# Public app; access control is in the app itself. Staging adds IAP later.
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "service_url" {
  value = google_cloud_run_v2_service.web.uri
}
