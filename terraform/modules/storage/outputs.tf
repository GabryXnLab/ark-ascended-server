output "bucket_name" {
  value = oci_objectstorage_bucket.backups.name
}

output "namespace" {
  value = data.oci_objectstorage_namespace.ns.namespace
}
