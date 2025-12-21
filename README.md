# Time Scheduler

Simple single-password web app for coordinating a four-person schedule with strict weekday quotas.

## Quick start

```bash
npm install
npm start
```

Then open http://localhost:3000.

* Default password: `letmein` (override with `APP_PASSWORD`).
* Data is stored in `data/db.json`; it will be created on first run.
* Timezone is locked to Europe/Brussels.

## Features
- Password gate with short-lived cookie session.
- Fixed team of four with color labels, selectable via pills.
- Week navigation (previous/next/this week) with ISO week numbers.
- Create, edit, and delete blocks for the selected person using a modal with quick presets.
- Daily rules enforced on save: max 8h/day, max 4h before 17:00, overlap prevention, and 40h/week cap.
- After-hours status indicator (needs ≥4h after 17:00 when a day hits 8h).
- Weekly sidebar totals and simple change history (last 3 actions).
