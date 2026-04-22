data "azurerm_client_config" "current" {}

# Access-policy mode (not RBAC). This is the deliberate Option-2 choice:
# Tareq is Contributor only and cannot create sub-level role assignments,
# but he CAN set access policies on a Key Vault he owns.
resource "azurerm_key_vault" "this" {
  name                       = var.name
  resource_group_name        = var.resource_group_name
  location                   = var.location
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  rbac_authorization_enabled = false

  public_network_access_enabled = true

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  # The deployer keeps full secret management.
  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    secret_permissions = [
      "Get", "List", "Set", "Delete", "Recover", "Backup", "Restore", "Purge",
    ]
  }

  tags = var.tags
}

# Additional access policies (e.g. ACA Managed Identity → Get/List secrets).
resource "azurerm_key_vault_access_policy" "additional" {
  for_each = { for p in var.additional_access_policies : p.name => p }

  key_vault_id = azurerm_key_vault.this.id
  tenant_id    = data.azurerm_client_config.current.tenant_id
  object_id    = each.value.object_id

  secret_permissions = each.value.secret_permissions
}
