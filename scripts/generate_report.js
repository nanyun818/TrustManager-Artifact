const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../out/trust_trend.csv');
const HTML_FILE = path.join(__dirname, '../out/visualization.html');

if (!fs.existsSync(HISTORY_FILE)) {
    console.error(`History file not found: ${HISTORY_FILE}`);
    process.exit(1);
}

const data = fs.readFileSync(HISTORY_FILE, 'utf8').trim().split('\n');
// Header: loop,address,group,trustValue,isBlacklisted

const parsed = [];
for(let i=1; i<data.length; i++) {
    const row = data[i].split(',');
    if (row.length < 4) continue;
    parsed.push({
        loop: parseInt(row[0]),
        address: row[1],
        group: row[2],
        trust: parseInt(row[3])
    });
}

// Group by group type
const loops = [...new Set(parsed.map(p => p.loop))].sort((a,b) => a-b);
const groups = ['Honest', 'Collusion', 'Whitewash'];
const datasets = [];

groups.forEach(g => {
    // Calculate Average Trust per loop for this group
    const avgData = loops.map(l => {
        const nodes = parsed.filter(p => p.group === g && p.loop === l);
        if (nodes.length === 0) return null; // Handle missing data points
        const sum = nodes.reduce((a, b) => a + b.trust, 0);
        return sum / nodes.length;
    });

    datasets.push({
        label: g,
        data: avgData,
        borderColor: g === 'Honest' ? 'green' : (g === 'Collusion' ? 'orange' : 'red'),
        backgroundColor: g === 'Honest' ? 'rgba(0,255,0,0.1)' : (g === 'Collusion' ? 'rgba(255,165,0,0.1)' : 'rgba(255,0,0,0.1)'),
        borderWidth: 2,
        fill: false,
        tension: 0.1
    });
});

const html = `
<!DOCTYPE html>
<html>
<head>
    <title>TrustManager Simulation Results</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: sans-serif; padding: 20px; background: #f5f5f5; }
        .container { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 1000px; margin: auto; }
        h1 { text-align: center; color: #333; }
        .stats { margin-top: 20px; padding: 10px; border-top: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Trust Evolution (Stealth Attack Mode)</h1>
        <p>Simulation Loop: ${loops[0]} to ${loops[loops.length-1]}</p>
        <canvas id="trustChart"></canvas>
        <div class="stats">
            <h3>Analysis</h3>
            <ul>
                <li><strong>Green (Honest):</strong> Baseline trust (expected ~200).</li>
                <li><strong>Orange (Collusion):</strong> Deactivated or stable nodes.</li>
                <li><strong>Red (Whitewash):</strong> Attackers attempting to regain trust. Sharp drop indicates AI detection.</li>
            </ul>
        </div>
    </div>
    <script>
        const ctx = document.getElementById('trustChart').getContext('2d');
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(loops)},
                datasets: ${JSON.stringify(datasets)}
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 220,
                        title: { display: true, text: 'Average Trust Value' }
                    },
                    x: {
                        title: { display: true, text: 'Simulation Loop' }
                    }
                },
                plugins: {
                    tooltip: {
                        mode: 'index',
                        intersect: false
                    }
                }
            }
        });
    </script>
</body>
</html>
`;

fs.writeFileSync(HTML_FILE, html);
console.log(`Report generated at: ${HTML_FILE}`);
