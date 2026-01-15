#!/bin/bash

# Azure App Service Deployment Script for WhatsApp Service
# This script automates the deployment process to Azure App Service

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Azure App Service Deployment Script ===${NC}"
echo ""

# Configuration - UPDATE THESE VALUES
RESOURCE_GROUP="whatsapp-rg"
APP_NAME="whatsapp-service"
LOCATION="eastus"
APP_SERVICE_PLAN="whatsapp-plan"
SKU="B1"  # Change to P1V2 for production
NODE_VERSION="18-lts"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Error: Azure CLI is not installed${NC}"
    echo "Install from: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi

echo -e "${GREEN}✓ Azure CLI found${NC}"

# Check if logged in
echo "Checking Azure login status..."
if ! az account show &> /dev/null; then
    echo -e "${YELLOW}Not logged in. Logging in...${NC}"
    az login
else
    echo -e "${GREEN}✓ Already logged in to Azure${NC}"
fi

# Prompt for environment variables
echo ""
echo -e "${YELLOW}Please provide the following environment variables:${NC}"
read -p "WHATSAPP_API_TOKEN: " WHATSAPP_API_TOKEN
read -p "WHATSAPP_PHONE_NUMBER_ID: " WHATSAPP_PHONE_NUMBER_ID
read -p "WEBHOOK_VERIFY_TOKEN: " WEBHOOK_VERIFY_TOKEN
read -p "HAIINDEXER_API_URL: " HAIINDEXER_API_URL
read -p "WHATSAPP_APP_SECRET (recommended): " WHATSAPP_APP_SECRET
read -p "REDIS_URL (optional, press Enter to skip): " REDIS_URL

# Validate required variables
if [ -z "$WHATSAPP_API_TOKEN" ] || [ -z "$WHATSAPP_PHONE_NUMBER_ID" ] || [ -z "$WEBHOOK_VERIFY_TOKEN" ] || [ -z "$HAIINDEXER_API_URL" ]; then
    echo -e "${RED}Error: Required environment variables not provided${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}=== Step 1: Creating Resource Group ===${NC}"
if az group show --name $RESOURCE_GROUP &> /dev/null; then
    echo -e "${YELLOW}Resource group already exists${NC}"
else
    az group create --name $RESOURCE_GROUP --location $LOCATION
    echo -e "${GREEN}✓ Resource group created${NC}"
fi

echo ""
echo -e "${GREEN}=== Step 2: Creating App Service Plan ===${NC}"
if az appservice plan show --name $APP_SERVICE_PLAN --resource-group $RESOURCE_GROUP &> /dev/null; then
    echo -e "${YELLOW}App Service plan already exists${NC}"
else
    az appservice plan create \
        --name $APP_SERVICE_PLAN \
        --resource-group $RESOURCE_GROUP \
        --is-linux \
        --sku $SKU
    echo -e "${GREEN}✓ App Service plan created${NC}"
fi

echo ""
echo -e "${GREEN}=== Step 3: Creating Web App ===${NC}"
if az webapp show --name $APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    echo -e "${YELLOW}Web app already exists${NC}"
else
    az webapp create \
        --name $APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --plan $APP_SERVICE_PLAN \
        --runtime "NODE:$NODE_VERSION"
    echo -e "${GREEN}✓ Web app created${NC}"
fi

echo ""
echo -e "${GREEN}=== Step 4: Configuring Application Settings ===${NC}"

# Build settings string
SETTINGS="WHATSAPP_API_TOKEN=$WHATSAPP_API_TOKEN WHATSAPP_PHONE_NUMBER_ID=$WHATSAPP_PHONE_NUMBER_ID WEBHOOK_VERIFY_TOKEN=$WEBHOOK_VERIFY_TOKEN HAIINDEXER_API_URL=$HAIINDEXER_API_URL WEBSITE_NODE_DEFAULT_VERSION=$NODE_VERSION SCM_DO_BUILD_DURING_DEPLOYMENT=true"

if [ ! -z "$WHATSAPP_APP_SECRET" ]; then
    SETTINGS="$SETTINGS WHATSAPP_APP_SECRET=$WHATSAPP_APP_SECRET"
fi

if [ ! -z "$REDIS_URL" ]; then
    SETTINGS="$SETTINGS REDIS_URL=$REDIS_URL"
fi

az webapp config appsettings set \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings $SETTINGS

echo -e "${GREEN}✓ Application settings configured${NC}"

echo ""
echo -e "${GREEN}=== Step 5: Configuring Startup Command ===${NC}"
az webapp config set \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --startup-file "cd backend && npm start"

echo -e "${GREEN}✓ Startup command configured${NC}"

echo ""
echo -e "${GREEN}=== Step 6: Enabling HTTPS Only ===${NC}"
az webapp update \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --https-only true

echo -e "${GREEN}✓ HTTPS Only enabled${NC}"

echo ""
echo -e "${GREEN}=== Step 7: Configuring Deployment Source ===${NC}"
az webapp deployment source config-local-git \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP

echo -e "${GREEN}✓ Local Git deployment configured${NC}"

# Get deployment URL
DEPLOY_URL=$(az webapp deployment list-publishing-credentials \
    --name $APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query scmUri \
    --output tsv)

echo ""
echo -e "${GREEN}=== Deployment Configuration Complete ===${NC}"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Add Azure remote to your Git repository:"
echo -e "   ${GREEN}git remote add azure $DEPLOY_URL${NC}"
echo ""
echo "2. Deploy your code:"
echo -e "   ${GREEN}git push azure main:master${NC}"
echo ""
echo "3. Your app will be available at:"
echo -e "   ${GREEN}https://$APP_NAME.azurewebsites.net${NC}"
echo ""
echo "4. Configure WhatsApp webhook:"
echo -e "   Callback URL: ${GREEN}https://$APP_NAME.azurewebsites.net/webhook${NC}"
echo -e "   Verify Token: ${GREEN}$WEBHOOK_VERIFY_TOKEN${NC}"
echo ""
echo -e "${GREEN}=== Deployment script completed successfully ===${NC}"

