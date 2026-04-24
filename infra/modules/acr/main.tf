resource "azurerm_container_registry" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "Basic"
  admin_enabled       = true # Option 2: ACA authenticates via admin user (creds stored in KV)
  # FUTURE: tag immutability requires Premium SKU (+~$160/mo). Upgrade when
  # VeloCap moves off Sponsorship; until then, convention is to push unique
  # SHA tags and never overwrite `:latest` except from CI.
  tags = var.tags
}
