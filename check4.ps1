$s = Get-Content 'AZ\seed_past_elections.sql' -Raw
$needle = "array['5a000000-0000-4000-8000-000000000001'::uuid,'5a000000-0000-4000-8000-000000000002'::uuid,'5a000000-0000-4000-8000-000000000003'::uuid,'5a000000-0000-4000-8000-000000000004'::uuid,'5a000000-0000-4000-8000-000000000005'::uuid]"
$matches = [regex]::Matches($s, [regex]::Escape($needle))
Write-Output $matches.Count