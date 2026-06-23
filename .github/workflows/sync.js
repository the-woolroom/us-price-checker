const https = require('https');
const fs = require('fs');

const STORE_URL = 'https://www.thewoolroom.com/en-us';
const HISTORY_FILE = 'price-history.json';
const BUNDLE_PATTERN = /\b(bundle|set|kit|pack|collection)\b/i;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceChecker/1.0)' }
    };
    https.get(url, options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Invalid JSON from ${url}: ${data.slice(0,100)}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const hist = fs.existsSync(HISTORY_FILE)
    ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    : {};

  let all = [], page = 1;
  while (true) {
    console.log(`Fetching page ${page}...`);
    const json = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`);
    if (!json.products?.length) break;
    all.push(...json.products);
    if (json.products.length < 250) break;
    page++;
  }

  const now = new Date().toISOString();
  const seenSkus = new Set();
  const newRows = [];

  for (const p of all) {
    const tags = (p.tags || []).join(' ').toLowerCase();
    if (tags.includes('rest of world') || tags.includes('canada')) continue;
    if (BUNDLE_PATTERN.test(`${p.title} ${tags}`)) continue;

    for (const v of p.variants) {
      if (!v.sku || seenSkus.has(v.sku)) continue;
      seenSkus.add(v.sku);

      const price = parseFloat(v.price);
      const rrp   = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
      const skuHist = hist[v.sku] || [];
      const rrpHist = hist[v.sku + '_rrp'] || [];
      const prev = skuHist[skuHist.length - 1];
      const prevRrp = rrpHist.length ? rrpHist[rrpHist.length - 1].price : null;

      let changeType = prev ? (price > prev.price ? 'up' : price < prev.price ? 'down' : 'same') : 'new';

      if (changeType !== 'same') {
        skuHist.push({ price, currency: 'USD', ts: now });
        hist[v.sku] = skuHist;
      }
      if (rrp !== null && rrp !== prevRrp) {
        rrpHist.push({ price: rrp, currency: 'USD', ts: now });
        hist[v.sku + '_rrp'] = rrpHist;
      }

      const prevForPct = skuHist.length > 1 ? skuHist[skuHist.length - 2].price : null;
      const lastPrice  = skuHist.length > 0 ? skuHist[skuHist.length - 1].price : price;
      const pct = prevForPct ? ((lastPrice - prevForPct) / prevForPct * 100) : null;

      let lastChangeType = changeType;
      if (changeType === 'same' && skuHist.length > 1) {
        const a = skuHist[skuHist.length - 2].price;
        const b = skuHist[skuHist.length - 1].price;
        lastChangeType = b > a ? 'up' : b < a ? 'down' : 'same';
      }

      const changedAt = changeType !== 'same' ? now : (skuHist.length > 0 ? skuHist[skuHist.length - 1].ts : now);

      newRows.push({
        sku: v.sku, product: p.title,
        variant: v.title === 'Default Title' ? '' : v.title,
        price, rrp, currency: 'USD', prevPrice: prev?.price ?? null,
        changeType: lastChangeType, pct, changedAt, syncTs: now,
      });
    }
  }

  hist._rows = newRows;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2));
  console.log(`Synced ${newRows.length} SKUs`);
}

main().catch(e => { console.error(e); process.exit(1); });
