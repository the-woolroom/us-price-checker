// Mirrors the sync logic in index.html's runSync()/fetchAllProducts(), so price-history.json
// stays in the exact same shape the price-checker page and the screenshot automation expect.
const fs = require('fs');

const STORE_URL = 'https://www.thewoolroom.com/en-us';
const HISTORY_FILE = 'price-history.json';
const bundlePattern = /\b(bundle|set|kit|pack|collection)\b/i;

async function fetchAllProducts() {
  let all = [], page = 1;
  while (true) {
    const res = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const json = await res.json();
    if (!json.products?.length) break;
    all.push(...json.products);
    if (json.products.length < 250) break;
    page++;
  }
  return all;
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return {};
  return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
}

async function main() {
  const hist = loadHistory();
  const products = await fetchAllProducts();
  const now = new Date().toISOString();
  const seenSkus = new Set();
  const newRows = [];

  for (const p of products) {
    const tags = (p.tags || []).join(' ').toLowerCase();
    if (tags.includes('rest of world')) continue;
    if (tags.includes('canada')) continue;
    const titleAndTags = `${p.title} ${tags}`;
    if (bundlePattern.test(titleAndTags)) continue;

    for (const v of p.variants) {
      if (!v.sku) continue;
      const sku = v.sku;
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);

      const priceNum = parseFloat(v.price);
      const rrpNum = v.compare_at_price ? parseFloat(v.compare_at_price) : null;
      const currency = 'USD';

      const skuHistory = hist[sku] || [];
      const rrpHistory = hist[sku + '_rrp'] || [];
      const prev = skuHistory[skuHistory.length - 1];
      const prevPrice = prev ? prev.price : null;
      const prevRrp = rrpHistory.length ? rrpHistory[rrpHistory.length - 1].price : null;

      let changeType = 'same';
      if (!prev) changeType = 'new';
      else if (priceNum > prevPrice) changeType = 'up';
      else if (priceNum < prevPrice) changeType = 'down';

      if (changeType !== 'same') {
        skuHistory.push({ price: priceNum, currency, ts: now });
        hist[sku] = skuHistory;
      }

      if (rrpNum !== null && rrpNum !== prevRrp) {
        rrpHistory.push({ price: rrpNum, currency, ts: now });
        hist[sku + '_rrp'] = rrpHistory;
      }

      const changedAt = changeType !== 'same'
        ? now
        : (skuHistory.length > 0 ? skuHistory[skuHistory.length - 1].ts : now);

      const prevForPct = skuHistory.length > 1 ? skuHistory[skuHistory.length - 2].price : null;
      const lastPrice = skuHistory.length > 0 ? skuHistory[skuHistory.length - 1].price : priceNum;
      const pct = (prevForPct && prevForPct !== 0)
        ? ((lastPrice - prevForPct) / prevForPct * 100)
        : null;

      let lastChangeType = changeType;
      if (changeType === 'same' && skuHistory.length > 1) {
        const a = skuHistory[skuHistory.length - 2].price;
        const b = skuHistory[skuHistory.length - 1].price;
        lastChangeType = b > a ? 'up' : b < a ? 'down' : 'same';
      }

      const url = `${STORE_URL}/products/${p.handle}?variant=${v.id}`;

      newRows.push({
        sku, product: p.title, variant: v.title === 'Default Title' ? '' : v.title,
        price: priceNum, rrp: rrpNum, currency, prevPrice, changeType: lastChangeType, pct, changedAt, syncTs: now,
        handle: p.handle, variantId: v.id, url,
      });
    }
  }

  hist._rows = newRows;
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(hist, null, 2));
  console.log(`Synced ${newRows.length} SKUs, ${newRows.filter(r => r.changeType !== 'same').length} changed this run.`);
}

main().catch(err => { console.error(err); process.exit(1); });
