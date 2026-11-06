locals {
  preview_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudquotas.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "containerscanning.googleapis.com",
    "iam.googleapis.com",
    "logging.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  preview_service_name = "yatalk-dev-preview"
  preview_repo_name    = "yatalk-dev"
  build_bucket_name    = "yatalk-dev-build-s-yatalk"
}

resource "google_project_service" "preview_apis" {
  for_each           = local.preview_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "preview" {
  project       = var.project_id
  location      = var.region
  repository_id = local.preview_repo_name
  description   = "Yatalk development preview container images"
  format        = "DOCKER"

  vulnerability_scanning_config {
    enablement_config = "INHERITED"
  }

  depends_on = [google_project_service.preview_apis]
}

resource "google_storage_bucket" "cloud_build_source" {
  project                     = var.project_id
  name                        = local.build_bucket_name
  location                    = "ASIA-NORTHEAST1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = 14 }
  }

  depends_on = [google_project_service.preview_apis]
}

resource "google_service_account" "cloud_build" {
  project      = var.project_id
  account_id   = "yatalk-dev-cloud-build"
  display_name = "Yatalk dev preview image builder"
  description  = "Builds and pushes Yatalk preview images only."

  depends_on = [google_project_service.preview_apis]
}

resource "google_project_iam_member" "cloud_build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.preview.location
  repository = google_artifact_registry_repository.preview.repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_storage_bucket_iam_member" "cloud_build_source_reader" {
  bucket = google_storage_bucket.cloud_build_source.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.cloud_build.email}"
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "yatalk-dev-runtime"
  display_name = "Yatalk dev preview runtime"
  description  = "Calls Vertex AI and reads only the configured PayPal and organizer secrets."

  depends_on = [google_project_service.preview_apis]
}

resource "google_project_iam_member" "runtime_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"

  depends_on = [google_project_service.vertex_ai]
}

resource "google_secret_manager_secret" "paypal_client_id" {
  project   = var.project_id
  secret_id = "yatalk-paypal-sandbox-client-id"
  labels    = { app = "yatalk", environment = "dev" }

  replication {
    auto {}
  }

  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.preview_apis]
}

resource "google_secret_manager_secret" "paypal_client_secret" {
  project   = var.project_id
  secret_id = "yatalk-paypal-sandbox-client-secret"
  labels    = { app = "yatalk", environment = "dev" }

  replication {
    auto {}
  }

  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.preview_apis]
}

resource "google_secret_manager_secret" "paypal_webhook_id" {
  project   = var.project_id
  secret_id = "yatalk-paypal-sandbox-webhook-id"
  labels    = { app = "yatalk", environment = "dev" }

  replication {
    auto {}
  }

  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.preview_apis]
}

resource "google_secret_manager_secret" "admin_access_code" {
  project   = var.project_id
  secret_id = "yatalk-admin-access-code"
  labels    = { app = "yatalk", environment = "dev" }

  replication {
    auto {}
  }

  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.preview_apis]
}

resource "google_secret_manager_secret" "admin_session_secret" {
  project   = var.project_id
  secret_id = "yatalk-admin-session-secret"
  labels    = { app = "yatalk", environment = "dev" }

  replication {
    auto {}
  }

  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.preview_apis]
}

resource "google_secret_manager_secret_iam_member" "runtime_paypal_client_id" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.paypal_client_id.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_paypal_client_secret" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.paypal_client_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_paypal_webhook_id" {
  count     = var.enable_paypal_webhook ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.paypal_webhook_id.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_admin_access_code" {
  count     = var.enable_organizer_access ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_access_code.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_admin_session_secret" {
  count     = var.enable_organizer_access ? 1 : 0
  project   = var.project_id
  secret_id = google_secret_manager_secret.admin_session_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "preview" {
  count                = var.enable_cloud_run_service ? 1 : 0
  project              = var.project_id
  name                 = local.preview_service_name
  location             = var.region
  ingress              = "INGRESS_TRAFFIC_ALL"
  default_uri_disabled = var.disable_default_run_app_url
  deletion_protection  = false

  scaling {
    max_instance_count = 1
  }

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "300s"
    max_instance_request_concurrency = 8

    containers {
      image = var.container_image
      ports { container_port = 8080 }

      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "APP_PORT"
        value = "8080"
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GOOGLE_CLOUD_LOCATION"
        value = "global"
      }
      env {
        name  = "GEMINI_MODEL"
        value = "gemini-3.5-flash-lite"
      }
      env {
        name  = "PAYPAL_MODE"
        value = "sandbox"
      }
      env {
        name  = "PAYPAL_CURRENCY"
        value = "JPY"
      }
      env {
        name  = "DATABASE_PATH"
        value = "/tmp/yatalk/yatalk.sqlite"
      }

      dynamic "env" {
        for_each = var.app_origin == "" ? [] : [var.app_origin]
        content {
          name  = "APP_ORIGIN"
          value = env.value
        }
      }

      env {
        name = "PAYPAL_CLIENT_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.paypal_client_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "PAYPAL_CLIENT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.paypal_client_secret.secret_id
            version = "latest"
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_paypal_webhook ? [true] : []
        content {
          name = "PAYPAL_WEBHOOK_ID"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.paypal_webhook_id.secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_organizer_access ? [true] : []
        content {
          name = "ADMIN_ACCESS_CODE"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.admin_access_code.secret_id
              version = "latest"
            }
          }
        }
      }

      dynamic "env" {
        for_each = var.enable_organizer_access ? [true] : []
        content {
          name = "ADMIN_SESSION_SECRET"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.admin_session_secret.secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        initial_delay_seconds = 0
        period_seconds        = 10
        timeout_seconds       = 2
        failure_threshold     = 6
        http_get {
          path = "/api/health"
          port = 8080
        }
      }
    }
  }

  depends_on = [
    google_project_service.preview_apis,
    google_project_service.vertex_ai,
    google_project_iam_member.runtime_vertex_ai,
    google_secret_manager_secret_iam_member.runtime_paypal_client_id,
    google_secret_manager_secret_iam_member.runtime_paypal_client_secret,
    google_secret_manager_secret_iam_member.runtime_paypal_webhook_id,
    google_secret_manager_secret_iam_member.runtime_admin_access_code,
    google_secret_manager_secret_iam_member.runtime_admin_session_secret,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.enable_public_access && var.enable_cloud_run_service ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.preview[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"

  lifecycle {
    precondition {
      condition = var.enable_custom_domain ? (
        var.app_origin == google_cloud_run_v2_service.preview[0].uri ||
        var.app_origin == local.custom_domain_origin
      ) : var.app_origin == google_cloud_run_v2_service.preview[0].uri
      error_message = "Set app_origin to the exact Cloud Run service URI, or to the Yatalk custom origin after its DNS and certificate are ready."
    }
  }
}
