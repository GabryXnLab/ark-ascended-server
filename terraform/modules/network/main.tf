# Rete di base: VCN, subnet pubblica, internet gateway, route table, e due NSG
# (game / control-plane) — derivata dai vecchi script di provisioning.
#
# Modello di sicurezza: una sola VCN + subnet pubblica condivisa da entrambe le
# VM; l'isolamento per-ruolo è dato dagli NSG assegnati alle VNIC, non da
# security list separate (la security list della subnet resta minima).
#
# create_vcn=false: adotta una VCN/subnet ESISTENTE (existing_vcn_id/
# existing_subnet_id) invece di crearne una nuova — mai gestita/distruggibile da
# questo state (blast radius: potrebbe essere condivisa con altri host/progetti).
# Le NSG restano comunque gestite da questo modulo (vedi in fondo al file).

resource "oci_core_vcn" "this" {
  count          = var.create_vcn ? 1 : 0
  compartment_id = var.compartment_id
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "${var.prefix}-vcn"
  dns_label      = "arksa"
  freeform_tags  = { project = var.project_tag }
}

resource "oci_core_internet_gateway" "this" {
  count          = var.create_vcn ? 1 : 0
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.this[0].id
  display_name   = "${var.prefix}-igw"
  enabled        = true
  freeform_tags  = { project = var.project_tag }
}

resource "oci_core_default_route_table" "this" {
  count                      = var.create_vcn ? 1 : 0
  manage_default_resource_id = oci_core_vcn.this[0].default_route_table_id
  display_name               = "${var.prefix}-rt-public"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.this[0].id
  }
}

resource "oci_core_security_list" "base" {
  count          = var.create_vcn ? 1 : 0
  compartment_id = var.compartment_id
  vcn_id         = oci_core_vcn.this[0].id
  display_name   = "${var.prefix}-sl-base"
  freeform_tags  = { project = var.project_tag }

  egress_security_rules {
    destination = "0.0.0.0/0"
    protocol    = "all"
  }

  # ICMP "fragmentation needed" (type 3, code 4) per path-MTU discovery.
  ingress_security_rules {
    source   = "0.0.0.0/0"
    protocol = "1"
    icmp_options {
      type = 3
      code = 4
    }
  }
}

resource "oci_core_subnet" "public" {
  count                      = var.create_vcn ? 1 : 0
  compartment_id             = var.compartment_id
  vcn_id                     = oci_core_vcn.this[0].id
  cidr_block                 = var.subnet_cidr
  display_name               = "${var.prefix}-subnet-public"
  dns_label                  = "public"
  route_table_id             = oci_core_vcn.this[0].default_route_table_id
  security_list_ids          = [oci_core_security_list.base[0].id]
  prohibit_public_ip_on_vnic = false
  freeform_tags              = { project = var.project_tag }
}

locals {
  vcn_id = var.create_vcn ? oci_core_vcn.this[0].id : var.existing_vcn_id
}

# --- NSG: game server (sempre gestita da questo modulo, dedicata ad arksa) ----
resource "oci_core_network_security_group" "game" {
  compartment_id = var.compartment_id
  vcn_id         = local.vcn_id
  display_name   = "${var.prefix}-nsg-game"
  freeform_tags  = { project = var.project_tag }
}

resource "oci_core_network_security_group_security_rule" "game_udp_7777" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "17"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "ARK game (UDP) - PC+console crossplay"
  udp_options {
    destination_port_range {
      min = 7777
      max = 7777
    }
  }
}

resource "oci_core_network_security_group_security_rule" "game_udp_27015" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "17"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "Steam query (UDP)"
  udp_options {
    destination_port_range {
      min = 27015
      max = 27015
    }
  }
}

resource "oci_core_network_security_group_security_rule" "game_tcp_rcon" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.vcn_cidr
  source_type               = "CIDR_BLOCK"
  description               = "RCON (TCP) - solo VCN/control plane"
  tcp_options {
    destination_port_range {
      min = 27020
      max = 27020
    }
  }
}

resource "oci_core_network_security_group_security_rule" "game_tcp_agent" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.vcn_cidr
  source_type               = "CIDR_BLOCK"
  description               = "server-agent HTTP - solo VCN"
  tcp_options {
    destination_port_range {
      min = 8787
      max = 8787
    }
  }
}

resource "oci_core_network_security_group_security_rule" "game_tcp_ssh" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = var.vcn_cidr
  source_type               = "CIDR_BLOCK"
  description               = "SSH - solo VCN/control plane"
  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# --- NSG: control plane (opzionale — vedi create_control_plane_nsg sopra) ----
# Pensata per un deploy Caddy-based da zero (443/80/22). Se il control plane è
# preesistente con le sue regole/reverse-proxy (es. nginx su una porta dedicata),
# disabilitala: questo modulo non deve gestire regole che non rispecchiano la
# realtà del control plane in uso.
resource "oci_core_network_security_group" "control_plane" {
  count          = var.create_control_plane_nsg ? 1 : 0
  compartment_id = var.compartment_id
  vcn_id         = local.vcn_id
  display_name   = "${var.prefix}-nsg-control-plane"
  freeform_tags  = { project = var.project_tag }
}

resource "oci_core_network_security_group_security_rule" "cp_tcp_https" {
  count                     = var.create_control_plane_nsg ? 1 : 0
  network_security_group_id = oci_core_network_security_group.control_plane[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "PWA HTTPS"
  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "cp_tcp_http" {
  count                     = var.create_control_plane_nsg ? 1 : 0
  network_security_group_id = oci_core_network_security_group.control_plane[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "HTTP/ACME (Caddy)"
  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}

resource "oci_core_network_security_group_security_rule" "cp_tcp_ssh" {
  count                     = var.create_control_plane_nsg ? 1 : 0
  network_security_group_id = oci_core_network_security_group.control_plane[0].id
  direction                 = "INGRESS"
  protocol                  = "6"
  source                    = "0.0.0.0/0"
  source_type               = "CIDR_BLOCK"
  description               = "SSH admin"
  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}
