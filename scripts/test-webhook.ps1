# Test the HeyReach webhook on production (or local with -BaseUrl).
#
# Usage:
#   $env:HEYREACH_WEBHOOK_SECRET = "your-secret"
#   .\scripts\test-webhook.ps1
#
#   .\scripts\test-webhook.ps1 -Secret "your-secret"
#   .\scripts\test-webhook.ps1 -BaseUrl "http://localhost:3000"

param(
  [string]$Secret = $env:HEYREACH_WEBHOOK_SECRET,
  [string]$BaseUrl = "https://crm-automation-seven.vercel.app",
  [string]$ConversationId = "test-conv-001",
  [int]$LinkedInAccountId = 123456
)

if (-not $Secret) {
  Write-Error @"
HEYREACH_WEBHOOK_SECRET is not set.

Set it for this session:
  `$env:HEYREACH_WEBHOOK_SECRET = 'your-secret'
  .\scripts\test-webhook.ps1

Or pass it directly:
  .\scripts\test-webhook.ps1 -Secret 'your-secret'
"@
  exit 1
}

$uri = "$($BaseUrl.TrimEnd('/'))/api/heyreach-webhook"

$body = @{
  lead = @{
    firstName   = "Test"
    lastName    = "Lead"
    profileUrl  = "https://linkedin.com/in/testlead"
    companyName = "Test Co"
  }
  message            = "Yes, I am interested. Can we schedule a call?"
  yourMessage        = "Hi, would you be open to a quick chat about our product?"
  conversationId     = $ConversationId
  linkedInAccountId  = $LinkedInAccountId
  linkedInAccount    = @{
    id        = $LinkedInAccountId
    firstName = "Alex"
    lastName  = "Sales"
  }
  campaignId         = 78901
  campaign           = @{
    id   = 78901
    name = "Q2 Outbound"
  }
  eventType          = "every_message_reply_received"
} | ConvertTo-Json -Depth 5

Write-Host "POST $uri" -ForegroundColor Cyan
Write-Host ""

try {
  $response = Invoke-RestMethod -Uri $uri -Method POST -Headers @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $Secret"
  } -Body $body

  Write-Host "Success:" -ForegroundColor Green
  $response | ConvertTo-Json -Depth 5
  Write-Host ""
  Write-Host "Open the admin dashboard -> Pending to review the new event." -ForegroundColor Yellow
}
catch {
  $status = $_.Exception.Response.StatusCode.value__
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  $errorBody = $reader.ReadToEnd()
  Write-Host "Failed (HTTP $status):" -ForegroundColor Red
  Write-Host $errorBody
  exit 1
}
