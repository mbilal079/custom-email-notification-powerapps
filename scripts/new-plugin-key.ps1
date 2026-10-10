# Generates the strong-name key used to sign the plug-in assembly. The key is kept out of source control
# (.gitignore); keep a private backup - plug-in upgrades in an environment must be signed with the same key.
param([string]$Path = "$PSScriptRoot\..\plugins\EmailHub.Plugins\EmailHub.Plugins.snk")
if (Test-Path $Path) { Write-Host "Key already exists: $Path"; exit 0 }
$rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider 1024
[System.IO.File]::WriteAllBytes($Path, $rsa.ExportCspBlob($true))
Write-Host "Created $Path"
