# Instance principal: dynamic group + policy, così le VM controllano le
# istanze (e il bucket di backup) senza chiavi statiche. Derivata dai vecchi script
# di provisioning.

resource "oci_identity_dynamic_group" "instances" {
  compartment_id = var.tenancy_ocid
  name           = "${var.prefix}-instances"
  description    = "Istanze del progetto ark-ascended-server"
  matching_rule  = "ALL {instance.compartment.id = '${var.compartment_id}'}"
}

resource "oci_identity_policy" "instance_principal" {
  compartment_id = var.compartment_id
  name           = "${var.prefix}-instance-principal"
  description    = "Instance principal per start/stop istanze arksa"

  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.instances.name} to manage instance-family in compartment id ${var.compartment_id}",
    "Allow dynamic-group ${oci_identity_dynamic_group.instances.name} to read instances in tenancy",
    "Allow dynamic-group ${oci_identity_dynamic_group.instances.name} to read usage-report in tenancy",
    "Allow dynamic-group ${oci_identity_dynamic_group.instances.name} to manage volume-family in compartment id ${var.compartment_id}",
    "Allow dynamic-group ${oci_identity_dynamic_group.instances.name} to manage objects in compartment id ${var.compartment_id} where target.bucket.name='${var.backup_bucket_name}'",
  ]
}
