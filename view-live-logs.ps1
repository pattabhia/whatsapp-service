# View live logs from WhatsApp service container
# Press Ctrl+C to stop

$ResourceGroup = "Hai-indexer"
$ContainerName = "whatsapp-service"

Write-Host "=== WhatsApp Service Live Logs ===" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Follow logs
az container logs --resource-group $ResourceGroup --name $ContainerName --follow

