variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "container_app_environment_id" {
  type = string
}

variable "image" {
  description = "Full image ref, e.g. velocapcr.azurecr.io/api:sha-abcdef"
  type        = string
}

variable "target_port" {
  type    = number
  default = 4000
}

variable "external_ingress" {
  description = "true = publicly reachable via *.azurecontainerapps.io"
  type        = bool
  default     = true
}

variable "cpu" {
  type    = number
  default = 0.25
}

variable "memory" {
  type    = string
  default = "0.5Gi"
}

variable "min_replicas" {
  type    = number
  default = 0
}

variable "max_replicas" {
  type    = number
  default = 2
}

variable "acr_login_server" {
  type = string
}

variable "acr_admin_username" {
  type      = string
  sensitive = true
}

variable "acr_admin_password" {
  type      = string
  sensitive = true
}

variable "env_vars" {
  description = "Plain non-secret env vars."
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "env_secret_refs" {
  description = "Env vars that pull from an ACA secret declared in `secrets`."
  type = list(object({
    name        = string
    secret_name = string
  }))
  default = []
}

variable "secrets" {
  description = "ACA secrets (inlined for MVP; later: Key Vault secret refs via MSI)."
  type = list(object({
    name  = string
    value = string
  }))
  default   = []
  sensitive = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
