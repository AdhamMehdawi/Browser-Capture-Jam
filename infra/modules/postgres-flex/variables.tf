variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "database_name" {
  type    = string
  default = "velocap"
}

variable "administrator_login" {
  type    = string
  default = "velocapadmin"
}

variable "administrator_password" {
  type      = string
  sensitive = true
}

variable "postgres_version" {
  type    = string
  default = "16"
}

variable "sku_name" {
  description = "Default Burstable B1ms (1 vCPU, 2 GB RAM). Upgrade path: GP_Standard_D2ds_v5."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "storage_mb" {
  type    = number
  default = 32768
}

variable "storage_tier" {
  description = "IOPS tier. P4 pairs with 32 GB default."
  type        = string
  default     = "P4"
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "public_network_access_enabled" {
  type    = bool
  default = true
}

variable "zone" {
  type    = string
  default = "1"
}

variable "tags" {
  type    = map(string)
  default = {}
}
