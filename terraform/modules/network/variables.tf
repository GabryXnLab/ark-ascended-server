variable "compartment_id" { type = string }
variable "project_tag" { type = string }
variable "prefix" { type = string }
variable "vcn_cidr" { type = string }
variable "subnet_cidr" { type = string }

# --- Adozione di una rete già esistente (non ricreata da Terraform) --------
# Scenario reale: un control plane preesistente (es. un host condiviso con altri
# progetti) su una VCN/subnet che Terraform non deve mai poter distruggere. Con
# create_vcn=false, il modulo NON crea vcn/igw/route-table/security-list/subnet:
# usa direttamente existing_vcn_id/existing_subnet_id. Le NSG dedicate al game
# server restano comunque gestite da questo modulo (vedi sotto) — solo la rete
# condivisa sottostante resta fuori da questo state.
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

# La NSG control-plane è pensata per un deploy Caddy-based da zero (80/443/22).
# Se il control plane esistente ha già le sue regole (es. un vhost nginx su una
# porta diversa), disabilitala per non gestirla da qui.
variable "create_control_plane_nsg" {
  type    = bool
  default = true
}
