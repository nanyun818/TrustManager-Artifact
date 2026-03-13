const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

function findBrowser() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

async function renderSvgToPng(svgPath, pngPath, width=1600, height=600) {
  const execPath = findBrowser();
  if (!execPath) throw new Error('Browser executable not found. Set PUPPETEER_EXECUTABLE_PATH to Chrome/Edge.');
  const browser = await puppeteer.launch({ headless: 'new', executablePath: execPath });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  const svg = fs.readFileSync(svgPath, 'utf8');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}</style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.waitForSelector('svg');
  const elem = await page.$('svg');
  const box = await elem.boundingBox();
  const clip = box ? { x: Math.max(0, Math.floor(box.x)), y: Math.max(0, Math.floor(box.y)), width: Math.ceil(box.width), height: Math.ceil(box.height) } : undefined;
  await page.screenshot({ path: pngPath, type: 'png', clip });
  await browser.close();
}

async function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const svgs = [
    'trust_curve_exp_beta.svg',
    'trust_curve_exp_neigh.svg',
    'trust_curve_comparison.svg',
    'behavior_means.svg',
    'fail_method_distribution.svg',
    'param_compare_counts.svg',
    'param_compare_mean.svg'
  ];
  for (const name of svgs) {
    const s = path.join(OUT, name);
    const p = path.join(OUT, name.replace(/\.svg$/i, '.png'));
    if (!fs.existsSync(s)) continue;
    await renderSvgToPng(s, p, 1600, 600);
    process.stdout.write(`${p}\n`);
  }
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });
