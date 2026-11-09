# Windows: 이 폴더 내용을 사용자 전역 설정(~\.claude)에 적용합니다. 기존 파일은 백업 후 덮어씁니다.
$dst = Join-Path $env:USERPROFILE ".claude"
$ts = Get-Date -Format "yy_MM_dd_HHmm"
New-Item -ItemType Directory -Force -Path "$dst\agents" | Out-Null
foreach ($f in "CLAUDE.md") {
  if (Test-Path "$dst\$f") { Copy-Item "$dst\$f" "$dst\$f.bak_$ts" }
  Copy-Item "$PSScriptRoot\$f" "$dst\$f" -Force
}
Copy-Item "$PSScriptRoot\agents\*.md" "$dst\agents\" -Force
# settings.json 은 기존 설정을 유지하고 model 만 지정
$sp = "$dst\settings.json"
if (Test-Path $sp) { Copy-Item $sp "$sp.bak_$ts"; $j = Get-Content $sp -Raw | ConvertFrom-Json } else { $j = [pscustomobject]@{} }
$j | Add-Member -NotePropertyName model -NotePropertyValue "sonnet" -Force
$j | ConvertTo-Json -Depth 20 | Set-Content $sp -Encoding UTF8
Write-Host "적용 완료: $dst"
