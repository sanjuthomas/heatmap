# S&P 500 heatmap

A static site that draws the S&P 500 as a heatmap:

- **Box size** is the stock’s weight in SPY, the ETF that tracks the index.
- **Color** is the latest price compared with an earlier close. Day is the default. Week, month, quarter, and year are available on the page. Green is up, red is down.
- Quotes refresh every 5 minutes while the page is open.

The page itself is only HTML, CSS, and JavaScript, so it can be hosted on GitHub Pages. Live prices and index weights cannot be read from the browser (the feeds do not allow it), so a small [Cloud Run](https://cloud.google.com/run) service fetches them and the page calls that service.

## Run it locally

```bash
cd api
npm install
npm start
```

In another terminal:

```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the service on port 8787. If that port is taken, start the API with `PORT=8790 npm start` and point the proxy in `web/vite.config.js` at the same port.

## Host the page on GitHub

1. Push this repo to GitHub.
2. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the `web` app on every push to `main`.

The published page still needs the quote service URL. After Cloud Run is up, either:

- paste that URL into the box on the page (it is saved in this browser), or
- set `apiBase` in `web/public/config.json` to the Cloud Run origin, with no trailing slash, and push again.

You can also open the site as `https://<you>.github.io/<repo>/?api=https://<service>.run.app`.

## Host the quote service on Cloud Run

From this repo, with the [gcloud CLI](https://cloud.google.com/sdk/docs/install) logged in and a project selected:

```bash
gcloud run deploy sp500-heatmap \
  --source api \
  --region us-east1 \
  --allow-unauthenticated \
  --memory 256Mi \
  --max-instances 2
```

Use the service URL it prints as `apiBase`. The service caches quotes for 15 seconds, so many visitors share one request to the quote feed.

## Data

| Piece | Source |
| --- | --- |
| Latest price and previous close | CNBC public quote endpoint |
| Index weight | State Street’s daily SPY holdings |
| Sector | Wikipedia’s S&P 500 list, via the [s-and-p-500-companies](https://github.com/datasets/s-and-p-500-companies) dataset |

SPY weights are the float-adjusted index weights, including separate boxes for dual share classes such as GOOGL and GOOG. Holdings are published with a short lag; the page shows that date. Quotes are unofficial and can be delayed. Outside the regular session, the color uses the latest pre-market or after-hours price, still measured against the previous official close.

This is a personal market view, not investment advice.
