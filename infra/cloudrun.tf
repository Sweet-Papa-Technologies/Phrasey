locals {
  registry_path = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.phrasey.repository_id}"
  server_image  = "${local.registry_path}/${var.service_name}:latest"
}

resource "google_cloud_run_v2_service" "server" {
  name                = var.service_name
  location            = var.region
  description         = "Phrasey game server — Fastify + Socket.IO, rooms held in memory."
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.server.email

    # One instance, always warm. Rooms live in this process (design doc 6.2);
    # a scale-to-zero or a second instance would strand them.
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    max_instance_request_concurrency = var.concurrency

    # Websockets: long-lived connections need the maximum request timeout.
    timeout = "3600s"

    # Best-effort only. Design doc 6.3: session affinity MUST NOT be relied on
    # for correctness. With max_instances = 1 it is redundant; it is set so that
    # the day someone raises max_instances the reconnect path degrades rather
    # than shatters. It is not a substitute for a room registry.
    session_affinity = true

    containers {
      image = var.image

      ports {
        name           = "http1"
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        # CPU always allocated (the v2 spelling of the
        # run.googleapis.com/cpu-throttling = "false" annotation). This is a
        # stateful websocket server: turn timers, bot think-delays and the
        # 4-second interrupt window all run between requests. Throttled CPU
        # would freeze them mid-round.
        cpu_idle          = false
        startup_cpu_boost = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = google_firestore_database.phrasey.name
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "CORS_ORIGINS"
        value = join(",", var.cors_origins)
      }

      # NOTE: Cloud Run's frontend reserves the exact path /healthz and returns
      # its own 404 to external callers — verified against this service. The
      # probes below are internal and do reach the container, so /healthz is
      # correct here, but anything curling from outside must use /health. The
      # server package serves both.
      startup_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 3
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/healthz"
        }
        initial_delay_seconds = 10
        period_seconds        = 30
        timeout_seconds       = 5
        failure_threshold     = 3
      }
    }
  }

  # scripts/deploy.sh and cloudbuild.yaml ship images; Terraform owns the shape
  # of the service, not its contents. Don't fight the deploy.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      # `gcloud run deploy` writes a service-level scaling block and its own
      # client fingerprints on every deploy. Revision scaling is set in
      # template.scaling above; this outer block is deploy-tool noise.
      scaling,
      client,
      client_version,
    ]
  }

  depends_on = [
    google_project_service.apis,
    google_project_iam_member.server_datastore,
  ]
}
