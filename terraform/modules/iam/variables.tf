variable "tenancy_ocid" {
  description = "I dynamic group vivono sempre nel tenancy (root), indipendentemente dal compartment di lavoro"
  type        = string
}
variable "compartment_id" { type = string }
variable "prefix" { type = string }
variable "backup_bucket_name" { type = string }
