variable "project_id" {
  description = "Google Cloud project ID selected for the Yatalk development environment."
  type        = string
  default     = "s-yatalk"
}

variable "billing_account_id" {
  description = "Billing account that owns the development project's monthly alert budget."
  type        = string
}

variable "project_number" {
  description = "Numeric project identifier used to scope the monthly budget alert."
  type        = string
  validation {
    condition     = can(regex("^[0-9]+$", var.project_number))
    error_message = "project_number must contain only digits."
  }
}

variable "monthly_budget_jpy" {
  description = "Monthly alerts-only budget for the development project, in JPY."
  type        = number
  default     = 5000

  validation {
    condition     = var.monthly_budget_jpy >= 100 && floor(var.monthly_budget_jpy) == var.monthly_budget_jpy
    error_message = "monthly_budget_jpy must be a whole number of at least 100 yen."
  }
}

variable "region" {
  description = "Default Google Cloud region for regional development resources."
  type        = string
  default     = "asia-northeast1"
}

variable "enable_cloud_run_service" {
  description = "Create the private Cloud Run preview after its image has been built."
  type        = bool
  default     = false
}

variable "enable_public_access" {
  description = "Grant allUsers Cloud Run Invoker after app_origin has been set to the exact service URL."
  type        = bool
  default     = false
  validation {
    condition     = !var.enable_public_access || var.enable_cloud_run_service
    error_message = "enable_cloud_run_service must be true before public access can be enabled."
  }
}

variable "enable_custom_domain" {
  description = "Create the Cloud Run domain mapping for yatalk.kumagaias.com after the preview service is public."
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_custom_domain || (var.enable_cloud_run_service && var.enable_public_access)
    error_message = "enable_cloud_run_service and enable_public_access must be true before creating the Cloud Run domain mapping."
  }
}

variable "disable_default_run_app_url" {
  description = "Disable the public run.app URL after traffic, webhooks, and monitors have moved to the custom domain."
  type        = bool
  default     = false

  validation {
    condition = !var.disable_default_run_app_url || (
      var.enable_custom_domain &&
      var.enable_public_access &&
      var.app_origin == "https://yatalk.kumagaias.com"
    )
    error_message = "Disabling the default run.app URL requires the custom domain mapping, public access, and app_origin=https://yatalk.kumagaias.com."
  }
}

variable "enable_paypal_webhook" {
  description = "Inject the registered PayPal Sandbox webhook ID after its Secret Manager version exists."
  type        = bool
  default     = false
}

variable "enable_organizer_access" {
  description = "Inject organizer login secrets after their Secret Manager versions exist."
  type        = bool
  default     = false
}

variable "enable_email_delivery" {
  description = "Inject the Resend API key into Cloud Run after its Secret Manager version exists."
  type        = bool
  default     = false
}

variable "resend_from_email" {
  description = "Verified sender address configured in Resend; required only when email delivery is enabled."
  type        = string
  default     = ""
  validation {
    condition     = !var.enable_email_delivery || can(regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", var.resend_from_email))
    error_message = "Email delivery requires a valid, verified resend_from_email address."
  }
}

variable "container_image" {
  description = "Digest-pinned Artifact Registry image for the preview service; leave empty until Cloud Build publishes it."
  type        = string
  default     = ""
  validation {
    condition     = !var.enable_cloud_run_service || can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "When Cloud Run is enabled, container_image must be pinned to an Artifact Registry sha256 digest."
  }
}

variable "app_origin" {
  description = "Exact HTTPS origin accepted by the browser API; use the Cloud Run URI until the custom-domain DNS and certificate are ready."
  type        = string
  default     = ""
  validation {
    condition     = !var.enable_public_access || can(regex("^https://[a-z0-9.-]+(:[0-9]{1,5})?$", var.app_origin))
    error_message = "Public access requires app_origin to be an exact HTTPS host origin with no path, query, or fragment."
  }
}
