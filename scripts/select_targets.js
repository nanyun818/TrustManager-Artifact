// Select and print preset mainnet targets and block ranges with optional overrides
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function loadPresets(name) {
  const p = path.join(process.cwd(), 'scripts', 'preset_targets.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const arr = j[name] || [];
  const endOverride = process.env.PIPELINE_END ? Number(process.env.PIPELINE_END) : null;
  const winSize = process.env.BLOCK_WINDOW_SIZE ? Number(process.env.BLOCK_WINDOW_SIZE) : null;
  return arr.map(t => {
    let start = Number(t.start);
    let end = Number(t.end);
    if (endOverride) {
      end = endOverride;
      start = end - (winSize || 100000);
    }
    return { label: t.label, address: t.address, start, end };
  });
}

function main() {
  const name = process.argv[2] || 'mainnet-core';
  const targets = loadPresets(name);
  console.log('Selected preset:', name);
  for (const t of targets) {
    console.log(`${t.label}: address=${t.address} start=${t.start} end=${t.end}`);
  }
  fs.writeFileSync(path.join(process.cwd(), 'out', 'selected_targets.json'), JSON.stringify(targets, null, 2));
}

main();