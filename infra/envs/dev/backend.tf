# Filled in after running `terraform apply` in infra/bootstrap.
# Copy the `backend_config_snippet` output value into this block, then run
# `terraform init -migrate-state` (or just `terraform init` for a fresh env).

terraform {
  backend "azurerm" {
    resource_group_name  = "velocap-tfstate-rg"
    storage_account_name = "velocaptfstateaue01"
    container_name       = "tfstate"
    key                  = "dev.tfstate"
    # Option 2: shared-key auth. Contributor can list keys via ARM, so no
    # data-plane role assignment (Storage Blob Data Contributor) is needed.
    # To tighten later: grant the role and flip this to `use_azuread_auth = true`.
  }
}
