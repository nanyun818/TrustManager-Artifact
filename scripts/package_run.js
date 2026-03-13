const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function nowTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '_' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function copyIfExists(src, dstDir) {
  if (fs.existsSync(src)) {
    const bn = path.basename(src);
    fs.copyFileSync(src, path.join(dstDir, bn));
    return bn;
  }
  return null;
}

function main() {
  const ROOT = process.cwd();
  const OUT = path.join(ROOT, 'out');
  const runsDir = path.join(OUT, 'runs');
  ensureDir(runsDir);
  const tagArg = process.argv.find((x) => x.startsWith('--tag='));
  const tag = tagArg ? String(tagArg.split('=')[1]) : nowTag();
  const curDir = path.join(runsDir, tag);
  ensureDir(curDir);

  const files = [
    'pipeline_results.csv',
    'forta_alerts_live_array.json',
    'forta_alerts_live.csv',
    'labeled_dataset.csv',
    'labeled_dataset.json',
    'event_risk_scores.csv',
    'node_risk_agg.csv',
    'behavior_indicators.csv',
    'behavior_indicators.json',
    'trust_series.csv',
    'trust_series.json',
    'onchain_plan.json',
    'onchain_txs.json',
  ];
  const modelFiles = [path.join('models', 'logreg.json')];
  const copied = [];
  for (const f of files) {
    const p = path.join(OUT, f);
    const bn = copyIfExists(p, curDir);
    if (bn) copied.push({ type: 'out', file: bn });
  }
  for (const f of modelFiles) {
    const p = path.join(ROOT, f);
    const bn = copyIfExists(p, curDir);
    if (bn) copied.push({ type: 'model', file: bn });
  }

  const manifest = {
    tag,
    createdAtIso: new Date().toISOString(),
    dir: curDir,
    files: copied,
  };
  fs.writeFileSync(path.join(curDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  process.stdout.write(curDir + '\n');
}

main();
