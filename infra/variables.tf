variable "project_id" {
  type        = string
  description = "GCP project ID hosting Phrasey (FoFoApps)."
  default     = "fofoapps-934be"
}

variable "region" {
  type        = string
  description = "Region for Cloud Run, Artifact Registry and Firestore. Keep Firestore next to Cloud Run."
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name for the game server."
  default     = "phrasey-server"
}

variable "registry_repo_id" {
  type        = string
  description = "Artifact Registry Docker repository id."
  default     = "phrasey"
}

variable "firestore_database_id" {
  type        = string
  description = "Dedicated Firestore database id. NOT (default) — Phrasey gets its own database."
  default     = "phrasey"
}

variable "firestore_delete_protection" {
  type        = bool
  description = "Enable Firestore delete protection. Leave false until there is data worth protecting."
  default     = false
}

variable "hosting_site_id" {
  type        = string
  description = "Firebase Hosting site id -> https://<id>.web.app."
  default     = "phrasey"
}

variable "image" {
  type        = string
  description = <<-EOT
    Container image for the Cloud Run service. Defaults to Google's public
    hello-world container so `terraform apply` stands up a healthy service
    before packages/server has ever been built. scripts/deploy.sh (and
    cloudbuild.yaml) replace it with
    <region>-docker.pkg.dev/<project>/phrasey/phrasey-server:<tag>, and the
    service ignores image drift, so Terraform will not roll it back.
  EOT
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "min_instances" {
  type        = number
  description = "Cloud Run min instances. 1 keeps in-memory rooms and turn timers alive (design doc 6.3). Costs ~a always-on instance."
  default     = 1
}

variable "max_instances" {
  type        = number
  description = "Cloud Run max instances. MUST stay 1 until there is a cross-instance room registry (design doc 6.3)."
  default     = 1
}

variable "concurrency" {
  type        = number
  description = "Max concurrent requests (socket connections) per instance."
  default     = 250
}

variable "cpu" {
  type        = string
  description = "vCPU per instance."
  default     = "1"
}

variable "memory" {
  type        = string
  description = "Memory per instance."
  default     = "512Mi"
}

variable "cors_origins" {
  type        = list(string)
  description = "Origins allowed to open Socket.IO / HTTP connections to the game server. Passed to the server as CORS_ORIGINS (comma separated)."
  default     = ["https://phrasey.web.app", "https://phrasey.firebaseapp.com", "http://localhost:5173"]
}
