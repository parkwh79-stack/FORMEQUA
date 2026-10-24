param(
    [string]$ProjectId = 'formequa-research',
    [ValidateSet('asia-northeast3')][string]$Region = 'asia-northeast3',
    [ValidateSet('disabled', 'gcs')][string]$ArchiveBackend = 'disabled'
)
$ErrorActionPreference = 'Stop'
if ($ProjectId -ne 'formequa-research') { throw 'This configuration is scoped to the FORMEQUA project.' }
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Install Google Cloud CLI and run gcloud auth login first.' }
function Invoke-Cloud {
    param([string[]]$Arguments)
    $result = & gcloud @Arguments --project=$ProjectId --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Google Cloud operation failed. No automatic retry.' }
    return $result
}
$billing = Invoke-Cloud -Arguments @('billing','projects','describe',$ProjectId,'--format=value(billingEnabled)')
if (($billing -join '').Trim() -ne 'True') { throw 'Link a billing account / Blaze plan before creating storage or Cloud Run resources.' }
Invoke-Cloud -Arguments @('services','enable','run.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com','storage.googleapis.com','secretmanager.googleapis.com','iam.googleapis.com','cloudresourcemanager.googleapis.com')
$serviceAccount = "formequa-api@$ProjectId.iam.gserviceaccount.com"
$accounts = Invoke-Cloud -Arguments @('iam','service-accounts','list','--format=value(email)')
if ($serviceAccount -notin @($accounts)) {
    Invoke-Cloud -Arguments @('iam','service-accounts','create','formequa-api','--display-name=FORMEQUA API')
}
$buckets = Invoke-Cloud -Arguments @('storage','buckets','list','--format=value(name)')
if ($ArchiveBackend -eq 'gcs') {
    $bucket = "$ProjectId-private-reviews"
    if (("gs://$bucket") -notin @($buckets) -and $bucket -notin @($buckets)) {
        Invoke-Cloud -Arguments @('storage','buckets','create',"gs://$bucket","--location=$Region",'--uniform-bucket-level-access','--public-access-prevention')
    }
    Invoke-Cloud -Arguments @('storage','buckets','update',"gs://$bucket",'--uniform-bucket-level-access','--public-access-prevention',"--lifecycle-file=$PSScriptRoot/storage-lifecycle.json")
    $roles = Invoke-Cloud -Arguments @('iam','roles','list','--format=value(name)')
    $role = "projects/$ProjectId/roles/formequaArchive"
    $roleAction = if ($role -in @($roles)) { 'update' } else { 'create' }
    Invoke-Cloud -Arguments @('iam','roles',$roleAction,'formequaArchive',"--file=$PSScriptRoot/private-bucket-role.yaml")
    Invoke-Cloud -Arguments @('storage','buckets','add-iam-policy-binding',"gs://$bucket","--member=serviceAccount:$serviceAccount","--role=$role")
}
$repositories = Invoke-Cloud -Arguments @('artifacts','repositories','list',"--location=$Region",'--format=value(name)')
if (-not (@($repositories) | Where-Object { $_ -match '/repositories/formequa$' })) {
    Invoke-Cloud -Arguments @('artifacts','repositories','create','formequa','--repository-format=docker',"--location=$Region",'--description=FORMEQUA API images')
}
# Keep image publishing permissions away from the API identity.
$buildAccount = "formequa-build@$ProjectId.iam.gserviceaccount.com"
if ($buildAccount -notin @($accounts)) {
    Invoke-Cloud -Arguments @('iam','service-accounts','create','formequa-build','--display-name=FORMEQUA Build')
}
Invoke-Cloud -Arguments @('projects','add-iam-policy-binding',$ProjectId,"--member=serviceAccount:$buildAccount",'--role=roles/logging.logWriter','--condition=None')
Invoke-Cloud -Arguments @('projects','add-iam-policy-binding',$ProjectId,"--member=serviceAccount:$buildAccount",'--role=roles/serviceusage.serviceUsageConsumer','--condition=None')
Invoke-Cloud -Arguments @('artifacts','repositories','add-iam-policy-binding','formequa',"--location=$Region","--member=serviceAccount:$buildAccount",'--role=roles/artifactregistry.writer')
$sourceBucket = "$ProjectId-build-source"
if (("gs://$sourceBucket") -notin @($buckets) -and $sourceBucket -notin @($buckets)) {
    Invoke-Cloud -Arguments @('storage','buckets','create',"gs://$sourceBucket","--location=$Region",'--uniform-bucket-level-access','--public-access-prevention')
}
Invoke-Cloud -Arguments @('storage','buckets','add-iam-policy-binding',"gs://$sourceBucket","--member=serviceAccount:$buildAccount",'--role=roles/storage.objectViewer')
$secretNames = Invoke-Cloud -Arguments @('secrets','list','--format=value(name.basename())')
if ('formequa-pilot-password' -notin @($secretNames)) {
    Invoke-Cloud -Arguments @('secrets','create','formequa-pilot-password','--replication-policy=automatic')
}
Invoke-Cloud -Arguments @('secrets','add-iam-policy-binding','formequa-pilot-password',"--member=serviceAccount:$serviceAccount",'--role=roles/secretmanager.secretAccessor')
# No IAM key is created. Cloud Run uses its attached service identity.
Write-Output "Runtime and build identities prepared for $ProjectId; review storage mode: $ArchiveBackend. Add PILOT_PASSWORD and provider keys through Secret Manager."
