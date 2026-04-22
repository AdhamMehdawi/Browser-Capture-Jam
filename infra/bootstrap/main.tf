# Bootstrap: creates the Storage Account that holds Terraform state for all
# envs. This stack uses LOCAL state — it is the ONE place we accept that,
# because there's no remote backend to point to until it exists.
#
# After `terraform apply` here, paste the `backend_config_snippet` output
# into envs/<env>/backend.tf.

data "azurerm_resource_group" "tfstate" {
  name = var.tfstate_rg_name
}

resource "azurerm_storage_account" "tfstate" {
  name                            = var.tfstate_sa_name
  resource_group_name             = data.azurerm_resource_group.tfstate.name
  location                        = data.azurerm_resource_group.tfstate.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  account_kind                    = "StorageV2"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = true # Required; TF azurerm backend uses SAS

  blob_properties {
    versioning_enabled = true

    delete_retention_policy {
      days = 7
    }

    container_delete_retention_policy {
      days = 7
    }
  }

  tags = local.tags
}

resource "azurerm_storage_container" "tfstate" {
  name                  = "tfstate"
  storage_account_id    = azurerm_storage_account.tfstate.id
  container_access_type = "private"
}

locals {
  tags = {
    project = "velocap"
    owner   = "tareq@menatal.com"
    managed = "terraform"
    purpose = "bootstrap"
  }
}
