# VM control plane (Always Free ARM A1.Flex per default). Provisiona backend+PWA
# via Docker con un cloud-init minimale (~30 righe): l'immagine, già buildata
# dalla CI, viene solo scaricata ed eseguita — nessuna build sull'host.
#
# NOTA capacità Always Free: se l'apply fallisce per "Out of host capacity" sulla
# shape A1.Flex, sovrascrivi control_plane_shape con VM.Standard.E2.1.Micro nelle
# tfvars e rilancia (Terraform non ha un retry automatico di shape come lo script
# Bash originale: qui la scelta è esplicita, non un fallback silenzioso).

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

locals {
  image_id   = data.oci_core_images.ubuntu.images[0].id
  caddy_site = var.arksa_domain != "" ? var.arksa_domain : ":443"
  caddy_tls  = var.arksa_domain != "" ? "" : "tls internal"
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_id
  availability_domain = var.availability_domain
  display_name        = "${var.prefix}-control-plane"
  shape               = var.shape

  shape_config {
    ocpus         = var.ocpus
    memory_in_gbs = var.memory_gb
  }

  create_vnic_details {
    subnet_id        = var.subnet_id
    nsg_ids          = [var.nsg_id]
    assign_public_ip = true
  }

  source_details {
    source_type = "image"
    source_id   = local.image_id
  }

  metadata = merge(
    {
      user_data = base64encode(templatefile("${path.module}/../../cloud-init/control-plane.yaml.tftpl", {
        control_plane_image      = var.control_plane_docker_image
        supabase_url             = var.supabase_url
        supabase_publishable_key = var.supabase_publishable_key
        supabase_secret_key      = var.supabase_secret_key
        admin_emails             = var.admin_emails
        agent_token              = var.agent_token
        agent_url                = var.agent_url
        game_instance_ocid       = var.game_instance_ocid
        curseforge_api_key       = var.curseforge_api_key
        caddy_site               = local.caddy_site
        caddy_tls                = local.caddy_tls
      }))
    },
    var.ssh_public_key != "" ? { ssh_authorized_keys = var.ssh_public_key } : {}
  )

  freeform_tags = { project = var.project_tag }
}
