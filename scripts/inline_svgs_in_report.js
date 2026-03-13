const fs = require('fs');
const path = require('path');

function main() {
  const ROOT = process.cwd();
  const reportRel = 'reports/stage_report_20251202.md';
  const reportPath = path.join(ROOT, reportRel);
  const reportDir = path.dirname(reportPath);
  let md = fs.readFileSync(reportPath, 'utf8');
  const re = /!\[([^\]]*)\]\((\.\.\/out\/[^\)]+\.svg)\)/g;
  let changed = false;
  md = md.replace(re, (_, alt, rel) => {
    const svgPath = path.normalize(path.join(reportDir, rel));
    if (!fs.existsSync(svgPath)) return _;
    const svg = fs.readFileSync(svgPath, 'utf8');
    changed = true;
    return `<div>${svg}</div>`;
  });
  if (changed) fs.writeFileSync(reportPath, md);
  process.stdout.write(changed ? 'OK\n' : 'NOCHANGE\n');
}

main();
