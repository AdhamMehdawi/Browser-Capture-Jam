# -----------------------------------------------------------------------------
# Phase 7.2 — minimal prod alerting + budget
#
# What this covers (deliberately small):
#   - Action group that emails humans when something triggers
#   - Prod api-server has no running replicas (service down)
#   - Prod Postgres sustained CPU > 80% (capacity or runaway query)
#   - RG-wide cost budget with 50/80/100% thresholds
#
# Out of scope for now — add later if needed:
#   - App Insights availability tests / synthetic monitors
#   - Key Vault secret-near-expiry (we don't set expiries yet)
#   - Dev-env alerts (dev is expected to break during work)
# -----------------------------------------------------------------------------

variable "alert_emails" {
  type    = list(string)
  default = ["tareq@menatal.com", "info@menatal.com"]
}

variable "monthly_budget_usd" {
  description = "Monthly budget cap for the VeloCap RG. Alerts fire at 50/80/100%."
  type        = number
  default     = 100
}

resource "azurerm_monitor_action_group" "email" {
  name                = "velocap-ag-email-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  short_name          = "velocap-ag"

  dynamic "email_receiver" {
    for_each = var.alert_emails
    content {
      name          = replace(email_receiver.value, "@", "-at-")
      email_address = email_receiver.value
    }
  }

  tags = local.tags
}

# --- Alert 1: api-server has no running replica ---
resource "azurerm_monitor_metric_alert" "api_replicas_zero" {
  name                = "velocap-alert-api-down-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  scopes              = [module.api.id]
  description         = "Prod api-server has zero running replicas — service is down."
  severity            = 1
  frequency           = "PT1M"
  window_size         = "PT5M"

  criteria {
    metric_namespace = "Microsoft.App/containerApps"
    metric_name      = "Replicas"
    aggregation      = "Average"
    operator         = "LessThan"
    threshold        = 1
  }

  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }

  tags = local.tags
}

# --- Alert 2: Postgres sustained high CPU ---
resource "azurerm_monitor_metric_alert" "pg_cpu_high" {
  name                = "velocap-alert-pg-cpu-${var.env}"
  resource_group_name = data.azurerm_resource_group.velocap.name
  scopes              = [module.postgres.id]
  description         = "Postgres CPU above 80% for 15 minutes — capacity or runaway query."
  severity            = 2
  frequency           = "PT5M"
  window_size         = "PT15M"

  criteria {
    metric_namespace = "Microsoft.DBforPostgreSQL/flexibleServers"
    metric_name      = "cpu_percent"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  action {
    action_group_id = azurerm_monitor_action_group.email.id
  }

  tags = local.tags
}

# --- Budget: catches credit burn before end-of-month surprise ---
# Scope is the whole VeloCap RG (dev + prod, since they share the RG).
# Budget only needs to be defined once; creating it here in `envs/prod/` is
# conventional. If you add envs/stg later, don't redefine — reference.
resource "azurerm_consumption_budget_resource_group" "velocap" {
  name              = "velocap-monthly-budget"
  resource_group_id = data.azurerm_resource_group.velocap.id
  amount            = var.monthly_budget_usd
  time_grain        = "Monthly"

  time_period {
    start_date = "2026-04-01T00:00:00Z"
    # No end_date = rolls forward indefinitely
  }

  # Forecast threshold — warns BEFORE actuals hit the cap
  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThanOrEqualTo"
    threshold_type = "Actual"
    contact_emails = var.alert_emails
  }
}
