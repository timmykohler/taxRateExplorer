# Federal Tax Rate Explorer

React/Vite app for visualizing 2025 federal ordinary income and long-term capital gains tax rates.

## Local setup

```powershell
cd C:\Users\timmy\Projects\github\taxrateexplorer
npm install
npm run dev
```

Then open the local Vite URL, usually:

```text
http://localhost:5173
```

## Production test

```powershell
npm run build
npm run preview
```

## Deploy to GitHub Pages

1. Create a GitHub repo named `taxrateexplorer`.
2. Push this folder to `main`.
3. In GitHub, go to **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push to `main` and wait for the workflow to finish.

Expected URL:

```text
https://YOUR-GITHUB-USERNAME.github.io/taxrateexplorer/
```
