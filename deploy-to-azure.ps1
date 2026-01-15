# Azure App Service Deployment Script for WhatsApp Service (PowerShell)
# This script automates the deployment process to Azure App Service

$ErrorActionPreference = "Stop"

Write-Host "=== Azure App Service Deployment Script ===" -ForegroundColor Green
Write-Host ""

# Configuration - UPDATE THESE VALUES
$RESOURCE_GROUP = "whatsapp-rg"
$APP_NAME = "whatsapp-service"
$LOCATION = "eastus"
$APP_SERVICE_PLAN = "whatsapp-plan"
$SKU = "B1"  # Change to P1V2 for production
$NODE_VERSION = "18-lts"

# Check if Azure CLI is installed
try {
    az --version | Out-Null
    Write-Host "✓ Azure CLI found" -ForegroundColor Green
} catch {
    Write-Host "Error: Azure CLI is not installed" -ForegroundColor Red
    Write-Host "Install from: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
}

# Check if logged in
Write-Host "Checking Azure login status..."
try {
    az account show | Out-Null
    Write-Host "✓ Already logged in to Azure" -ForegroundColor Green
} catch {
    Write-Host "Not logged in. Logging in..." -ForegroundColor Yellow
    az login
}

# Prompt for environment variables
Write-Host ""
Write-Host "Please provide the following environment variables:" -ForegroundColor Yellow
$WHATSAPP_API_TOKEN = Read-Host "WHATSAPP_API_TOKEN"
$WHATSAPP_PHONE_NUMBER_ID = Read-Host "WHATSAPP_PHONE_NUMBER_ID"
$WEBHOOK_VERIFY_TOKEN = Read-Host "WEBHOOK_VERIFY_TOKEN"
$HAIINDEXER_API_URL = Read-Host "HAIINDEXER_API_URL"
$WHATSAPP_APP_SECRET = Read-Host "WHATSAPP_APP_SECRET (recommended)"
$REDIS_URL = Read-Host "REDIS_URL (optional, press Enter to skip)"

# Validate required variables
if ([string]::IsNullOrWhiteSpace($WHATSAPP_API_TOKEN) -or 
    [string]::IsNullOrWhiteSpace($WHATSAPP_PHONE_NUMBER_ID) -or 
    [string]::IsNullOrWhiteSpace($WEBHOOK_VERIFY_TOKEN) -or 
    [string]::IsNullOrWhiteSpace($HAIINDEXER_API_URL)) {
    Write-Host "Error: Required environment variables not provided" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Step 1: Creating Resource Group ===" -ForegroundColor Green
try {
    az group show --name $RESOURCE_GROUP 2>$null | Out-Null
    Write-Host "Resource group already exists" -ForegroundColor Yellow
} catch {
    az group create --name $RESOURCE_GROUP --location $LOCATION
    Write-Host "✓ Resource group created" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Step 2: Creating App Service Plan ===" -ForegroundColor Green
try {
    az appservice plan show --name $APP_SERVICE_PLAN --resource-group $RESOURCE_GROUP 2>$null | Out-Null
    Write-Host "App Service plan already exists" -ForegroundColor Yellow
} catch {
    az appservice plan create `
        --name $APP_SERVICE_PLAN `
        --resource-group $RESOURCE_GROUP `
        --is-linux `
        --sku $SKU
    Write-Host "✓ App Service plan created" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Step 3: Creating Web App ===" -ForegroundColor Green
try {
    az webapp show --name $APP_NAME --resource-group $RESOURCE_GROUP 2>$null | Out-Null
    Write-Host "Web app already exists" -ForegroundColor Yellow
} catch {
    az webapp create `
        --name $APP_NAME `
        --resource-group $RESOURCE_GROUP `
        --plan $APP_SERVICE_PLAN `
        --runtime "NODE:$NODE_VERSION"
    Write-Host "✓ Web app created" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Step 4: Configuring Application Settings ===" -ForegroundColor Green

# Build settings array
$settings = @(
    "WHATSAPP_API_TOKEN=$WHATSAPP_API_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID",
    "WEBHOOK_VERIFY_TOKEN=$WEBHOOK_VERIFY_TOKEN",
    "HAIINDEXER_API_URL=$HAIINDEXER_API_URL",
    "WEBSITE_NODE_DEFAULT_VERSION=$NODE_VERSION",
    "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
)

if (-not [string]::IsNullOrWhiteSpace($WHATSAPP_APP_SECRET)) {
    $settings += "WHATSAPP_APP_SECRET=$WHATSAPP_APP_SECRET"
}

if (-not [string]::IsNullOrWhiteSpace($REDIS_URL)) {
    $settings += "REDIS_URL=$REDIS_URL"
}

az webapp config appsettings set `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --settings $settings

Write-Host "✓ Application settings configured" -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 5: Configuring Startup Command ===" -ForegroundColor Green
az webapp config set `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --startup-file "cd backend && npm start"

Write-Host "✓ Startup command configured" -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 6: Enabling HTTPS Only ===" -ForegroundColor Green
az webapp update `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --https-only true

Write-Host "✓ HTTPS Only enabled" -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 7: Configuring Deployment Source ===" -ForegroundColor Green
az webapp deployment source config-local-git `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP

Write-Host "✓ Local Git deployment configured" -ForegroundColor Green

# Get deployment URL
$DEPLOY_URL = az webapp deployment list-publishing-credentials `
    --name $APP_NAME `
    --resource-group $RESOURCE_GROUP `
    --query scmUri `
    --output tsv

Write-Host ""
Write-Host "=== Deployment Configuration Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. Add Azure remote to your Git repository:"
Write-Host "   git remote add azure $DEPLOY_URL" -ForegroundColor Green
Write-Host ""
Write-Host "2. Deploy your code:"
Write-Host "   git push azure main:master" -ForegroundColor Green
Write-Host ""
Write-Host "3. Your app will be available at:"
Write-Host "   https://$APP_NAME.azurewebsites.net" -ForegroundColor Green
Write-Host ""
Write-Host "4. Configure WhatsApp webhook:"
Write-Host "   Callback URL: https://$APP_NAME.azurewebsites.net/webhook" -ForegroundColor Green
Write-Host "   Verify Token: $WEBHOOK_VERIFY_TOKEN" -ForegroundColor Green
Write-Host ""
Write-Host "=== Deployment script completed successfully ===" -ForegroundColor Green

