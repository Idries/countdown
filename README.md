# Countdown

A simple, ad-free countdown app for the dates that matter: birthdays, trips, milestones.
It's a small web app you install to your phone's home screen. It works offline and keeps
all its data on your device.

## Features

- As many countdowns as you like, sorted by soonest (or by name)
- Days to go, plus a years / months / days / weeks breakdown and a live clock
- Optional time of day (e.g. a 07:30 flight)
- Yearly repeat for birthdays and anniversaries, showing which one it is (e.g. "67th")
- Past events count up ("574 days ago")
- An optional progress bar from the day you created the countdown to the target date
- Emoji and colour for each countdown
- Export and import a backup file (menu ⋮)
- Light and dark mode follow your phone's setting

## Install on your phone

1. Open the app's URL in Chrome (Android) or Safari (iPhone).
2. Android: tap ⋮ → **Add to Home screen** / **Install app**.
   iPhone: tap Share → **Add to Home Screen**.

It then opens full-screen like a normal app and works without a connection.

## Hosting (GitHub Pages, free)

`.github/workflows/pages.yml` deploys the site whenever `main` is pushed.
Turn it on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The app is then served at `https://<your-username>.github.io/countdown/`.

## Run locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Notes

- Data is stored in the browser's `localStorage` on each device. Use **Export backup**
  now and then, especially before clearing browser data or changing phones.
- After changing any app file, bump `VERSION` in `sw.js` so installed copies pick up the update.
