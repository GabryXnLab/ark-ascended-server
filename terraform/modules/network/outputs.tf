output "vcn_id" {
  value = local.vcn_id
}

output "subnet_id" {
  value = var.create_vcn ? oci_core_subnet.public[0].id : var.existing_subnet_id
}

output "nsg_game_id" {
  value = oci_core_network_security_group.game.id
}

output "nsg_cp_id" {
  value = var.create_control_plane_nsg ? oci_core_network_security_group.control_plane[0].id : null
}
