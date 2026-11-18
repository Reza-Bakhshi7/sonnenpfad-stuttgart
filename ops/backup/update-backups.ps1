# Weekly local copy of the encrypted Sonnenpfad backups (kept: newest 8 snapshots).
$ErrorActionPreference = 'Stop'
$root = 'C:\Thesis\App\backups'
$repo = Join-Path $root 'sonnenpfad-backups'
$archive = Join-Path $root 'archive'
git -C $repo fetch -q origin
git -C $repo reset -q --hard origin/main
New-Item -ItemType Directory -Force $archive | Out-Null
Get-ChildItem $repo -Directory | Where-Object Name -like '20*' | ForEach-Object {
  $target = Join-Path $archive $_.Name
  if (-not (Test-Path $target)) { Copy-Item $_.FullName $target -Recurse }
}
Get-ChildItem $archive -Directory | Sort-Object Name -Descending | Select-Object -Skip 8 | Remove-Item -Recurse -Force
"$(Get-Date -Format s) ok $((Get-ChildItem $archive -Directory).Count) snapshots" | Add-Content (Join-Path $root 'update-backups.log')
