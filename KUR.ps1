$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Once Docker Desktop kurun ve acin: https://www.docker.com/products/docker-desktop/"
}
$dockerOs = docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop calismiyor. Linux containers modunda acip tekrar deneyin." }
if ($dockerOs -ne "linux") { throw "Docker Desktop icinde Linux containers modunu secin." }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose bulunamadi. Docker Desktop kurulumunu kontrol edin." }

if (-not (Test-Path ".env")) {
    $dbPassword = New-LocalSecret
    $rootPassword = New-LocalSecret
    $sessionSecret = New-LocalSecret
    $contents = @"
NODE_ENV=development
PORT=3000
DB_PORT=3307
AUTH_PROVIDER=local
APP_ID=istasyonos-desktop
DB_PASSWORD=$dbPassword
DB_ROOT_PASSWORD=$rootPassword
SESSION_SECRET=$sessionSecret
DATABASE_URL=mysql://istasyonos:${dbPassword}@127.0.0.1:3307/istasyonos
COOKIE_SECURE=false
"@
    [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot ".env"), $contents, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Bu bilgisayara ozel .env olusturuldu. Bu dosyayi paylasmayin."
} else {
    Write-Host "Mevcut .env korunuyor."
}

docker compose up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw "Baslatma basarisiz. Ayrinti: docker compose logs --tail 80" }
$port = "3000"
$line = Get-Content ".env" | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -First 1
if ($line) { $port = ($line -split '=', 2)[1] }
$url = "http://localhost:$port"
$health = Invoke-RestMethod "$url/api/health"
if ($health.status -ne "ok") { throw "Uygulama saglik kontrolu basarisiz." }
Write-Host "IstasyonOS hazir: $url"
Write-Host "Yeni hesap olusturun. Ornek veri icin firma kurulumunda DEMO secenegini kullanin."
Start-Process $url
