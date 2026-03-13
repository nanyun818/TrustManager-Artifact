const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const STATE_FILE = path.join(__dirname, 'simulation_state.json');

function readCsv(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length < 2) return null; // Empty or header only
    const header = lines[0].split(',');
    return lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj = {};
        header.forEach((h, i) => obj[h] = vals[i]);
        return obj;
    });
}

function main() {
    // 1. Get Node Groups
    if (!fs.existsSync(STATE_FILE)) return;
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const groups = state.groups;

    const timeline = [];

    // 2. Collect Historical Data (Loop 10-100)
    for (let loop = 10; loop <= 100; loop += 10) {
        const file = path.join(OUT_DIR, `onchain_call_params_top50_ext_sim_loop_${loop}.csv`);
        const data = readCsv(file);
        if (data) processData(loop, data, timeline, groups);
    }

    // 3. Collect AI Phase Data (Loop 101-120)
    for (let loop = 101; loop <= 120; loop++) {
        const file = path.join(OUT_DIR, `onchain_snapshot_ai_loop_${loop}.csv`);
        const data = readCsv(file);
        if (data) processData(loop, data, timeline, groups);
    }

    // 4. Generate HTML
    generateHtml(timeline);
}

function processData(loop, data, timeline, groups) {
    const stats = { loop, honest: 0, on_off: 0, collusion: 0 };
    let hC=0, oC=0, cC=0;

    data.forEach(row => {
        const addr = row.address;
        // Check for trustValue (some files use trustValue, some T)
        // extended sim files: trustValue is col 1 (index 1 in some CSVs, or named 'trustValue')
        // The readCsv uses header keys.
        // extended sim header: address,trustValue,...
        // ai sim header: address,R,S,D,trustValue
        
        let trust = parseFloat(row.trustValue);
        if (isNaN(trust)) trust = 0;

        if (groups.honest.includes(addr)) { stats.honest += trust; hC++; }
        else if (groups.on_off.includes(addr)) { stats.on_off += trust; oC++; }
        else if (groups.collusion.includes(addr)) { stats.collusion += trust; cC++; }
    });

    if (hC) stats.honest /= hC;
    if (oC) stats.on_off /= oC;
    if (cC) stats.collusion /= cC;

    timeline.push(stats);
}

function generateHtml(timeline) {
    const labels = timeline.map(t => t.loop);
    const honest = timeline.map(t => t.honest);
    const onOff = timeline.map(t => t.on_off);
    const collusion = timeline.map(t => t.collusion);

    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>TrustManager AI Defense Live Results</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@2.1.0"></script>
    <style>
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; background: #f0f2f5; }
        .card { background: white; padding: 25px; border-radius: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); margin-bottom: 30px; }
        h1, h2 { color: #1a1a1a; }
        .badge { display: inline-block; padding: 5px 10px; border-radius: 4px; font-weight: bold; color: white; }
        .badge-ai { background: #6c5ce7; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🚀 Live AI Defense Simulation (Oraichain Integration)</h1>
        <p>This chart shows the <strong>real-time impact</strong> of the AI Agent on the blockchain state.</p>
        <ul>
            <li><strong>Phase 1 (Loop 0-100):</strong> Standard operation. Collusion nodes (Red) gain high trust (~183).</li>
            <li><strong>Phase 2 (Loop 105):</strong> <span class="badge badge-ai">AI TRIGGER</span> The AI Agent detects the clique and executes <code>fastRespond</code> on-chain.</li>
            <li><strong>Result:</strong> Collusion trust plummets immediately, while Honest nodes remain stable.</li>
        </ul>
        
        <div style="height: 600px; width: 100%;">
            <canvas id="mainChart"></canvas>
        </div>
    </div>

    <script>
        const ctx = document.getElementById('mainChart').getContext('2d');
        
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'Honest Nodes',
                        data: ${JSON.stringify(honest)},
                        borderColor: '#00b894',
                        backgroundColor: '#00b894',
                        borderWidth: 2,
                        pointRadius: 2,
                        tension: 0.1
                    },
                    {
                        label: 'Collusion Attackers',
                        data: ${JSON.stringify(collusion)},
                        borderColor: '#d63031',
                        backgroundColor: '#d63031',
                        borderWidth: 3,
                        pointRadius: 3,
                        tension: 0.1
                    },
                    {
                        label: 'On-Off Nodes',
                        data: ${JSON.stringify(onOff)},
                        borderColor: '#fdcb6e',
                        backgroundColor: '#fdcb6e',
                        borderWidth: 2,
                        pointRadius: 0,
                        borderDash: [5,5],
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 220,
                        title: { display: true, text: 'Trust Score (On-Chain)' }
                    },
                    x: {
                        title: { display: true, text: 'Simulation Loop' }
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                xMin: '105',
                                xMax: '105',
                                borderColor: '#6c5ce7',
                                borderWidth: 2,
                                borderDash: [5, 5],
                                label: {
                                    content: 'AI Defense Activated (Loop 105)',
                                    enabled: true,
                                    position: 'top',
                                    backgroundColor: '#6c5ce7',
                                    color: 'white'
                                }
                            }
                        }
                    },
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

    fs.writeFileSync(path.join(OUT_DIR, 'ai_integrated_charts.html'), html);
    console.log('Chart generated: ai_integrated_charts.html');
}

main();
