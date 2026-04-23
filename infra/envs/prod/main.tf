data "azurerm_resource_group" "velocap" {
  name = var.resource_group_name
}

# ACR is shared across dev+prod. Dev "owns" it (its Terraform creates it);
# prod references it as a data source so we can pull admin credentials into
# prod's own Key Vault without fighting over ownership.
data "azurerm_container_registry" "shared" {
  name                = "velocapcr"
  resource_group_name = data.azurerm_resource_group.velocap.name
}

locals {
  tags = {
    project = "velocap"
    env     = var.env
    owner   = "tareq@menatal.com"
    managed = "terraform"
  }
}

# -----------------------------------------------------------------------------
# Observability (separate workspace for prod — cleaner cost + query isolation)
# -----------------------------------------------------------------------------
module "log_analytics" {
  source              = "../../modules/log-analytics"
  name                = "velocap-law-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = data.azurerm_resource_group.velocap.location
  retention_in_days   = 30
  daily_quota_gb      = 2 # slightly higher than dev
  tags                = local.tags
}

module "app_insights" {
  source                     = "../../modules/app-insights"
  name                       = "velocap-appi-${var.env}"
  resource_group_name        = data.azurerm_resource_group.velocap.name
  location                   = data.azurerm_resource_group.velocap.location
  log_analytics_workspace_id = module.log_analytics.id
  retention_in_days          = 30
  tags                       = local.tags
}

# -----------------------------------------------------------------------------
# Secrets — Postgres admin password generated fresh for prod
# -----------------------------------------------------------------------------
resource "random_password" "postgres_admin" {
  length      = 32
  special     = false
  min_lower   = 4
  min_upper   = 4
  min_numeric = 4
}

# -----------------------------------------------------------------------------
# Data plane
# -----------------------------------------------------------------------------
module "storage" {
  source              = "../../modules/storage-account"
  name                = "velocapst${var.env}aue01"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = data.azurerm_resource_group.velocap.location
  tags                = local.tags
}

module "postgres" {
  source                 = "../../modules/postgres-flex"
  name                   = "velocap-pg-${var.env}"
  resource_group_name    = data.azurerm_resource_group.velocap.name
  location               = data.azurerm_resource_group.velocap.location
  administrator_login    = "velocapadmin"
  administrator_password = random_password.postgres_admin.result
  database_name          = "velocap"
  backup_retention_days  = 14 # prod gets 2x dev's 7-day PITR window
  tags                   = local.tags
}

module "key_vault" {
  source              = "../../modules/key-vault"
  name                = "velocap-kv-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = data.azurerm_resource_group.velocap.location
  tags                = local.tags
}

# -----------------------------------------------------------------------------
# KV secrets
# -----------------------------------------------------------------------------
resource "azurerm_key_vault_secret" "postgres_password" {
  name         = "postgres-admin-password"
  value        = random_password.postgres_admin.result
  key_vault_id = module.key_vault.id
}

resource "azurerm_key_vault_secret" "postgres_url" {
  name         = "database-url"
  value        = "postgres://velocapadmin:${random_password.postgres_admin.result}@${module.postgres.fqdn}:5432/${module.postgres.database_name}?sslmode=require"
  key_vault_id = module.key_vault.id
}

resource "azurerm_key_vault_secret" "storage_connection_string" {
  name         = "storage-connection-string"
  value        = module.storage.primary_connection_string
  key_vault_id = module.key_vault.id
}

resource "azurerm_key_vault_secret" "acr_password" {
  name         = "acr-admin-password"
  value        = data.azurerm_container_registry.shared.admin_password
  key_vault_id = module.key_vault.id
}

# Placeholders — set real values via `az keyvault secret set` once prod Clerk
# keys exist (may be same as dev for now on the `firm-tapir-95` test instance,
# or switch to a live Clerk instance later). ignore_changes keeps TF from
# fighting the out-of-band updates.
resource "azurerm_key_vault_secret" "clerk_secret_key" {
  name         = "clerk-secret-key"
  value        = "REPLACE_ME"
  key_vault_id = module.key_vault.id

  lifecycle {
    ignore_changes = [value]
  }
}

resource "azurerm_key_vault_secret" "clerk_publishable_key" {
  name         = "clerk-publishable-key"
  value        = "REPLACE_ME"
  key_vault_id = module.key_vault.id

  lifecycle {
    ignore_changes = [value]
  }
}

data "azurerm_key_vault_secret" "clerk_secret_key_live" {
  name         = "clerk-secret-key"
  key_vault_id = module.key_vault.id
  depends_on   = [azurerm_key_vault_secret.clerk_secret_key]
}

data "azurerm_key_vault_secret" "clerk_publishable_key_live" {
  name         = "clerk-publishable-key"
  key_vault_id = module.key_vault.id
  depends_on   = [azurerm_key_vault_secret.clerk_publishable_key]
}

# -----------------------------------------------------------------------------
# Compute
# -----------------------------------------------------------------------------
module "container_apps_env" {
  source                     = "../../modules/container-apps-env"
  name                       = "velocap-cae-${var.env}"
  resource_group_name        = data.azurerm_resource_group.velocap.name
  location                   = data.azurerm_resource_group.velocap.location
  log_analytics_workspace_id = module.log_analytics.id
  tags                       = local.tags
}

module "api" {
  source                       = "../../modules/container-app"
  name                         = "velocap-api-${var.env}"
  resource_group_name          = data.azurerm_resource_group.velocap.name
  container_app_environment_id = module.container_apps_env.id
  image                        = var.api_image
  target_port                  = 4000
  # Prod keeps one warm replica to avoid cold starts for real users.
  min_replicas       = 1
  max_replicas       = 3
  cpu                = 0.25
  memory             = "0.5Gi"
  acr_login_server   = data.azurerm_container_registry.shared.login_server
  acr_admin_username = data.azurerm_container_registry.shared.admin_username
  acr_admin_password = data.azurerm_container_registry.shared.admin_password

  env_vars = [
    # Intentionally "development" — Clerk Express rejects pk_test_*/sk_test_*
    # keys when NODE_ENV=production. Flip to "production" once a live Clerk
    # instance (pk_live_*) is provisioned for this env.
    { name = "NODE_ENV", value = "development" },
    { name = "PORT", value = "4000" },
  ]

  env_secret_refs = [
    { name = "DATABASE_URL", secret_name = "database-url" },
    { name = "STORAGE_CONNECTION_STRING", secret_name = "storage-connection-string" },
    { name = "CLERK_SECRET_KEY", secret_name = "clerk-secret-key" },
    { name = "CLERK_PUBLISHABLE_KEY", secret_name = "clerk-publishable-key" },
    { name = "APPLICATIONINSIGHTS_CONNECTION_STRING", secret_name = "appi-connection-string" },
  ]

  secrets = [
    { name = "database-url", value = azurerm_key_vault_secret.postgres_url.value },
    { name = "storage-connection-string", value = module.storage.primary_connection_string },
    { name = "clerk-secret-key", value = data.azurerm_key_vault_secret.clerk_secret_key_live.value },
    { name = "clerk-publishable-key", value = data.azurerm_key_vault_secret.clerk_publishable_key_live.value },
    { name = "appi-connection-string", value = module.app_insights.connection_string },
  ]

  tags = local.tags
}

module "dashboard" {
  source              = "../../modules/static-web-app"
  name                = "velocap-swa-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = "westeurope" # SWA not GA in uaenorth
  sku_tier            = "Free"
  tags                = local.tags
}
