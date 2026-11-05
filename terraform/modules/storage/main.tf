# Bucket Object Storage per il backup dei salvataggi ARK + lifecycle policy
# (Standard → Archive → eliminazione). Derivata dai vecchi script di provisioning.

data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_id
}

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_id
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  name           = var.bucket_name
  freeform_tags  = { project = var.project_tag }
  # Il backup sovrascrive un'unica chiave per profilo: il versioning conserva la
  # copia precedente se viene sostituita da un salvataggio corrotto. OCI non
  # permette di disattivarlo una volta attivo, solo di sospenderlo.
  versioning = "Enabled"
}

resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  namespace = data.oci_objectstorage_namespace.ns.namespace
  bucket    = oci_objectstorage_bucket.backups.name

  rules {
    name        = "archive-old-backups"
    action      = "ARCHIVE"
    is_enabled  = true
    target      = "objects"
    time_amount = var.archive_days
    time_unit   = "DAYS"
  }

  rules {
    name        = "delete-previous-backup-versions"
    action      = "DELETE"
    is_enabled  = true
    target      = "previous-object-versions"
    time_amount = var.previous_versions_delete_days
    time_unit   = "DAYS"
  }

  rules {
    name        = "delete-very-old-backups"
    action      = "DELETE"
    is_enabled  = true
    target      = "objects"
    time_amount = var.delete_days
    time_unit   = "DAYS"
  }
}

# Il servizio Object Storage deve poter agire (ARCHIVE/DELETE) sugli oggetti
# del bucket per conto proprio, altrimenti la lifecycle policy viene accettata
# ma fallisce con InsufficientServicePermissions.
resource "oci_identity_policy" "objectstorage_lifecycle" {
  compartment_id = var.compartment_id
  name           = "${var.prefix}-storage-lifecycle"
  description    = "Permette al servizio Object Storage di applicare la lifecycle policy su ${var.bucket_name}"
  statements = [
    "Allow service objectstorage-${var.region} to manage object-family in compartment id ${var.compartment_id} where target.bucket.name='${var.bucket_name}'",
  ]
}
