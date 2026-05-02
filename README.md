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

## Quick deploy (no build needed)

A pre-built `dist/` folder is included. The fastest way to deploy:

1. Create a new GitHub repo and push this folder to `main`
2. In repo Settings → Pages → Build and deployment, set Source to "Deploy from a branch", branch `main`, folder `/dist`
3. Site goes live at `https://<your-username>.github.io/<repo-name>/`

## Local development

```bash
npm install
npm run build      # produces dist/app.js + dist/index.html
```

Then open `dist/index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000 --directory dist
```

## Auto-deploy via GitHub Actions

The included workflow at `.github/workflows/deploy.yml` will build and deploy automatically on each push to `main`. To use it:

1. Push the repo to GitHub
2. In repo Settings → Pages → Build and deployment, set Source to "GitHub Actions"
3. Push any change — it builds and deploys to `https://<your-username>.github.io/<repo-name>/`

## Tech

Single-file React app, bundled to one JS file via esbuild. No framework, no router. ~183 KB minified.
