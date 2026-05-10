resource "azurerm_storage_account" "this" {
  name                            = var.name
  resource_group_name             = var.resource_group_name
  location                        = var.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = true # Option 2: ACA reads blobs via connection string in KV

  blob_properties {
    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }

    dynamic "cors_rule" {
      for_each = length(var.cors_allowed_origins) > 0 ? [1] : []
      content {
        allowed_headers    = ["*"]
        allowed_methods    = ["GET", "PUT", "HEAD", "OPTIONS"]
        allowed_origins    = var.cors_allowed_origins
        exposed_headers    = ["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type", "x-ms-request-id"]
        max_age_in_seconds = 3600
      }
    }
  }

  tags = var.tags
}

resource "azurerm_storage_container" "assets" {
  name                  = "assets"
  storage_account_id    = azurerm_storage_account.this.id
  container_access_type = "private"
}
