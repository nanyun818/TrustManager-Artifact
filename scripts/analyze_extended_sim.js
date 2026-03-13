const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const STATE_FILE = path.join(__dirname, 'simulation_state.json');
const REPORT_FILE = path.join(OUT_DIR, 'extended_sim_report.txt');

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

function getAvgTrust(data, addresses) {
  if (!data || !addresses || addresses.length === 0) return 0;
  let sum = 0;
  let count = 0;
  const addrSet = new Set(addresses.map(a => a.toLowerCase()));
  
  data.forEach(row => {
    if (addrSet.has(row.address.toLowerCase())) {
      sum += parseInt(row.trustValue, 10);
      count++;
    }
  });
  
  return count === 0 ? 0 : (sum / count).toFixed(1);
}

function main() {
  // 1. Get Groups
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  const groups = state.groups;
  
  // 2. Scan for Snapshot Files
  const files = fs.readdirSync(OUT_DIR)
    .filter(f => f.startsWith('onchain_snapshot_top50_ext_sim_loop_') && f.endsWith('.csv'))
    .sort((a, b) => {
      const numA = parseInt(a.match(/loop_(\d+)/)[1]);
      const numB = parseInt(b.match(/loop_(\d+)/)[1]);
      return numA - numB;
    });

  const results = {}; // loop -> { honest, on_off, collusion }

  files.forEach(f => {
    const loop = parseInt(f.match(/loop_(\d+)/)[1]);
    const data = readCsv(path.join(OUT_DIR, f));
    
    results[loop] = {
      honest: getAvgTrust(data, groups.honest),
      on_off: getAvgTrust(data, groups.on_off),
      collusion: getAvgTrust(data, groups.collusion)
    };
  });

  // 3. Generate Report
  let report = `EXTENDED SIMULATION REPORT (100 Loops)\n======================================\n\n`;
  report += `Groups:\n`;
  report += `- Honest (${groups.honest.length} nodes): Always Good\n`;
  report += `- On-Off (${groups.on_off.length} nodes): Good 10 loops, Bad 5 loops\n`;
  report += `- Collusion (${groups.collusion.length} nodes): Mediocre performance + Ballot Stuffing\n\n`;
  
  report += `| Loop | Honest Avg | On-Off Avg | Collusion Avg |\n`;
  report += `|---|---|---|---|\n`;
  
  Object.keys(results).sort((a,b) => a-b).forEach(loop => {
    const r = results[loop];
    report += `| ${loop} | ${r.honest} | ${r.on_off} | ${r.collusion} |\n`;
  });

  report += `\nAnalysis:\n`;
  report += `- Honest nodes should maintain high trust (Level 3, >180).\n`;
  report += `- On-Off nodes should fluctuate but generally stay lower than Honest nodes due to slow recovery.\n`;
  report += `- Collusion nodes should be suppressed by the recommendation algorithm (EigenTrust-like), preventing them from overtaking Honest nodes despite mutual high ratings.\n`;

  fs.writeFileSync(REPORT_FILE, report);
  console.log(`Report generated at: ${REPORT_FILE}`);
  
  // Output JSON for Chart generation
  const chartData = {
    labels: Object.keys(results).sort((a,b) => a-b),
    datasets: {
      honest: Object.keys(results).sort((a,b) => a-b).map(k => results[k].honest),
      on_off: Object.keys(results).sort((a,b) => a-b).map(k => results[k].on_off),
      collusion: Object.keys(results).sort((a,b) => a-b).map(k => results[k].collusion)
    }
  };
  fs.writeFileSync(path.join(OUT_DIR, 'extended_sim_data.json'), JSON.stringify(chartData, null, 2));
}

main();
