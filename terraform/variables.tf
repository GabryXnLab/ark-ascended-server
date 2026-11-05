# Variabili radice. Copia terraform.tfvars.example → terraform.tfvars e compila
# (terraform.tfvars è gitignored: non committare OCID/segreti reali).

variable "tenancy_ocid" {
  description = "OCID della tenancy OCI (obbligatorio: auth provider + fallback compartment + dynamic group)"
  type        = string
}

variable "region" {
  description = "Regione OCI (es. us-ashburn-1)"
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment in cui creare le risorse. Vuoto = tenancy root."
  type        = string
  default     = ""
}

variable "availability_domain" {
  description = "Availability domain (es. xxxx:US-ASHBURN-1-AD-1). Vuoto = il primo disponibile."
  type        = string
  default     = ""
}

variable "ssh_public_key" {
  description = "Chiave pubblica SSH da iniettare nelle istanze (contenuto del file .pub, non il path)"
  type        = string
  default     = ""
}

variable "project_tag" {
  type    = string
  default = "ark-ascended-server"
}

variable "prefix" {
  description = "Prefisso per i display-name delle risorse"
  type        = string
  default     = "arksa"
}

# --- Rete ---------------------------------------------------------------------
variable "vcn_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "subnet_cidr" {
  type    = string
  default = "10.20.1.0/24"
}

# Adotta una VCN/subnet già esistente invece di crearne una nuova (scenario:
# game server da affiancare a un control plane preesistente su rete condivisa
# con altri progetti).
# Con create_vcn=false, existing_vcn_id/existing_subnet_id sono obbligatori.
variable "create_vcn" {
  type    = bool
  default = true
}
variable "existing_vcn_id" {
  type    = string
  default = ""
}
variable "existing_subnet_id" {
  type    = string
  default = ""
}
# La NSG control-plane presume un deploy Caddy da zero (443/80/22): disabilitala
# se il control plane esistente ha già le sue regole (es. un reverse proxy su
# una porta diversa).
variable "create_control_plane_nsg" {
  type    = bool
  default = true
}

# Se false, questo Terraform non crea/gestisce affatto il control plane (nessuna
# istanza, nessuna NSG dedicata già coperta da create_control_plane_nsg): usalo
# quando il control plane gira già altrove (es. un host condiviso non Terraform-
# managed) e questo state deve occuparsi solo del game server.
variable "manage_control_plane" {
  type    = bool
  default = true
}

# --- Control plane --------------------------------------------------------------
variable "control_plane_shape" {
  description = "Shape del control plane. Default Always Free ARM; se la capacità A1 è esaurita nella regione, sovrascrivi con VM.Standard.E2.1.Micro."
  type        = string
  default     = "VM.Standard.A1.Flex"
}

variable "control_plane_ocpus" {
  type    = number
  default = 1
}

variable "control_plane_memory_gb" {
  type    = number
  default = 6
}

variable "control_plane_docker_image" {
  description = "Immagine Docker del control plane (backend+PWA), pubblicata dalla CI su GHCR"
  type        = string
  default     = "ghcr.io/gabryxnlab/ark-ascended-control-plane:latest"
}

variable "arksa_domain" {
  description = "Dominio pubblico per la PWA (TLS Let's Encrypt via Caddy). Vuoto = certificato self-signed interno."
  type        = string
  default     = ""
}

variable "supabase_url" {
  description = "URL del progetto Supabase usato per Google Auth e membership"
  type        = string
  default     = ""
}
variable "supabase_publishable_key" {
  description = "Publishable key Supabase (può essere esposta alla PWA)"
  type        = string
  default     = ""
}
variable "supabase_secret_key" {
  description = "Secret/service-role key Supabase, solo backend"
  type        = string
  default     = ""
  sensitive   = true
}
variable "admin_emails" {
  description = "Email Google amministratrici, separate da virgola"
  type        = string
  default     = ""
}
variable "curseforge_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

# --- Game server ----------------------------------------------------------------
variable "game_server_shape" {
  type    = string
  default = "VM.Standard.E5.Flex"
}

variable "game_server_ocpus" {
  type    = number
  default = 4
}

variable "game_server_memory_gb" {
  type    = number
  default = 24
}

variable "game_server_boot_gb" {
  type    = number
  default = 50
}

variable "game_server_boot_vpus" {
  description = "Tier persistente/a VM spenta del boot volume. 10 = Balanced; il runtime passa temporaneamente a 20 (Higher Performance). Lower Cost/0 non è supportato sui boot volume."
  type        = number
  default     = 10
}

variable "game_server_docker_image" {
  description = "Immagine Docker del game server (Proton+SteamCMD+agent), pubblicata dalla CI su GHCR"
  type        = string
  default     = "ghcr.io/gabryxnlab/ark-ascended-server-managed:latest"
}

variable "max_players" {
  type    = number
  default = 20
}

variable "server_password" {
  type      = string
  default   = ""
  sensitive = true
}

variable "github_repo" {
  description = "Repo GitHub (owner/nome) da cui il game server scarica il compose file aggiornato ad ogni boot (self-update, vedi cloud-init/game-server.yaml.tftpl). Cambia per un fork."
  type        = string
  default     = "GabryXnLab/ark-ascended-server"
}

variable "github_ref" {
  description = "Branch/ref del repo da cui scaricare il compose file al boot del game server."
  type        = string
  default     = "main"
}

# Necessario SOLO se il repo/pacchetto GHCR sono privati: senza autenticazione
# raw.githubusercontent.com risponde 404 e "docker login ghcr.io" unauthorized
# (verificato dal vivo). Vuoto = nessuna autenticazione (fork con repo pubblico).
# Token con "Contents: read-only" (repo) + "Packages: read" (GHCR); un
# fine-grained PAT dedicato è la scelta più sicura.
variable "github_token" {
  type      = string
  default   = ""
  sensitive = true
}

variable "game_server_auto_stop" {
  description = "Se true, ferma (SOFTSTOP) l'istanza game server subito dopo l'apply. ATTENZIONE: il primo avvio scarica ASA (~13GB) e le immagini Docker in background nel container entrypoint: uno stop troppo presto interrompe l'installazione. Lascia false al primo provisioning; puoi fermarla manualmente da console/CLI/PWA a setup completato."
  type        = bool
  default     = false
}

# --- Storage backup -------------------------------------------------------------
variable "backup_bucket_name" {
  type    = string
  default = "arksa-backups"
}

variable "backup_archive_days" {
  type    = number
  default = 30
}

variable "backup_delete_days" {
  type    = number
  default = 180
}

# Con il versioning ogni backup allo spegnimento conserva la copia precedente di
# saves/<profilo>.tar.zst: le versioni precedenti vengono eliminate dopo questi giorni.
variable "backup_previous_versions_delete_days" {
  type    = number
  default = 30
}
