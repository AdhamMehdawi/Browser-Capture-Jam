resource "azurerm_postgresql_flexible_server" "this" {
  name                = var.name
  resource_group_name = var.resource_group_name
  location            = var.location

  administrator_login    = var.administrator_login
  administrator_password = var.administrator_password

  version                       = var.postgres_version
  sku_name                      = var.sku_name
  storage_mb                    = var.storage_mb
  storage_tier                  = var.storage_tier
  backup_retention_days         = var.backup_retention_days
  geo_redundant_backup_enabled  = false
  public_network_access_enabled = var.public_network_access_enabled
  zone                          = var.zone

  authentication {
    password_auth_enabled         = true
    active_directory_auth_enabled = false
  }

  lifecycle {
    ignore_changes = [zone]
  }

  tags = var.tags
}

# Minimal firewall while we're public. Allow Azure services (the 0.0.0.0
# sentinel is Microsoft's convention for this).
# TODO: replace with VNet integration + private endpoint in hardening phase.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  count            = var.public_network_access_enabled ? 1 : 0
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.this.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  collation = "en_US.utf8"
  charset   = "UTF8"
}
