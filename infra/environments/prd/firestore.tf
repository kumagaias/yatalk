resource "google_project_service" "firestore" {
  project            = var.project_id
  service            = "firestore.googleapis.com"
  disable_on_destroy = false
}

resource "google_firestore_database" "default" {
  project                     = var.project_id
  name                        = "(default)"
  location_id                 = var.region
  type                        = "FIRESTORE_NATIVE"
  concurrency_mode            = "OPTIMISTIC"
  delete_protection_state     = "DELETE_PROTECTION_ENABLED"
  deletion_policy             = "PREVENT"
  app_engine_integration_mode = "DISABLED"

  depends_on = [google_project_service.firestore]
}

resource "google_project_iam_member" "runtime_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"

  depends_on = [google_firestore_database.default]
}

resource "google_firestore_index" "orders_expiry" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "orders"
  query_scope = "COLLECTION"

  fields {
    field_path = "shopId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "state"
    order      = "ASCENDING"
  }
  fields {
    field_path = "expiresAt"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "orders_daily_captured" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "orders"
  query_scope = "COLLECTION"

  fields {
    field_path = "shopId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "capturedAt"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "orders_recent" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "orders"
  query_scope = "COLLECTION"

  fields {
    field_path = "shopId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "products_shop_active" {
  project     = var.project_id
  database    = google_firestore_database.default.name
  collection  = "products"
  query_scope = "COLLECTION"

  fields {
    field_path = "shopId"
    order      = "ASCENDING"
  }
  fields {
    field_path = "active"
    order      = "ASCENDING"
  }
}

resource "google_firestore_field" "visitor_session_expiry" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "visitorSessions"
  field      = "expiresAtTtl"
  ttl_config {}
}

resource "google_firestore_field" "owner_session_expiry" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "ownerSessions"
  field      = "expiresAtTtl"
  ttl_config {}
}

resource "google_firestore_field" "cart_item_expiry" {
  project    = var.project_id
  database   = google_firestore_database.default.name
  collection = "cartItems"
  field      = "expiresAtTtl"
  ttl_config {}
}
