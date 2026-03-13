const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const SNAPSHOT_PREFIX = 'onchain_snapshot_top50_attack_loop_';
const BASELINE_FILE = 'onchain_snapshot_top50_loop_360.csv';

const TARGETS = {
  ON_OFF: '0x7B9EB440516A1e5f3Cb1e3593189943Da8574A64',
  BAD_MOUTH_ATTACKER: '0x71090B985Ec887977AAE1d20C141cf7a11a27380',
  SYBIL_ROOT: '0x3018018c44338B9728d02be12d632C6691E020d1'
};

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i]);
    return obj;
  });
}

function getTrust(data, address) {
  if (!data) return 'N/A';
  const node = data.find(r => r.address.toLowerCase() === address.toLowerCase());
  return node ? parseInt(node.trustValue, 10) : 'N/A';
}

function main() {
  const loops = [5, 10, 15, 20, 25, 30];
  const results = {};

  // Read Baseline
  const baselineData = readCsv(path.join(OUT_DIR, BASELINE_FILE));
  results['Baseline'] = {
    OnOff: getTrust(baselineData, TARGETS.ON_OFF),
    SybilRoot: getTrust(baselineData, TARGETS.SYBIL_ROOT)
  };

  // Read Loops
  loops.forEach(loop => {
    const file = path.join(OUT_DIR, `${SNAPSHOT_PREFIX}${loop}.csv`);
    const data = readCsv(file);
    results[`Loop ${loop}`] = {
      OnOff: getTrust(data, TARGETS.ON_OFF),
      SybilRoot: getTrust(data, TARGETS.SYBIL_ROOT)
    };
  });

  // Generate Report
  let report = `ATTACK SIMULATION REPORT\n========================\n\n`;
  report += `Target 1 (On-off & Bad-mouth Victim): ${TARGETS.ON_OFF}\n`;
  report += `Target 2 (Sybil Beneficiary): ${TARGETS.SYBIL_ROOT}\n\n`;
  report += `| Loop | On-off Trust | Sybil Root Trust |\n`;
  report += `|---|---|---|\n`;
  
  report += `| Baseline | ${results['Baseline'].OnOff} | ${results['Baseline'].SybilRoot} |\n`;
  
  loops.forEach(loop => {
    const r = results[`Loop ${loop}`];
    report += `| ${loop} | ${r.OnOff} | ${r.SybilRoot} |\n`;
  });

  report += `\nANALYSIS:\n`;
  report += `1. On-off Victim: Should show fluctuation. If Bad-mouthing is effective, average should be lower than baseline.\n`;
  report += `2. Sybil Root: Should ideally NOT increase indefinitely if Sybil resistance is working (e.g., trust saturation or graph analysis).\n`;

  const reportPath = path.join(OUT_DIR, 'attack_analysis_report.txt');
  fs.writeFileSync(reportPath, report);
  console.log(report);
}

main();
