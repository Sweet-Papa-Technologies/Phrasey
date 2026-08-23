output "server_url" {
  value       = google_cloud_run_v2_service.server.uri
  description = "Cloud Run URL of the game server. The client connects to this over wss://."
}

output "healthz_url" {
  value       = "${google_cloud_run_v2_service.server.uri}/healthz"
  description = "Health endpoint — should return 200."
}

output "hosting_url" {
  value       = "https://${google_firebase_hosting_site.phrasey.site_id}.web.app"
  description = "Firebase Hosting URL for the client SPA."
}

output "registry_path" {
  value       = local.registry_path
  description = "Artifact Registry path to push server images to."
}

output "server_image" {
  value       = local.server_image
  description = "Fully qualified :latest image tag that scripts/deploy.sh pushes and deploys."
}

output "firestore_database_id" {
  value       = google_firestore_database.phrasey.name
  description = "Dedicated Firestore database id (FIRESTORE_DATABASE_ID)."
}

output "runtime_service_account" {
  value       = google_service_account.server.email
  description = "Cloud Run runtime service account."
}
