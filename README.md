# Party Clash

A neon-arcade multiplayer trivia game for 2–10 players.

## Features
- Create a private room and invite friends with a five-character code
- Live player list using Supabase Presence
- Real-time question and answer synchronization using Supabase Broadcast
- Five-question games, 15-second rounds, speed bonuses, and a final leaderboard
- Responsive layout for phones and laptops

## Start
See [SETUP.md](./SETUP.md) for Supabase configuration, local testing, and Vercel deployment.

```bash
npm install
cp .env.example .env
# Add your Supabase project URL and anon/publishable key to .env
npm run dev
```
Deployed with Vercel
