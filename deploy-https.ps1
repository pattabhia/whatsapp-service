# Azure Application Gateway HTTPS Setup for WhatsApp Service
# This script creates an Application Gateway with SSL termination

param(
    [Parameter(Mandatory=$true)]
    [string]$ResourceGroup = "Hai-indexer",
    
    [Parameter(Mandatory=$true)]
    [string]$Location = "eastus",
    
    [Parameter(Mandatory=$false)]
    [string]$DomainName = "whatsapp.yourdomain.com",
    
    [Parameter(Mandatory=$false)]
    [string]$BackendIP = "4.156.40.150"
)

Write-Host "🚀 Setting up HTTPS for WhatsApp Service..." -ForegroundColor Green

# Variables
$vnetName = "whatsapp-vnet"
$subnetName = "appgw-subnet"
$publicIpName = "appgw-public-ip"
$appGwName = "whatsapp-appgw"

# Step 1: Create Virtual Network for Application Gateway
Write-Host "`n📡 Creating Virtual Network..." -ForegroundColor Cyan
az network vnet create `
    --resource-group $ResourceGroup `
    --name $vnetName `
    --address-prefix 10.0.0.0/16 `
    --subnet-name $subnetName `
    --subnet-prefix 10.0.0.0/24 `
    --location $Location

# Step 2: Create Public IP for Application Gateway
Write-Host "`n🌐 Creating Public IP..." -ForegroundColor Cyan
az network public-ip create `
    --resource-group $ResourceGroup `
    --name $publicIpName `
    --allocation-method Static `
    --sku Standard `
    --location $Location

# Get the public IP address
$publicIp = az network public-ip show `
    --resource-group $ResourceGroup `
    --name $publicIpName `
    --query ipAddress `
    --output tsv

Write-Host "`n✅ Public IP Created: $publicIp" -ForegroundColor Green
Write-Host "📝 Please create a DNS A record pointing $DomainName to $publicIp" -ForegroundColor Yellow

# Step 3: Create Application Gateway
Write-Host "`n🔧 Creating Application Gateway (this may take 10-15 minutes)..." -ForegroundColor Cyan
az network application-gateway create `
    --resource-group $ResourceGroup `
    --name $appGwName `
    --location $Location `
    --vnet-name $vnetName `
    --subnet $subnetName `
    --public-ip-address $publicIpName `
    --http-settings-cookie-based-affinity Disabled `
    --http-settings-port 3000 `
    --http-settings-protocol Http `
    --frontend-port 80 `
    --sku Standard_v2 `
    --capacity 1 `
    --servers $BackendIP

Write-Host "`n✅ Application Gateway Created!" -ForegroundColor Green

# Step 4: Add HTTPS listener (requires SSL certificate)
Write-Host "`n🔒 To enable HTTPS, you need to:" -ForegroundColor Yellow
Write-Host "1. Obtain an SSL certificate for $DomainName" -ForegroundColor White
Write-Host "2. Upload it to Azure Key Vault or Application Gateway" -ForegroundColor White
Write-Host "3. Configure HTTPS listener on port 443" -ForegroundColor White

Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
Write-Host "1. Create DNS A record: $DomainName -> $publicIp" -ForegroundColor White
Write-Host "2. Run the SSL certificate setup (see deploy-https-cert.ps1)" -ForegroundColor White
Write-Host "3. Update WhatsApp webhook URL to: https://$DomainName/webhook" -ForegroundColor White

# Output summary
Write-Host "`n📊 Deployment Summary:" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "Resource Group:     $ResourceGroup" -ForegroundColor White
Write-Host "Application Gateway: $appGwName" -ForegroundColor White
Write-Host "Public IP:          $publicIp" -ForegroundColor White
Write-Host "Backend IP:         $BackendIP" -ForegroundColor White
Write-Host "Domain Name:        $DomainName" -ForegroundColor White
Write-Host "HTTP Endpoint:      http://$publicIp" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray

