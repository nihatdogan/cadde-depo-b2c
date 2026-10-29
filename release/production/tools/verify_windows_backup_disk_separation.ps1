# CADDE DEPO — local Windows, read-only physical disk separation preflight.
# Requires PowerShell as a user who can read both .cdp files and Get-Disk.
# Never sends archive bytes, passphrase, path, serial number, or credentials anywhere.
# This checks local disk-number difference, NOT full physical/offsite independence.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceArchive,
  [Parameter(Mandatory=$true)][string]$SecondArchive,
  [string]$ExpectedSha256 = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-LocalArchiveInfo {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  if ($item.PSIsContainer) { throw 'ARCHIVE_MUST_BE_A_FILE' }
  $drive = [System.IO.Path]::GetPathRoot($item.FullName)
  if ($drive -notmatch '^[A-Za-z]:\\$') {
    throw 'UNSUPPORTED_DRIVE_TYPE: Use a local drive letter; do not infer physical identity from UNC/cloud paths.'
  }
  $driveLetter = $drive.Substring(0,1)
  $partitions = @(Get-Partition -DriveLetter $driveLetter -ErrorAction Stop)
  if ($partitions.Count -ne 1) { throw 'AMBIGUOUS_DISK_MAPPING' }
  $disk = Get-Disk -Number $partitions[0].DiskNumber -ErrorAction Stop
  $hash = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  return [pscustomobject]@{
    DiskNumber = [int]$disk.Number
    BusType = [string]$disk.BusType
    Hash = $hash
    Size = [long]$item.Length
  }
}

if ($ExpectedSha256 -ne '' -and $ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'EXPECTED_HASH_MUST_BE_SHA256'
}
$source = Get-LocalArchiveInfo -Path $SourceArchive
$copy = Get-LocalArchiveInfo -Path $SecondArchive
if ($source.Hash -ne $copy.Hash -or $source.Size -ne $copy.Size) {
  throw 'STOP_BACKUP_HASH_OR_LENGTH_MISMATCH'
}
if ($ExpectedSha256 -ne '' -and $source.Hash -ne $ExpectedSha256.ToLowerInvariant()) {
  throw 'STOP_ARCHIVE_HASH_NOT_EXPECTED'
}
if ($source.DiskNumber -eq $copy.DiskNumber) {
  throw 'STOP_SAME_WINDOWS_DISK_NUMBER: Separate drive letters or partitions are not distinct physical disks.'
}

[ordered]@{
  outcome = 'PASS_LOCAL_HASH_AND_DISTINCT_DISK_NUMBERS_PHYSICAL_CONFIRMATION_OPEN'
  checked_at_utc = [DateTime]::UtcNow.ToString('o')
  archive_sha256 = $source.Hash
  archive_size_bytes = $source.Size
  source_disk_number = $source.DiskNumber
  second_disk_number = $copy.DiskNumber
  source_bus_type = $source.BusType
  second_bus_type = $copy.BusType
  file_hash_equal = $true
  distinct_windows_disk_numbers = $true
  physical_device_identity_manually_verified = $false
  offsite_location_verified = $false
  restore_from_this_copy_verified_by_this_script = $false
  full_managed_auth_storage_restore_proven = $false
} | ConvertTo-Json -Depth 4
