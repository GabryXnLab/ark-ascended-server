output "control_plane_public_ip" {
  value = var.manage_control_plane ? module.control_plane[0].public_ip : null
}

output "control_plane_url" {
  value = (
    var.manage_control_plane
    ? (var.arksa_domain != "" ? "https://${var.arksa_domain}" : "https://${module.control_plane[0].public_ip}")
    : null
  )
}

output "game_server_instance_id" {
  value = module.game_server.instance_id
}

output "game_server_public_ip" {
  value = module.game_server.public_ip
}

output "game_server_private_ip" {
  value = module.game_server.private_ip
}

output "backup_bucket" {
  value = module.storage.bucket_name
}

output "agent_token" {
  value     = random_password.agent_token.result
  sensitive = true
}

output "rcon_password" {
  value     = random_password.rcon_password.result
  sensitive = true
}

output "stop_game_server_command" {
  description = "Comando per fermare il game server a setup completato (modello on-demand: STOPPED di default)"
  value       = "oci compute instance action --instance-id ${module.game_server.instance_id} --action SOFTSTOP --wait-for-state STOPPED"
}
