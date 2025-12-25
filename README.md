# Time Scheduler

Simple single-password web app for coordinating a four-person schedule with strict weekday quotas.

## Quick start

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

* Password gate is disabled for now; the login screen will let anyone in.
* Timezone is locked to Europe/Brussels.

## Persistence (PostgreSQL + Prisma)

This app uses PostgreSQL via Prisma. You must set a `DATABASE_URL` environment variable.

### Local setup

1. Create a Postgres database and copy the connection string.
2. Create a `.env` file:

   ```
   DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DBNAME"
   ```

3. Initialize the schema and generate the Prisma client:

   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   ```

### Vercel setup

1. Create a Postgres database (Vercel Postgres or any hosted Postgres).
2. Set `DATABASE_URL` in the Vercel project environment variables.
3. Run the Prisma migration:

   ```bash
   npx prisma migrate deploy
   ```

After that, deploy the app. The API routes will ensure the fixed people are created.

## Features
- Shared access (password gate disabled for now).
- Fixed team of four with color labels, selectable via pills.
- Week navigation (previous/next/this week) with ISO week numbers.
- Create, edit, and delete blocks for the selected person using a time-only modal.
- Daily rules enforced on save: max 8h/day on weekdays, max 5h across weekend, overlap prevention, and 40h/week cap.
- Weekly sidebar totals with per-person earnings and recent change history.
