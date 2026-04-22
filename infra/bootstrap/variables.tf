variable "subscription_id" {
  type    = string
  default = "fb42fb29-4fcc-40a9-9ff0-21ef191674af"
}

variable "tenant_id" {
  type    = string
  default = "0451fcf1-2dd9-4eff-90e3-8396b9df62d9"
}

variable "location" {
  type    = string
  default = "uaenorth"
}

variable "tfstate_rg_name" {
  type    = string
  default = "velocap-tfstate-rg"
}

variable "tfstate_sa_name" {
  description = "Globally unique, 3-24 lowercase alphanumerics."
  type        = string
  default     = "velocaptfstateaue01"
}
