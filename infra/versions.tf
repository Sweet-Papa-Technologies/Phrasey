# Phrasey — infrastructure for the party game (project: fofoapps-934be).
#
# Terraform owns: enabled APIs, the Artifact Registry repo, the dedicated
# `phrasey` Firestore database (+ TTL policy and composite indexes), the
# runtime service account and its IAM, the Cloud Run service shape (scaling,
# CPU, env, probes, timeouts), the public invoker binding, and the `phrasey`
# Firebase Hosting site.
#
# Terraform does NOT own: the container IMAGE (shipped by cloudbuild.yaml /
# scripts/deploy.sh — image drift is ignored below), the static client bundle
# (shipped by `firebase deploy --only hosting:phrasey`), or Firestore document
# data. See infra/README.md.

terraform {
  required_version = ">= 1.5"

  required_providers {
    google      = { source = "hashicorp/google", version = "~> 6.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 6.0" }
  }

  # State bucket is created out-of-band (see infra/README.md) so that nothing
  # here bootstraps its own backend.
  backend "gcs" {
    bucket = "fofoapps-934be-phrasey-tfstate"
    prefix = "phrasey"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Firebase resources (the Hosting site) only exist in the beta provider.
provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

data "google_project" "p" {}
