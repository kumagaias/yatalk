resource "google_billing_budget" "dev" {
  provider        = google.billing
  billing_account = var.billing_account_id
  display_name    = "Yatalk dev monthly budget alert"

  budget_filter {
    projects        = ["projects/${var.project_number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = "JPY"
      units         = tostring(var.monthly_budget_jpy)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.8
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.preview_apis]
}
