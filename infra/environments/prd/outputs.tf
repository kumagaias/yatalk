output "project_id" {
  description = "Google Cloud project used by Yatalk development."
  value       = var.project_id
}

output "terraform_state_bucket" {
  description = "Remote GCS bucket holding the Terraform state."
  value       = google_storage_bucket.terraform_state.name
}

output "vertex_ai_api" {
  description = "Enabled Vertex AI API for Gemini requests."
  value       = google_project_service.vertex_ai.service
}

output "artifact_registry_repository" {
  description = "Docker repository for digest-pinned Yatalk dev preview images."
  value       = "${google_artifact_registry_repository.preview.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.preview.repository_id}"
}

output "cloud_build_service_account" {
  description = "Least-privilege service account used for manual Cloud Build image submissions."
  value       = google_service_account.cloud_build.email
}

output "cloud_build_source_bucket" {
  description = "Private GCS bucket for staging build source archives."
  value       = google_storage_bucket.cloud_build_source.name
}

output "cloud_run_preview_uri" {
  description = "Default Cloud Run URI; null when the service or its default URI is disabled. Use only when not using the custom domain."
  value       = try(google_cloud_run_v2_service.preview[0].uri, null)
}

output "custom_domain_dns_records" {
  description = "Non-secret DNS records reported by the Cloud Run domain mapping for central Route 53 management."
  value = try([
    for record in google_cloud_run_domain_mapping.custom_domain[0].status[0].resource_records : {
      type   = record.type
      rrdata = record.rrdata
    }
  ], [])
}
