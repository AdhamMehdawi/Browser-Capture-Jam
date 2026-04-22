output "tfstate_rg_name" {
  value = data.azurerm_resource_group.tfstate.name
}

output "tfstate_sa_name" {
  value = azurerm_storage_account.tfstate.name
}

output "tfstate_container_name" {
  value = azurerm_storage_container.tfstate.name
}

output "backend_config_snippet" {
  description = "Paste into envs/<env>/backend.tf after bootstrap apply."
  value       = <<-EOT
    terraform {
      backend "azurerm" {
        resource_group_name  = "${data.azurerm_resource_group.tfstate.name}"
        storage_account_name = "${azurerm_storage_account.tfstate.name}"
        container_name       = "${azurerm_storage_container.tfstate.name}"
        key                  = "<env>.tfstate"
      }
    }
  EOT
}
