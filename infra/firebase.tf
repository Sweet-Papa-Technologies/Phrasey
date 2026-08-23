# Static SPA host -> https://phrasey.web.app. The bundle is shipped by
# `firebase deploy --only hosting:phrasey` (see firebase.json / scripts/deploy.sh),
# not by Terraform. The game server is NOT proxied through Hosting — the client
# opens a websocket straight to the Cloud Run URL.
resource "google_firebase_hosting_site" "phrasey" {
  provider = google-beta

  project = var.project_id
  site_id = var.hosting_site_id

  depends_on = [google_project_service.apis]
}
