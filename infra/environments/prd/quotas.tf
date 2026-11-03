# Cloud Quotas can reduce a quota below Google's approved value and enforce the
# lower preference as a guardrail. This is an input-token limit, not a spend cap.
resource "google_cloud_quotas_quota_preference" "gemini_input_tokens_per_day" {
  parent     = "projects/${var.project_id}"
  name       = "aiplatform-global-flash-lite-qcd-input-tokens-per-day"
  service    = "aiplatform.googleapis.com"
  quota_id   = "GlobalGenerateContentInputTokensPerDayPerBaseModel"
  dimensions = { base_model = "gemini-3.5-flash-lite-qcd" }

  justification = "Limit project-wide Vertex AI input-token consumption for the public Yatalk development preview."

  quota_config {
    preferred_value = 50000
  }

  # The requested reduction is far greater than 10% of the current quota.
  # Keep the below-usage safety check enabled.
  ignore_safety_checks = "QUOTA_DECREASE_PERCENTAGE_TOO_HIGH"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.preview_apis["cloudquotas.googleapis.com"]]
}

resource "google_cloud_quotas_quota_preference" "gemini_input_tokens_per_minute" {
  parent     = "projects/${var.project_id}"
  name       = "aiplatform-global-flash-lite-qcd-input-tokens-per-minute"
  service    = "aiplatform.googleapis.com"
  quota_id   = "GlobalGenerateContentInputTokensPerMinutePerBaseModel"
  dimensions = { base_model = "gemini-3.5-flash-lite-qcd" }

  justification = "Limit project-wide Vertex AI input-token consumption for the public Yatalk development preview."

  quota_config {
    preferred_value = 10000
  }

  # The requested reduction is far greater than 10% of the current quota.
  # Keep the below-usage safety check enabled.
  ignore_safety_checks = "QUOTA_DECREASE_PERCENTAGE_TOO_HIGH"

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.preview_apis["cloudquotas.googleapis.com"]]
}
