variable "compartment_id" { type = string }
variable "availability_domain" { type = string }
variable "subnet_id" { type = string }
variable "nsg_id" { type = string }
variable "shape" { type = string }
variable "ocpus" { type = number }
variable "memory_gb" { type = number }
variable "ssh_public_key" { type = string }
variable "prefix" { type = string }
variable "project_tag" { type = string }

variable "control_plane_docker_image" { type = string }
variable "arksa_domain" { type = string }
variable "supabase_url" { type = string }
variable "supabase_publishable_key" { type = string }
variable "supabase_secret_key" {
  type      = string
  sensitive = true
}
variable "admin_emails" { type = string }
variable "agent_token" {
  type      = string
  sensitive = true
}
variable "agent_url" { type = string }
variable "game_instance_ocid" { type = string }
variable "curseforge_api_key" {
  type      = string
  sensitive = true
}
