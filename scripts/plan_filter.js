const fs = require('fs');
const path = require('path');

function main() {
  const ROOT = path.resolve(__dirname, '..');
  const OUT = path.join(ROOT, 'out');
  const src = path.join(OUT, 'onchain_call_plan.json');
  const dst = path.join(OUT, 'onchain_call_plan.block_limit.json');
  try {
    const plan = JSON.parse(fs.readFileSync(src, 'utf8'));
    const limits = Array.isArray(plan.limits) ? plan.limits : [];
    const blocks = Array.isArray(plan.blocks) ? plan.blocks : [];
    const uniqBy = (arr, key) => {
      const seen = new Set();
      const out = [];
      for (const x of arr) {
        const k = String(x[key] || '').toLowerCase();
        if (!k) continue;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(x);
      }
      return out;
    };
    const outObj = {
      limits: uniqBy(limits, 'token'),
      blocks: uniqBy(blocks, 'spender')
    };
    fs.writeFileSync(dst, JSON.stringify(outObj, null, 2));
    process.stdout.write(dst + '\n');
  } catch (e) {
    process.stderr.write(String(e && e.message ? e.message : e) + '\n');
    process.exit(1);
  }
}

main();
