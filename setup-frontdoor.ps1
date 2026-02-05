# Azure Front Door HTTPS Setup
# Provides FREE managed SSL certificates

$ResourceGroup = "Hai-indexer"
$FrontDoorName = "whatsapp-fd"
$BackendHost = "whatsapp-service-hai.eastus.azurecontainer.io"
$BackendPort = 3000

Write-Host "Setting up Azure Front Door with FREE SSL..." -ForegroundColor Green

# Step 1: Create Front Door Profile
Write-Host "Step 1/5: Creating Front Door Profile..." -ForegroundColor Cyan
az afd profile create --resource-group $ResourceGroup --profile-name $FrontDoorName --sku Standard_AzureFrontDoor

# Step 2: Create Endpoint
Write-Host "Step 2/5: Creating Endpoint..." -ForegroundColor Cyan
$endpointName = "whatsapp-endpoint"
az afd endpoint create --resource-group $ResourceGroup --profile-name $FrontDoorName --endpoint-name $endpointName --enabled-state Enabled

# Get endpoint hostname
$endpointHostname = az afd endpoint show --resource-group $ResourceGroup --profile-name $FrontDoorName --endpoint-name $endpointName --query hostName --output tsv

Write-Host "Endpoint created: $endpointHostname" -ForegroundColor Green

# Step 3: Create Origin Group
Write-Host "Step 3/5: Creating Origin Group..." -ForegroundColor Cyan
$originGroupName = "whatsapp-origin-group"
az afd origin-group create --resource-group $ResourceGroup --profile-name $FrontDoorName --origin-group-name $originGroupName --probe-request-type GET --probe-protocol Http --probe-interval-in-seconds 30 --probe-path "/health" --sample-size 4 --successful-samples-required 3 --additional-latency-in-milliseconds 50

# Step 4: Add Origin
Write-Host "Step 4/5: Adding Backend Origin..." -ForegroundColor Cyan
$originName = "whatsapp-container"
az afd origin create --resource-group $ResourceGroup --profile-name $FrontDoorName --origin-group-name $originGroupName --origin-name $originName --host-name $BackendHost --origin-host-header $BackendHost --http-port $BackendPort --https-port 443 --priority 1 --weight 1000 --enabled-state Enabled

# Step 5: Create Route
Write-Host "Step 5/5: Creating Route..." -ForegroundColor Cyan
$routeName = "whatsapp-route"
az afd route create --resource-group $ResourceGroup --profile-name $FrontDoorName --endpoint-name $endpointName --route-name $routeName --origin-group $originGroupName --supported-protocols Http Https --https-redirect Enabled --forwarding-protocol HttpOnly --patterns-to-match "/*" --enabled-state Enabled

Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "HTTPS URL: https://$endpointHostname" -ForegroundColor Yellow
Write-Host "Webhook URL: https://$endpointHostname/webhook" -ForegroundColor Yellow
Write-Host "Verify Token: Haiindexer-service" -ForegroundColor Yellow
Write-Host ""
Write-Host "Note: Propagation may take 5-10 minutes" -ForegroundColor Cyan

