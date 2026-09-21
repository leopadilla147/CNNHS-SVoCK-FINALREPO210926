# Supabase Setup

1. Create a Supabase project.
2. In Supabase Dashboard, open **SQL Editor** and run `supabase/migrations/001_initial_schema.sql`.
3. Copy `.env.example` or create `.env.local`, then set the Supabase project URL and anon key used by the Vite app.
4. Deploy the Edge Functions used by privileged workflows:

```bash
supabase functions deploy create_officer
```

`kiosk_vote` is deployed from the separate `SVoCK_Kiosk` folder (the Raspberry Pi kiosk app), not from this project:

```bash
cd ../SVoCK_Kiosk
supabase functions deploy kiosk_vote
```

The setup script seeds one Chief Commissioner Auth account:

```text
chief.commissioner@cnnhs.edu
chief123
```

Change this password immediately in Supabase Auth before using real data.

The app now requires Supabase. It no longer falls back to local mock data when environment variables are missing.
