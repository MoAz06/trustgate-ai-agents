$ProjectId = $env:PROJECT_ID
if (-not $ProjectId) { $ProjectId = "trustgate-hackathon" }

$Region = $env:REGION
if (-not $Region) { $Region = "us-central1" }

$ServiceName = $env:SERVICE_NAME
if (-not $ServiceName) { $ServiceName = "trustgate" }

$FivetranConnectionId = $env:FIVETRAN_CONNECTION_ID
if (-not $FivetranConnectionId) { $FivetranConnectionId = "fulfill_pageant" }

$VertexProjectId = $env:VERTEX_PROJECT_ID
if (-not $VertexProjectId) { $VertexProjectId = $ProjectId }

$VertexLocation = $env:VERTEX_LOCATION
if (-not $VertexLocation) { $VertexLocation = "global" }

$VertexModel = $env:VERTEX_MODEL
if (-not $VertexModel) { $VertexModel = "gemini-3.5-flash" }

$ErrorActionPreference = "Stop"

$Gcloud = $env:GCLOUD_BIN
if (-not $Gcloud) { $Gcloud = "gcloud" }
if (-not (Get-Command $Gcloud -ErrorAction SilentlyContinue)) {
  throw "gcloud was not found on PATH. Run this from the Google Cloud SDK terminal, or set GCLOUD_BIN to the full path of gcloud.cmd."
}

function Read-SecretPlainText($Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Create-SecretNoNewline($Name, $Value) {
  $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) "$Name-$([guid]::NewGuid()).txt"
  try {
    [System.IO.File]::WriteAllText($tempFile, $Value, [System.Text.Encoding]::ASCII)
    & $Gcloud secrets create $Name --data-file=$tempFile
  } finally {
    if (Test-Path $tempFile) {
      Remove-Item -LiteralPath $tempFile -Force
    }
  }
}

$BigQueryProjectId = $env:BIGQUERY_PROJECT_ID
if (-not $BigQueryProjectId) { $BigQueryProjectId = $ProjectId }

$BigQueryDataset = $env:BIGQUERY_DATASET
if (-not $BigQueryDataset) { $BigQueryDataset = "trustgate_demo" }

$BigQueryTable = $env:BIGQUERY_TABLE
if (-not $BigQueryTable) { $BigQueryTable = "customers" }

& $Gcloud config set project $ProjectId

& $Gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  secretmanager.googleapis.com `
  bigquery.googleapis.com `
  aiplatform.googleapis.com

$ProjectNumber = & $Gcloud projects describe $ProjectId --format="value(projectNumber)"
$CloudRunServiceAccount = $env:CLOUD_RUN_SERVICE_ACCOUNT
if (-not $CloudRunServiceAccount) { $CloudRunServiceAccount = "$ProjectNumber-compute@developer.gserviceaccount.com" }

& $Gcloud projects add-iam-policy-binding $ProjectId `
  --member "serviceAccount:$CloudRunServiceAccount" `
  --role roles/bigquery.jobUser `
  --condition=None | Out-Null

& $Gcloud projects add-iam-policy-binding $ProjectId `
  --member "serviceAccount:$CloudRunServiceAccount" `
  --role roles/bigquery.dataViewer `
  --condition=None | Out-Null

& $Gcloud projects add-iam-policy-binding $ProjectId `
  --member "serviceAccount:$CloudRunServiceAccount" `
  --role roles/aiplatform.user `
  --condition=None | Out-Null

$KeyExists = & $Gcloud secrets describe fivetran-api-key 2>$null
if (-not $KeyExists) {
  $FivetranApiKey = Read-SecretPlainText "Fivetran API key"
  Create-SecretNoNewline "fivetran-api-key" $FivetranApiKey
}

$SecretExists = & $Gcloud secrets describe fivetran-api-secret 2>$null
if (-not $SecretExists) {
  $FivetranApiSecret = Read-SecretPlainText "Fivetran API secret"
  Create-SecretNoNewline "fivetran-api-secret" $FivetranApiSecret
}

# MinInstances keeps one warm instance so the live URL has no cold start during
# recording and the judging period (2026-06-22 to 2026-07-06). Set MIN_INSTANCES=0
# after judging to stop paying for an idle instance.
$MinInstances = $env:MIN_INSTANCES
if (-not $MinInstances) { $MinInstances = "1" }

# Freshness SLA in minutes for the data-freshness policy signal. Default 1440 (24h).
# Raise it if the Fivetran connector syncs less often than this.
$FreshnessSlaMinutes = $env:FRESHNESS_SLA_MINUTES
if (-not $FreshnessSlaMinutes) { $FreshnessSlaMinutes = "1440" }

& $Gcloud run deploy $ServiceName `
  --source . `
  --region $Region `
  --allow-unauthenticated `
  --min-instances $MinInstances `
  --set-env-vars "FIVETRAN_CONNECTION_ID=$FivetranConnectionId,BIGQUERY_PROJECT_ID=$BigQueryProjectId,BIGQUERY_DATASET=$BigQueryDataset,BIGQUERY_TABLE=$BigQueryTable,VERTEX_PROJECT_ID=$VertexProjectId,VERTEX_LOCATION=$VertexLocation,VERTEX_MODEL=$VertexModel,FRESHNESS_SLA_MINUTES=$FreshnessSlaMinutes" `
  --set-secrets "FIVETRAN_API_KEY=fivetran-api-key:latest,FIVETRAN_API_SECRET=fivetran-api-secret:latest"

$ServiceUrl = & $Gcloud run services describe $ServiceName --region $Region --format="value(status.url)"

Write-Host ""
Write-Host "TrustGate deployed:"
Write-Host $ServiceUrl
Write-Host ""
Write-Host "Test:"
Write-Host "curl $ServiceUrl/api/fivetran/evidence"
Write-Host "curl $ServiceUrl/api/bigquery/evidence"
Write-Host "curl -X POST $ServiceUrl/api/agent/run -H `"Content-Type: application/json`" -d `"{\`"agent_id\`":\`"customer_recovery_agent\`",\`"action_type\`":\`"approve_refund\`",\`"customer_id\`":\`"C-1042\`",\`"amount\`":75,\`"reason\`":\`"late_delivery\`"}`""
