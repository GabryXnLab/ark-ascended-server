variable "compartment_id" { type = string }
variable "availability_domain" { type = string }
variable "subnet_id" { type = string }
variable "nsg_id" { type = string }
variable "shape" { type = string }
variable "ocpus" { type = number }
variable "memory_gb" { type = number }
variable "boot_volume_gb" { type = number }
variable "boot_volume_vpus" { type = number }
variable "ssh_public_key" { type = string }
variable "prefix" { type = string }
variable "project_tag" { type = string }

variable "game_server_docker_image" { type = string }
variable "agent_token" {
  type      = string
  sensitive = true
}
variable "rcon_password" {
  type      = string
  sensitive = true
}
variable "max_players" { type = number }
variable "server_password" {
  type      = string
  sensitive = true
}
variable "backup_bucket_name" { type = string }
variable "auto_stop" {
  type    = bool
  default = false
}

# Repo/ref da cui il servizio systemd di self-update (ad ogni boot) scarica
# docker/compose/game-server.compose.yml — vedi cloud-init/game-server.yaml.tftpl.
variable "github_repo" {
  type    = string
  default = "GabryXnLab/ark-ascended-server"
}
variable "github_ref" {
  type    = string
  default = "main"
}
# Necessario SOLO se il repo/pacchetto GHCR sono privati (vedi root variables.tf).
# Vuoto = nessuna autenticazione (fork con repo pubblico).
variable "github_token" {
  type      = string
  default   = ""
  sensitive = true
}
