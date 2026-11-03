locals {
  custom_domain_host   = "yatalk.kumagaias.com"
  custom_domain_origin = "https://${local.custom_domain_host}"
}

resource "google_cloud_run_domain_mapping" "custom_domain" {
  count    = var.enable_custom_domain ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = local.custom_domain_host

  metadata {
    namespace = var.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.preview[0].name
  }
}
