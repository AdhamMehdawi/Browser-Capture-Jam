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

variable "resource_group_name" {
  type    = string
  default = "VeloCap"
}

variable "env" {
  type    = string
  default = "dev"
}

# API image is set after the first ACR push. Until then, a placeholder image
# keeps the Container App creatable.
variable "api_image" {
  type    = string
  default = "mcr.microsoft.com/k8se/quickstart:latest"
}
