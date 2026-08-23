# Dedicated Firestore database — NOT (default). Phrasey shares the FoFoApps
# project with several other apps; a separate database keeps its rules, indexes
# and TTL policy independent of theirs. Regional, co-located with Cloud Run.
resource "google_firestore_database" "phrasey" {
  name        = var.firestore_database_id
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"

  delete_protection_state = var.firestore_delete_protection ? "DELETE_PROTECTION_ENABLED" : "DELETE_PROTECTION_DISABLED"

  # ABANDON: `terraform destroy` releases the database from state instead of
  # dropping game data. Removing it for real is a deliberate manual step —
  # see infra/README.md.
  deletion_policy = "ABANDON"

  depends_on = [google_project_service.apis]
}

# Design doc 6.4: "Room docs get a TTL policy — 6 hours. No orphan rooms."
# The server writes /rooms/{code}.ttl as a Timestamp of createdAt + 6h; Firestore
# deletes the doc once that instant passes. Nothing here enforces the 6h — the
# server picks the value (packages/shared/balance.ts), this just arms the policy.
resource "google_firestore_field" "rooms_ttl" {
  project    = var.project_id
  database   = google_firestore_database.phrasey.name
  collection = "rooms"
  field      = "ttl"

  ttl_config {}

  # Declared so Terraform owns the field's index configuration alongside its TTL
  # config. It resolves to the database default (inherited from __default__),
  # which is fine at this scale — we never query by `ttl`. If /rooms ever gets
  # hot enough that the monotonically-increasing single-field index matters,
  # exempt it here.
  index_config {}
}

# /puzzles is read as "give me an active puzzle in category X" at round start,
# optionally narrowed by difficulty. Equality-only queries across two fields
# need a composite index.
resource "google_firestore_index" "puzzles_active_category" {
  project    = var.project_id
  database   = google_firestore_database.phrasey.name
  collection = "puzzles"

  fields {
    field_path = "active"
    order      = "ASCENDING"
  }
  fields {
    field_path = "category"
    order      = "ASCENDING"
  }
  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "puzzles_active_difficulty" {
  project    = var.project_id
  database   = google_firestore_database.phrasey.name
  collection = "puzzles"

  fields {
    field_path = "active"
    order      = "ASCENDING"
  }
  fields {
    field_path = "difficulty"
    order      = "ASCENDING"
  }
  fields {
    field_path = "__name__"
    order      = "ASCENDING"
  }
}
