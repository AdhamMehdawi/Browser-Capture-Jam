resource "azurerm_application_insights" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  workspace_id        = var.log_analytics_workspace_id
  application_type    = "Node.JS"
  retention_in_days   = var.retention_in_days
  tags                = var.tags
}
