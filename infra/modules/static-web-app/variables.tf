variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  description = "SWA is only deployable in a small set of regions. If uaenorth is ever unavailable, fall back to westeurope — SWA is a global CDN anyway."
  type        = string
  default     = "westeurope"
}

variable "sku_tier" {
  type    = string
  default = "Free"
}

variable "tags" {
  type    = map(string)
  default = {}
}
