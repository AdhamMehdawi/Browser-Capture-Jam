variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "additional_access_policies" {
  description = "Extra principals that need access (typically ACA MSIs)."
  type = list(object({
    name               = string
    object_id          = string
    secret_permissions = list(string)
  }))
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}
