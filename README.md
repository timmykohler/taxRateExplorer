# Federal Tax Rate Explorer

Vite + React app prepared for GitHub Pages.

## Local setup

```powershell
cd C:\Users\timmy\Projects\github\taxrateexplorer
Remove-Item package-lock.json -Force -ErrorAction SilentlyContinue
Remove-Item node_modules -Recurse -Force -ErrorAction SilentlyContinue
npm install
npm run build
npm run dev
```

## Deploy

Push to `main`. GitHub Actions builds `dist` and deploys it to GitHub Pages.

In GitHub, confirm:

`Settings → Pages → Build and deployment → Source → GitHub Actions`
