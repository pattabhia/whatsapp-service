# Quick status check for WhatsApp service

$ResourceGroup = "Hai-indexer"
$ContainerName = "whatsapp-service"

Write-Host "=== WhatsApp Service Status ===" -ForegroundColor Green
Write-Host ""

# Container status
Write-Host "Container Status:" -ForegroundColor Cyan
az container show --resource-group $ResourceGroup --name $ContainerName --query "{State:instanceView.state, FQDN:ipAddress.fqdn, IP:ipAddress.ip, RestartCount:containers[0].instanceView.restartCount}" --output table

Write-Host ""
Write-Host "Environment Variables:" -ForegroundColor Cyan
az container show --resource-group $ResourceGroup --name $ContainerName --query "containers[0].environmentVariables[].{Name:name, Value:value}" --output table | Select-String -Pattern "WHATSAPP_API_TOKEN|WEBHOOK_VERIFY_TOKEN|WHATSAPP_PHONE_NUMBER_ID"

Write-Host ""
Write-Host "Recent Logs (last 20 lines):" -ForegroundColor Cyan
Write-Host "---" -ForegroundColor Gray
$logs = az container logs --resource-group $ResourceGroup --name $ContainerName 2>&1
if ($logs) {
    $logs | Select-Object -Last 20
} else {
    Write-Host "No logs available yet or container still starting..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "---" -ForegroundColor Gray
Write-Host "Webhook URL: https://whatsapp-endpoint-brfzadgkhjgaetge.z03.azurefd.net/webhook" -ForegroundColor White
Write-Host ""
Write-Host "To view live logs: .\view-live-logs.ps1" -ForegroundColor Yellow

