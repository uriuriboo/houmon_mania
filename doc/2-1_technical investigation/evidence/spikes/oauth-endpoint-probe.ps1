param(
  [Parameter(Mandatory=$true)][string]$Url,
  [string]$Method = "GET",
  [string]$Body = "",
  [string]$ContentType = "application/x-www-form-urlencoded",
  [string]$OutFile = "",
  [switch]$NoRedirect,
  [hashtable]$Headers = @{}
)
# Simple HTTP probe: prints status, selected headers, and first part of body.
# Uses HttpWebRequest so that non-2xx responses and redirects can be inspected.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$req = [System.Net.HttpWebRequest]::Create($Url)
$req.Method = $Method
$req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
$req.Accept = "application/json, text/html;q=0.9, */*;q=0.8"
if ($NoRedirect) { $req.AllowAutoRedirect = $false }
foreach ($k in $Headers.Keys) {
  if ($k -ieq "Authorization") { $req.Headers.Add("Authorization", $Headers[$k]) }
  elseif ($k -ieq "Accept") { $req.Accept = $Headers[$k] }
  else { $req.Headers.Add($k, $Headers[$k]) }
}
if ($Body -ne "") {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
  $req.ContentType = $ContentType
  $req.ContentLength = $bytes.Length
  $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
}
try { $resp = $req.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if ($null -eq $resp) { Write-Output ("ERROR: " + $_.Exception.Message); exit 0 } }
Write-Output ("STATUS: " + [int]$resp.StatusCode + " " + $resp.StatusDescription)
Write-Output ("FINAL URL: " + $resp.ResponseUri)
Write-Output "HEADERS:"
foreach ($h in $resp.Headers.AllKeys) { Write-Output ("  " + $h + ": " + $resp.Headers[$h]) }
$sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
$content = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
if ($OutFile -ne "") { [System.IO.File]::WriteAllText($OutFile, $content, (New-Object System.Text.UTF8Encoding($false))) }
Write-Output ("BODY LENGTH: " + $content.Length)
$max = [Math]::Min(1500, $content.Length)
Write-Output "BODY (first $max chars):"
Write-Output $content.Substring(0, $max)
