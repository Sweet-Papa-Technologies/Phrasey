# Dedicated runtime identity for the game server. Not the default compute SA —
# this one gets exactly one project-scoped role and nothing else.
resource "google_service_account" "server" {
  account_id   = "phrasey-server"
  display_name = "Phrasey game server (Cloud Run runtime)"
  description  = "Runtime identity for the phrasey-server Cloud Run service. Reads/writes the phrasey Firestore database with admin credentials; clients never touch Firestore directly."

  depends_on = [google_project_service.apis]
}

# roles/datastore.user covers document read/write on every database in the
# project. Firestore has no per-database IAM role, so this is the tightest
# grant available for a service that must write /rooms, /sessions and read
# /puzzles + /config/balance.
resource "google_project_iam_member" "server_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.server.email}"
}

# Players are anonymous — no accounts, no PII (design doc 7). The service is
# public at the IAM layer; room codes are the access control.
resource "google_cloud_run_v2_service_iam_member" "invoker" {
  name     = google_cloud_run_v2_service.server.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
