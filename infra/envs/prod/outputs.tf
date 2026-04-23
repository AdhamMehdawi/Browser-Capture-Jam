output "api_fqdn" {
  description = "Public URL of the prod backend (Azure-provided)."
  value       = module.api.fqdn
}

output "dashboard_url" {
  description = "Public URL of the prod dashboard."
  value       = module.dashboard.default_host_name
}

output "postgres_fqdn" {
  value = module.postgres.fqdn
}

output "key_vault_name" {
  value = module.key_vault.name
}

output "storage_account_name" {
  value = module.storage.name
}

output "log_analytics_workspace_id" {
  value = module.log_analytics.id
}
