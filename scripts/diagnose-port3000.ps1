[CmdletBinding()]
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000
)

# One-shot, read-only diagnostic. Never prints process command lines or env.
# Does not read .env, connect to MySQL, mutate services, or write a report file.
$ErrorActionPreference = "Stop"

function Write-Field([string]$Name, [object]$Value) {
  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) {
    $Value = "UNKNOWN"
  }
  Write-Output ("{0}={1}" -f $Name, $Value)
}

function Get-EntryToken([string]$CommandLine, [string]$ExecutablePath) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $null }
  $tokens = [regex]::Matches($CommandLine, '(?:"(?<v>[^"]*)"|(?<v>\S+))')
  foreach ($match in $tokens) {
    $value = $match.Groups["v"].Value
    if ($value -match '(?i)\.(?:mjs|cjs|js|tsx|ts)$' -and
        $value -notmatch '(?i)(?:^|[\\/])node\.exe$' -and
        $value -ne $ExecutablePath) {
      return $value
    }
  }
  return $null
}

$isAdmin = $false
try {
  $principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
  )
  $isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} catch {}

$listeners = @()
try { $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop) } catch {}

# netstat is a read-only fallback when the NetTCPIP cmdlet is restricted.
$tcpRows = @()
try {
  foreach ($line in (& netstat.exe -ano -p tcp 2>$null)) {
    if ([string]$line -match '^\s*TCP\s+(?<local>\S+)\s+(?<remote>\S+)\s+(?<state>\S+)\s+(?<pid>\d+)\s*$') {
      $localPort = 0
      $remotePort = 0
      try { $localPort = [int](($Matches.local -split ':')[-1]) } catch {}
      try { $remotePort = [int](($Matches.remote -split ':')[-1]) } catch {}
      $tcpRows += [pscustomobject]@{
        LocalEndpoint = [string]$Matches.local
        LocalPort = $localPort
        RemoteEndpoint = [string]$Matches.remote
        RemotePort = $remotePort
        State = [string]$Matches.state
        ProcessId = [int]$Matches.pid
      }
    }
  }
} catch {}

$pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
if ($pids.Count -eq 0) {
  $pids = @($tcpRows | Where-Object { $_.LocalPort -eq $Port -and $_.State -eq "LISTENING" } | Select-Object -ExpandProperty ProcessId -Unique)
}
Write-Field "PORT" $Port
if ($listeners.Count -gt 0) {
  Write-Field "LISTENER_ENDPOINTS" $listeners.Count
} else {
  Write-Field "LISTENER_ENDPOINTS" @($tcpRows | Where-Object { $_.LocalPort -eq $Port -and $_.State -eq "LISTENING" }).Count
}
if ($pids.Count -eq 0) {
  Write-Field "PORT_LISTENER" "NOT_FOUND_OR_ACCESS_DENIED"
  Write-Field "DB_IDENTITY" "UNKNOWN"
  exit 2
}

foreach ($processId in $pids) {
  $proc = $null
  $processMetadata = "CIM_OK"
  if ($isAdmin) {
    try {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
    } catch {
      $processMetadata = "CIM_ACCESS_DENIED"
    }
  } else {
    $processMetadata = "ADMIN_REQUIRED_FOR_COMMAND_LINE_AND_PARENT"
  }
  if ($null -eq $proc) { try { $proc = Get-Process -Id $processId -ErrorAction Stop } catch { $proc = $null } }

  if ($null -eq $proc) {
    Write-Field "LISTENER_PID" $processId
    Write-Field "PROCESS_METADATA" "ACCESS_DENIED_OR_EXITED"
    continue
  }

  $name = [string]$proc.Name
  $exe = [string]$proc.ExecutablePath
  if (-not $exe -and $proc.Path) { $exe = [string]$proc.Path }
  $started = $null
  if ($proc.CreationDate) {
    try { $started = ([datetime]$proc.CreationDate).ToString("o") } catch {}
  }
  if (-not $started) {
    try { $started = (Get-Process -Id $processId -ErrorAction Stop).StartTime.ToString("o") } catch {}
  }

  # The raw command line is inspected only in memory to extract a script token.
  # It is never emitted, saved, or included in an exception message.
  $entry = $null
  if ($isAdmin -and $proc.CommandLine) { $entry = Get-EntryToken ([string]$proc.CommandLine) $exe }

  Write-Field "LISTENER_PID" $processId
  Write-Field "PROCESS_NAME" $name
  Write-Field "EXECUTABLE" $exe
  Write-Field "START_TIME" $started
  Write-Field "PROCESS_METADATA" $processMetadata
  Write-Field "ENTRY_TOKEN" $entry
  if ($entry -and [IO.Path]::IsPathRooted($entry)) {
    Write-Field "ENTRY_DIRECTORY" ([IO.Path]::GetDirectoryName($entry))
  } else {
    Write-Field "ENTRY_DIRECTORY" "UNKNOWN (entry token is not absolute)"
  }
  Write-Field "WORKING_DIRECTORY" "UNKNOWN (not exposed by the process API used here)"

  $parentId = 0
  if ($isAdmin) { try { $parentId = [int]$proc.ParentProcessId } catch {} }
  $depth = 0
  while ($parentId -gt 0 -and $depth -lt 4) {
    try {
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction Stop
      if ($null -eq $parent) { break }
      Write-Field ("PARENT_{0}" -f $depth) ("{0} PID={1}" -f $parent.Name, $parent.ProcessId)
      $parentId = [int]$parent.ParentProcessId
      $depth++
    } catch {
      Write-Field ("PARENT_{0}" -f $depth) "ACCESS_DENIED"
      break
    }
  }

  if ($isAdmin) {
    try {
      $service = Get-CimInstance Win32_Service -Filter "ProcessId = $processId" -ErrorAction Stop | Select-Object -First 1
      if ($service) {
        Write-Field "WINDOWS_SERVICE" $service.Name
        Write-Field "SERVICE_STATE" $service.State
      } else {
        Write-Field "WINDOWS_SERVICE" "NO_DIRECT_SERVICE_MATCH"
      }
    } catch {
      Write-Field "WINDOWS_SERVICE" "ACCESS_DENIED_OR_UNAVAILABLE"
    }
  } else {
    Write-Field "WINDOWS_SERVICE" "ADMIN_REQUIRED"
  }

  $sockets = @($tcpRows | Where-Object { $_.ProcessId -eq $processId -and $_.State -eq "ESTABLISHED" -and $_.RemotePort -gt 0 })
  $mysqlSockets = @()
  foreach ($socket in $sockets) {
    $loopbackPeer = $socket.RemoteEndpoint -match '^(127\.|\[?::1\]?:)'
    if ($loopbackPeer) {
      $peerListeners = @($tcpRows | Where-Object { $_.LocalPort -eq $socket.RemotePort -and $_.State -eq "LISTENING" })
      foreach ($peerListener in $peerListeners) {
        try {
          $peerProcess = Get-Process -Id $peerListener.ProcessId -ErrorAction Stop
          if ($peerProcess.ProcessName -match '^(?i:mysqld|mariadbd)$') {
            $mysqlSockets += $socket
            Write-Field "OBSERVED_MYSQL_SOCKET" ("{0} -> {1} peerProcess={2} PID={3}" -f $socket.LocalEndpoint, $socket.RemoteEndpoint, $peerProcess.ProcessName, $peerProcess.Id)
          }
        } catch {}
      }
    }
  }
  if (-not $mysqlSockets.Count) { Write-Field "OBSERVED_MYSQL_SOCKET" "UNKNOWN_OR_NONE_VISIBLE (does not prove absence of DB use)" }
}

# The current public health route reports process health only; it is not a
# verified database-session identity attestation. Do not infer DB identity
# from DATABASE_URL, .env, a different SQL connection, or a DEMO marker.
Write-Field "DB_HOST" "UNKNOWN"
Write-Field "DB_PORT" "UNKNOWN"
Write-Field "DB_DATABASE" "UNKNOWN"
Write-Field "DB_CURRENT_USER" "UNKNOWN"
Write-Field "DB_SERVER_UUID" "UNKNOWN"
Write-Field "DB_APPLIED_MIGRATIONS" "UNKNOWN"
Write-Field "DB_REASON" "No existing app-owned verified-connection diagnostic is exposed by /api/health"
Write-Field "NEXT_ACTION" "Authorized operator must provide the same-session DB identity and migration summary without credentials"
