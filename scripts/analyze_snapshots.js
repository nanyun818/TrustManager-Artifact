const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '../out');

function readCsv(p) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(x => x.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row = {};
    header.forEach((h, i) => row[h] = (cols[i] || '').trim());
    return row;
  });
}

const files = fs.readdirSync(OUT).filter(f => f.match(/^onchain_snapshot_top50_loop_(\d+)\.csv$/));
files.sort((a, b) => {
  const na = parseInt(a.match(/loop_(\d+)/)[1]);
  const nb = parseInt(b.match(/loop_(\d+)/)[1]);
  return na - nb;
});

const history = {}; // addr -> { loop: trust }

files.forEach(f => {
  const loop = parseInt(f.match(/loop_(\d+)/)[1]);
  const data = readCsv(path.join(OUT, f));
  data.forEach(row => {
    const addr = row.address;
    if (!history[addr]) history[addr] = {};
    history[addr][loop] = row.trustValue;
  });
});

// Calculate average trust per loop
const avgTrust = {};
files.forEach(f => {
  const loop = parseInt(f.match(/loop_(\d+)/)[1]);
  let sum = 0, count = 0;
  Object.keys(history).forEach(addr => {
    if (history[addr][loop]) {
      sum += parseFloat(history[addr][loop]);
      count++;
    }
  });
  if (count > 0) avgTrust[loop] = (sum / count).toFixed(2);
});

const reportPath = path.join(OUT, 'analysis_report.txt');
let output = '';
function log(msg) { output += msg + '\n'; }

log('Loop,AvgTrust,NodeCount');
Object.keys(avgTrust).sort((a,b)=>a-b).forEach(l => {
  log(`${l},${avgTrust[l]},50`); 
});

log('\nTop 5 Nodes Trust Evolution:');
const topNodes = Object.keys(history).slice(0, 5);
log('Loop,' + topNodes.map(a => a.substring(0,6)).join(','));
Object.keys(avgTrust).sort((a,b)=>a-b).forEach(l => {
  const row = [l];
  topNodes.forEach(addr => {
    row.push(history[addr][l] || '');
  });
  log(row.join(','));
});

fs.writeFileSync(reportPath, output);
console.log('Report written to ' + reportPath);
