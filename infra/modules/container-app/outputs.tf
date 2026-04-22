output "id" {
  value = azurerm_container_app.this.id
}

output "name" {
  value = azurerm_container_app.this.name
}

output "fqdn" {
  value = azurerm_container_app.this.latest_revision_fqdn
}

output "principal_id" {
  description = "System-assigned MSI object id (use when granting KV access policy)."
  value       = azurerm_container_app.this.identity[0].principal_id
}
