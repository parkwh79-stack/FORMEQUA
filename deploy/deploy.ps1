param(
    [string]$ProjectId = 'formequa-research',
    [ValidatePattern('^[a-z0-9][a-z0-9._/-]+:[a-zA-Z0-9._-]+$')][string]$Image,
    [ValidateSet('asia-northeast3')][string]$Region = 'asia-northeast3'
)
$ErrorActionPreference = 'Stop'
if ($ProjectId -ne 'formequa-research') { throw 'This deploy is scoped to the FORMEQUA project.' }
$appRoot = Split-Path -Parent $PSScriptRoot
$hadReviewStorageSetting = Test-Path Env:\FORMEQUA_REVIEW_STORAGE
$previousReviewStorageSetting = $env:FORMEQUA_REVIEW_STORAGE
Push-Location -LiteralPath $appRoot
try {
    if (-not (Test-Path -LiteralPath "$PSScriptRoot/runtime.env.yaml")) { throw 'Copy runtime.env.example.yaml to runtime.env.yaml and review the values first.' }
    if (-not $Image) { throw 'Provide the verified Artifact Registry image URI using -Image. This script does not silently rebuild an image.' }
    if (-not $Image.StartsWith("$Region-docker.pkg.dev/$ProjectId/formequa/api:")) { throw 'The image must come from this project and region.' }
    # Align public browser switches with the server. Python and Firebase
    # predeploy children inherit this setting without changing the user's shell.
    $archiveLines = @(Get-Content -LiteralPath "$PSScriptRoot/runtime.env.yaml" | Where-Object { $_ -match '^\s*ARCHIVE_BACKEND\s*:' })
    if ($archiveLines.Count -ne 1) { throw 'runtime.env.yaml must declare ARCHIVE_BACKEND exactly once.' }
    $archiveSetting = [regex]::Match($archiveLines[0], '^\s*ARCHIVE_BACKEND\s*:\s*["'']?(disabled|gcs)["'']?\s*(?:#.*)?$')
    if (-not $archiveSetting.Success) { throw 'Cloud deployment requires an explicit disabled or gcs archive backend.' }
    $env:FORMEQUA_REVIEW_STORAGE = if ($archiveSetting.Groups[1].Value -eq 'disabled') { 'disabled' } else { 'enabled' }
    & python tools/build_release.py
    if ($LASTEXITCODE -ne 0) { throw 'Release checks failed.' }
    # Hosting calls the service anonymously at the infrastructure layer; the
    # application still enforces its original password on dashboard and APIs.
    & gcloud run deploy formequa-api --project=$ProjectId --region=$Region --image=$Image `
        --service-account="formequa-api@$ProjectId.iam.gserviceaccount.com" --allow-unauthenticated `
        --min=0 --max=1 --concurrency=4 --cpu=1 --memory=1Gi --timeout=60 --cpu-throttling `
        --env-vars-file="$PSScriptRoot/runtime.env.yaml" --update-secrets='PILOT_PASSWORD=formequa-pilot-password:latest' --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deploy failed; Hosting was not deployed.' }
    # Provider secrets can be bound afterwards; no keys are embedded in sources.
    $serviceUrl = & gcloud run services describe formequa-api --project=$ProjectId --region=$Region '--format=value(status.url)'
    if ($LASTEXITCODE -ne 0) { throw 'Could not obtain the deployed service URL.' }
    $health = Invoke-RestMethod -Uri "$($serviceUrl.Trim())/api/health" -Method Get
    if ($health.status -ne 'ok' -or -not $health.calculators_ready) { throw 'Cloud Run health check failed; Hosting was not deployed.' }
    & firebase deploy --only hosting --project $ProjectId --non-interactive
    if ($LASTEXITCODE -ne 0) { throw 'Firebase Hosting deploy failed.' }
}
finally {
    if ($hadReviewStorageSetting) { $env:FORMEQUA_REVIEW_STORAGE = $previousReviewStorageSetting }
    else { Remove-Item Env:\FORMEQUA_REVIEW_STORAGE -ErrorAction SilentlyContinue }
    Pop-Location
}
