locals {
  compartment_id = var.compartment_ocid != "" ? var.compartment_ocid : var.tenancy_ocid
}

data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

locals {
  availability_domain = var.availability_domain != "" ? var.availability_domain : data.oci_identity_availability_domains.ads.availability_domains[0].name
}

resource "random_password" "agent_token" {
  length  = 32
  special = false
}

resource "random_password" "rcon_password" {
  length  = 32
  special = false
}

module "network" {
  source = "./modules/network"

  compartment_id = local.compartment_id
  project_tag    = var.project_tag
  prefix         = var.prefix
  vcn_cidr       = var.vcn_cidr
  subnet_cidr    = var.subnet_cidr

  create_vcn               = var.create_vcn
  existing_vcn_id          = var.existing_vcn_id
  existing_subnet_id       = var.existing_subnet_id
  create_control_plane_nsg = var.create_control_plane_nsg
}

module "iam" {
  source = "./modules/iam"

  tenancy_ocid       = var.tenancy_ocid
  compartment_id     = local.compartment_id
  prefix             = var.prefix
  backup_bucket_name = var.backup_bucket_name
}

module "storage" {
  source = "./modules/storage"

  compartment_id = local.compartment_id
  project_tag    = var.project_tag
  prefix         = var.prefix
  region         = var.region
  bucket_name    = var.backup_bucket_name
  archive_days   = var.backup_archive_days
  delete_days    = var.backup_delete_days

  previous_versions_delete_days = var.backup_previous_versions_delete_days
}

module "game_server" {
  source = "./modules/game-server"

  compartment_id      = local.compartment_id
  availability_domain = local.availability_domain
  subnet_id           = module.network.subnet_id
  nsg_id              = module.network.nsg_game_id
  shape               = var.game_server_shape
  ocpus               = var.game_server_ocpus
  memory_gb           = var.game_server_memory_gb
  boot_volume_gb      = var.game_server_boot_gb
  boot_volume_vpus    = var.game_server_boot_vpus
  ssh_public_key      = var.ssh_public_key
  prefix              = var.prefix
  project_tag         = var.project_tag

  game_server_docker_image = var.game_server_docker_image
  agent_token              = random_password.agent_token.result
  rcon_password            = random_password.rcon_password.result
  max_players              = var.max_players
  server_password          = var.server_password
  backup_bucket_name       = module.storage.bucket_name
  auto_stop                = var.game_server_auto_stop
  github_repo              = var.github_repo
  github_ref               = var.github_ref
  github_token             = var.github_token

  depends_on = [module.iam]
}

module "control_plane" {
  count  = var.manage_control_plane ? 1 : 0
  source = "./modules/control-plane"

  compartment_id      = local.compartment_id
  availability_domain = local.availability_domain
  subnet_id           = module.network.subnet_id
  nsg_id              = module.network.nsg_cp_id
  shape               = var.control_plane_shape
  ocpus               = var.control_plane_ocpus
  memory_gb           = var.control_plane_memory_gb
  ssh_public_key      = var.ssh_public_key
  prefix              = var.prefix
  project_tag         = var.project_tag

  control_plane_docker_image = var.control_plane_docker_image
  arksa_domain               = var.arksa_domain
  supabase_url               = var.supabase_url
  supabase_publishable_key   = var.supabase_publishable_key
  supabase_secret_key        = var.supabase_secret_key
  admin_emails               = var.admin_emails
  agent_token                = random_password.agent_token.result
  agent_url                  = "http://${module.game_server.private_ip}:8787"
  game_instance_ocid         = module.game_server.instance_id
  curseforge_api_key         = var.curseforge_api_key

  depends_on = [module.iam]
}
