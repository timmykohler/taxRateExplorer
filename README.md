# Federal Tax Rate Explorer

Interactive visualizer for 2025 US federal income tax brackets, marginal and effective rates.

## Features

- **Bracket Stack view** — see how each dollar of income lands across the marginal-rate bands, with capital gains stacked on top of ordinary income
- **Rate Curves view** — marginal, blended, and effective rates plotted across the full income range (logarithmic x-axis from $10k to $3M)
- Three filing statuses: Single, Married Filing Jointly, Head of Household
- Adjustable ordinary-income / capital-gains mix via sliders, percentage inputs, or direct dollar inputs
- Live hero metrics: Total Federal Tax, Effective Rate, Blended Marginal, After-Tax Income
- Sankey flow diagram showing the path from gross income through deduction → bracket buckets → taxes/kept
- Built-in 2025 bracket reference tables for all three filing statuses

## Tax data

Uses the 2025 federal tax brackets per IRS Revenue Procedure 2024-40, with standard deductions reflecting the One Big Beautiful Bill Act adjustments ($15,750 single / $31,500 MFJ / $23,625 HoH).

**Federal only** — does not include FICA, state tax, NIIT, AMT, credits, itemized deductions, or other planning variables.

## Deploy to GitHub Pages (recommended)

The included GitHub Actions workflow builds and deploys automatically:

1. Push this folder to a GitHub repo (the included `package-lock.json` lets CI run `npm ci` reproducibly)
2. In repo **Settings → Pages → Build and deployment**, set Source to **"GitHub Actions"**
3. Push any change — the workflow runs and deploys to `https://<your-username>.github.io/<repo-name>/`

If your repo is already pushed, just push another commit to trigger the workflow (or run it manually from the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**).

## Local development

```bash
npm install
npm run build              # produces dist/app.js + dist/index.html
```

Then open `dist/index.html` directly in a browser, or serve it:

```bash
python3 -m http.server 8000 --directory dist
# visit http://localhost:8000
```

## Editing

The visual component lives in `tax_visualizer.jsx`. After edits, rebuild with `npm run build`. CI will rebuild automatically on push to `main`.

## Tech

Single-file React 18 app, bundled to one self-contained IIFE via esbuild. ~183 KB minified. No CDN dependencies at runtime (Inter font loaded from Google Fonts). No router, no framework.
