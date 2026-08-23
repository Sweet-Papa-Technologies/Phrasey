# Docker images for the game server. Pushed by cloudbuild.yaml / scripts/deploy.sh.
resource "google_artifact_registry_repository" "phrasey" {
  location      = var.region
  repository_id = var.registry_repo_id
  format        = "DOCKER"
  description   = "Phrasey game server container images."

  depends_on = [google_project_service.apis]
}
