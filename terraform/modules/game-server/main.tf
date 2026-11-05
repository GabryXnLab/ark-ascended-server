# VM game server (x86, E5.Flex per default). Cloud-init minimale: installa
# Docker e avvia il container game-server (docker/game-server/Dockerfile), che
# al primo avvio scarica ASA via SteamCMD dentro il volume persistente /data.
#
# Boot volume persistente (mai distrutto tra deploy): i dati di gioco vivono nel
# volume Docker "arksa-game-data", che a sua volta vive sul boot volume OCI.

locals {
  # Proprietario del repo (prima dello slash): usato come username per il
  # login su GHCR — accetta un token con scope "read:packages" come password.
  github_owner = split("/", var.github_repo)[0]
}

data "oci_core_images" "ubuntu" {
  compartment_id           = var.compartment_id
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = var.shape
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_instance" "this" {
  compartment_id      = var.compartment_id
  availability_domain = var.availability_domain
  display_name        = "${var.prefix}-game"
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
    source_type             = "image"
    source_id               = data.oci_core_images.ubuntu.images[0].id
    boot_volume_size_in_gbs = var.boot_volume_gb
    # Tier persistente/a VM spenta. Lower Cost/0 esiste solo per i block volume
    # dati; il control plane alza elasticamente questo boot volume a 20 VPU/GB
    # durante avvio/esecuzione e l'agent lo riporta a 10 allo shutdown.
    boot_volume_vpus_per_gb = max(var.boot_volume_vpus, 10)
  }

  metadata = merge(
    {
      user_data = base64encode(templatefile("${path.module}/../../cloud-init/game-server.yaml.tftpl", {
        game_server_image  = var.game_server_docker_image
        agent_token        = var.agent_token
        rcon_password      = var.rcon_password
        max_players        = var.max_players
        server_password    = var.server_password
        backup_bucket_name = var.backup_bucket_name
        github_repo        = var.github_repo
        github_ref         = var.github_ref
        github_token       = var.github_token
        github_owner       = local.github_owner
      }))
    },
    var.ssh_public_key != "" ? { ssh_authorized_keys = var.ssh_public_key } : {}
  )

  freeform_tags = { project = var.project_tag }

  # Questa risorsa rappresenta l'UNICA istanza di PRODUZIONE del game server,
  # importata (`terraform import`). Dal 2026-08-24 l'host esegue il runtime
  # Docker, ma l'istanza era nata hand-provisioned: immagine, metadata/cloud-init
  # e shape non combaciano necessariamente con un host creato ex novo da questo
  # modulo. Li ignoriamo per non forzare mai un replace che distruggerebbe il
  # boot volume coi dati di gioco (D3). `prevent_destroy` resta la rete di
  # sicurezza hard contro un destroy accidentale della produzione.
  lifecycle {
    prevent_destroy = true
    ignore_changes = [
      metadata,
      source_details,
      create_vnic_details,
      shape_config,
      shape,
      display_name,
      freeform_tags,
    ]
  }
}

# Stop opzionale post-apply (default off, vedi variabile auto_stop in root
# variables.tf): il modello on-demand vuole l'istanza STOPPED, ma fermarla
# troppo presto interromperebbe il primo download di ASA (~13GB) nel container.
resource "null_resource" "auto_stop" {
  count = var.auto_stop ? 1 : 0

  triggers = {
    instance_id = oci_core_instance.this.id
  }

  provisioner "local-exec" {
    command = "oci compute instance action --instance-id ${oci_core_instance.this.id} --action SOFTSTOP --wait-for-state STOPPED"
  }
}
