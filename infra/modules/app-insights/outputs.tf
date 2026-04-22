output "id" {
  value = azurerm_application_insights.this.id
}

output "instrumentation_key" {
  value     = azurerm_application_insights.this.instrumentation_key
  sensitive = true
}

output "connection_string" {
  value     = azurerm_application_insights.this.connection_string
  sensitive = true
}
