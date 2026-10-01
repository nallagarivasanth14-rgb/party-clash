# Party Clash — setup and deployment

Party Clash is a browser-based multiplayer trivia game built with React, Vite, and Supabase Realtime. Players join a room using a five-character code. One player creates the room and acts as the host; the host's browser manages the round clock and scoring.

## 1. Requirements

- Node.js 20 or newer
- A free Supabase account
- A free Vercel account (for public hosting)

## 2. Configure Supabase

1. Create a project at https://supabase.com.
2. In the project dashboard, open **Project Settings → API** (or **Data API / API Keys**, depending on the dashboard layout).
3. Copy the **Project URL** and the **anon / publishable key**. Never put a `service_role` or secret key in frontend code.
4. In this project folder, copy `.env.example` to `.env`.
5. Fill in the values:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
   ```

This app uses Supabase Realtime Broadcast and Presence; it does not require database tables or SQL migrations. The project must have Realtime enabled (it is enabled by default for Supabase projects). Use a unique room code for each game.

**Important:** This is a learning/demo implementation. Room codes are discoverable by anyone who knows them, and clients can send broadcast events. Do not use this architecture for prizes, payments, sensitive data, or a competitive environment where cheating matters. For production-grade play, move game authority and score validation to a trusted server or Edge Function and add rate limits.

## 3. Run locally

From this folder:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

To test multiplayer on one computer:
- Open the URL in two separate browser profiles, or use a normal and an incognito window.
- In the first window, enter a nickname and create a room.
- In the second window, enter a different nickname and the room code, then join.
- The host clicks **Start game**.

You can also test across devices on the same Wi-Fi by opening Vite's network URL, if your firewall allows it. Both clients must use the same Supabase project configuration.

## 4. Build check

```bash
npm run build
```

A successful build creates the `dist/` folder.

## 5. Deploy to Vercel

1. Create a GitHub repository and push this project.
2. Sign in to https://vercel.com and import the repository.
3. In Vercel project settings, add these environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy. If you change environment variables later, redeploy.
5. Open the public URL on two devices and test room creation, joining, answering, scores, and replay.

Vite is detected automatically by Vercel. The build command is `npm run build`, and the output directory is `dist`.

## Game rules

- 5 randomly selected questions per game
- 15 seconds per question
- Correct answer: 500 points plus 10 points per second remaining
- Incorrect answer: 0 points
- 2–10 players per room

## Known demo limitations

- The host's browser is authoritative for the timer and scoring. If the host closes the tab mid-game, the round will stop.
- Room state is held in Realtime Broadcast, not persisted in a database. Late joiners request the current state from the host; joining is most reliable while the host remains connected.
- Presence can briefly lag while people connect or disconnect.
- This is not an anti-cheat or secure tournament system.
