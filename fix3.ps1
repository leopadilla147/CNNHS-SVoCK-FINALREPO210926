$s = Get-Content 'AZ\seed_past_elections.sql' -Raw
$new = "'5a000000-0000-4000-8000-000000000001'::uuid,'5a000000-0000-4000-8000-000000000002'::uuid,'5a000000-0000-4000-8000-000000000003'::uuid,'5a000000-0000-4000-8000-000000000004'::uuid,'5a000000-0000-4000-8000-000000000005'::uuid"
if ($s.Contains('PERIOD_IDS')) {
    $s2 = $s.Replace('PERIOD_IDS', $new)
    Set-Content -Path 'AZ\seed_past_elections.sql' -Value $s2 -Encoding UTF8
    Write-Output 'ok'
} else {
    Write-Output 'no'
}