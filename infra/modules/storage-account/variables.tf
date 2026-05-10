variable "name" {
  description = "Globally unique, 3-24 lowercase alphanumerics."
  type        = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "cors_allowed_origins" {
  description = "Origins allowed for CORS on blob storage (e.g., dashboard URLs)."
  type        = list(string)
  default     = []
}
