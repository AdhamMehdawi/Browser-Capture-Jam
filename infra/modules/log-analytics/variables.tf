variable "name" {
  type = string
}

variable "resource_group_name" {
  type = string
}

variable "location" {
  type = string
}

variable "retention_in_days" {
  type    = number
  default = 30
}

variable "daily_quota_gb" {
  description = "Soft cap on daily ingestion. Keeps Sponsorship credits safe; -1 means uncapped."
  type        = number
  default     = 1
}

variable "tags" {
  type    = map(string)
  default = {}
}
