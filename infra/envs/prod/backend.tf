terraform {
  backend "azurerm" {
    resource_group_name  = "velocap-tfstate-rg"
    storage_account_name = "velocaptfstateaue01"
    container_name       = "tfstate"
    key                  = "prod.tfstate"
    # Shared-key auth via ARM listKeys (see envs/dev/backend.tf for rationale).
  }
}
