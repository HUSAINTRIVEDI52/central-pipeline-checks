$packageJson = '{"name": "localit-backend", "version": "1.0.0"}'
$projectObject = $packageJson | ConvertFrom-Json
$projectName = $projectObject.name
$sonarProjectKey = $projectName.ToLower().Replace(' ', '-') -replace '[^a-z0-9._:-]', '-'

Write-Host "Derived Project Name: $projectName"
Write-Host "Generated Project Key: $sonarProjectKey"

if ($sonarProjectKey -eq "localit-backend") {
    Write-Host "Test Passed"
} else {
    Write-Host "Test Failed"
}
