data "azurerm_resource_group" "velocap" {
  name = var.resource_group_name
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
# Shared observability (one LAW for dev; prod will create its own)
# -----------------------------------------------------------------------------
module "log_analytics" {
  source              = "../../modules/log-analytics"
  name                = "velocap-law-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = data.azurerm_resource_group.velocap.location
  retention_in_days   = 30
  daily_quota_gb      = 1
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
# Container Registry (shared between dev + prod; only dev creates it)
# -----------------------------------------------------------------------------
module "acr" {
  source              = "../../modules/acr"
  name                = "velocapcr"
  resource_group_name = data.azurerm_resource_group.velocap.name
  location            = data.azurerm_resource_group.velocap.location
  tags                = local.tags
}

# -----------------------------------------------------------------------------
# Secrets — Postgres admin password is generated, never committed
# -----------------------------------------------------------------------------
resource "random_password" "postgres_admin" {
  length      = 32
  special     = false
  min_lower   = 4
  min_upper   = 4
  min_numeric = 4
  # Alphanumerics only — avoids URL-encoding the whole DATABASE_URL and
  # sidesteps shell / ORM / driver edge cases. 32 chars is still
  # cryptographically strong (log2(62^32) ≈ 191 bits).
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
# Secrets written to Key Vault (Option 2: no MSI/RBAC; ACA reads these later
# either via env vars baked in at deploy time OR via KV CSI when we tighten)
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
  value        = module.acr.admin_password
  key_vault_id = module.key_vault.id
}

# Placeholders — their VALUES are set out-of-band via `az keyvault secret set`
# and we `ignore_changes` so TF doesn't fight the out-of-band writes.
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

# Read the LIVE values from KV so `terraform apply` picks up any
# out-of-band updates (from `az keyvault secret set`). These are what
# actually flow into the Container App's secret store.
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
  min_replicas                 = 0
  max_replicas                 = 2
  cpu                          = 0.25
  memory                       = "0.5Gi"
  acr_login_server             = module.acr.login_server
  acr_admin_username           = module.acr.admin_username
  acr_admin_password           = module.acr.admin_password

  env_vars = [
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
  location            = "westeurope" # SWA not in uaenorth; it's a global CDN anyway
  sku_tier            = "Free"
  tags                = local.tags
}
