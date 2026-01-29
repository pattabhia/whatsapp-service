# Diagnostic script for WhatsApp webhook issues
# This helps identify why messages aren't being received

$ResourceGroup = "Hai-indexer"
$ContainerName = "whatsapp-service"
$WebhookUrl = "https://whatsapp-endpoint-brfzadgkhjgaetge.z03.azurefd.net/webhook"

Write-Host "=== WhatsApp Webhook Diagnostics ===" -ForegroundColor Green
Write-Host ""

# Step 1: Check container status
Write-Host "1. Checking container status..." -ForegroundColor Cyan
az container show --resource-group $ResourceGroup --name $ContainerName --query "{state:instanceView.state, restartCount:instanceView.currentState.startTime}" --output table
Write-Host ""

# Step 2: Test webhook verification (GET request)
Write-Host "2. Testing webhook verification (GET)..." -ForegroundColor Cyan
$verifyUrl = "$WebhookUrl`?hub.mode=subscribe&hub.verify_token=Haiindexer-service&hub.challenge=test123"
Write-Host "URL: $verifyUrl" -ForegroundColor Gray
try {
    $response = Invoke-WebRequest -Uri $verifyUrl -Method Get -UseBasicParsing
    Write-Host "✅ Verification successful! Response: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "❌ Verification failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Step 3: Test webhook POST endpoint
Write-Host "3. Testing webhook POST endpoint..." -ForegroundColor Cyan
$testPayload = @{
    object = "whatsapp_business_account"
    entry = @(
        @{
            changes = @(
                @{
                    value = @{
                        messages = @(
                            @{
                                id = "test-message-123"
                                from = "1234567890"
                                type = "text"
                                text = @{
                                    body = "Test message"
                                }
                            }
                        )
                    }
                }
            )
        }
    )
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-WebRequest -Uri $WebhookUrl -Method Post -Body $testPayload -ContentType "application/json" -UseBasicParsing
    Write-Host "✅ POST successful! Status: $($response.StatusCode)" -ForegroundColor Green
} catch {
    Write-Host "❌ POST failed: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Step 4: View recent logs
Write-Host "4. Viewing recent container logs..." -ForegroundColor Cyan
Write-Host "--- Last 50 lines ---" -ForegroundColor Gray
az container logs --resource-group $ResourceGroup --name $ContainerName
Write-Host ""

# Step 5: Check environment variables
Write-Host "5. Checking environment variables..." -ForegroundColor Cyan
az container show --resource-group $ResourceGroup --name $ContainerName --query "containers[0].environmentVariables[].{Name:name}" --output table
Write-Host ""

Write-Host "=== Diagnostic Summary ===" -ForegroundColor Yellow
Write-Host "If verification works but you're not receiving messages from WhatsApp:" -ForegroundColor White
Write-Host "1. Check Meta Developer Console webhook configuration" -ForegroundColor White
Write-Host "2. Ensure webhook URL is: $WebhookUrl" -ForegroundColor White
Write-Host "3. Ensure verify token is: Haiindexer-service" -ForegroundColor White
Write-Host "4. Check that webhook is subscribed to 'messages' events" -ForegroundColor White
Write-Host "5. Verify the phone number is registered and approved" -ForegroundColor White
Write-Host ""
Write-Host "To follow logs in real-time:" -ForegroundColor Yellow
Write-Host "az container logs --resource-group $ResourceGroup --name $ContainerName --follow" -ForegroundColor Cyan

