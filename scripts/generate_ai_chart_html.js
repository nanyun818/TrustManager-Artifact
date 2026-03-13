const fs = require('fs');
const path = require('path');

const CSV_FILE = path.join(__dirname, '../out/ai_defense_series.csv');
const HTML_FILE = path.join(__dirname, '../out/ai_defense_chart.html');

function main() {
    if (!fs.existsSync(CSV_FILE)) {
        console.error("CSV file not found");
        return;
    }

    const lines = fs.readFileSync(CSV_FILE, 'utf8').split('\n').filter(l => l.trim());
    const header = lines[0].split(',');
    const data = lines.slice(1).map(line => {
        const vals = line.split(',');
        return {
            loop: vals[0],
            honest: vals[1],
            collusion_orig: vals[2],
            collusion_ai: vals[3]
        };
    });

    const labels = data.map(d => `Loop ${d.loop}`);
    const honestData = data.map(d => d.honest);
    const collOrigData = data.map(d => d.collusion_orig);
    const collAiData = data.map(d => d.collusion_ai);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>AI Defense Analysis (Oraichain)</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: 'Segoe UI', sans-serif; padding: 20px; background: #f5f7fa; }
        .card { background: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-bottom: 20px; }
        h2 { color: #2c3e50; margin-top: 0; }
        .highlight { color: #2980b9; font-weight: bold; }
        .summary-box { display: flex; gap: 20px; margin-bottom: 20px; }
        .stat-card { flex: 1; background: #ecf0f1; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-val { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .stat-label { font-size: 14px; color: #7f8c8d; }
    </style>
</head>
<body>

    <div class="card">
        <h2>🛡️ AI-Enhanced Sybil Defense (Oraichain Integration)</h2>
        <p>This chart demonstrates the impact of integrating <strong>Oraichain MCP</strong> to detect and penalize collusion attacks.</p>
        <p>The <strong>AI Model</strong> analyzes the transaction graph off-chain. At <strong>Loop 50</strong>, it identifies the "Ballot Stuffing" clique and triggers a smart contract penalty.</p>
        
        <div class="summary-box">
            <div class="stat-card" style="border-left: 5px solid #e74c3c;">
                <div class="stat-val">183.0</div>
                <div class="stat-label">Attack Score (No Defense)</div>
            </div>
            <div class="stat-card" style="border-left: 5px solid #3498db;">
                <div class="stat-val">54.9</div>
                <div class="stat-label">Defended Score (With AI)</div>
            </div>
            <div class="stat-card" style="border-left: 5px solid #27ae60;">
                <div class="stat-val">-70%</div>
                <div class="stat-label">Trust Reduction Efficiency</div>
            </div>
        </div>

        <div style="height: 500px;">
            <canvas id="defenseChart"></canvas>
        </div>
    </div>

    <div class="card">
        <h2>📝 Paper Conclusions</h2>
        <ul>
            <li><strong>Vulnerability:</strong> Standard linear weighting algorithms (Red Line) are susceptible to Sybil/Collusion attacks, assigning high trust (~183) to malicious nodes.</li>
            <li><strong>Solution:</strong> By integrating an AI-driven "Sybil Hunter" module (simulated via Oraichain MCP), the system can dynamically detect graph anomalies.</li>
            <li><strong>Impact:</strong> Upon detection (Loop 50), the malicious nodes' trust score is immediately suppressed (Blue Line), neutralizing their influence in the network.</li>
        </ul>
    </div>

    <script>
        const ctx = document.getElementById('defenseChart').getContext('2d');
        new Chart(ctx, {
            type: 'line',
            data: {
                labels: ${JSON.stringify(labels)},
                datasets: [
                    {
                        label: 'Honest Nodes (Baseline)',
                        data: ${JSON.stringify(honestData)},
                        borderColor: '#27ae60', // Green
                        borderDash: [5, 5],
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0
                    },
                    {
                        label: 'Collusion Attack (Standard Algorithm)',
                        data: ${JSON.stringify(collOrigData)},
                        borderColor: '#e74c3c', // Red
                        backgroundColor: 'rgba(231, 76, 60, 0.1)',
                        borderWidth: 3,
                        tension: 0.4
                    },
                    {
                        label: 'Collusion Attack (With AI Defense)',
                        data: ${JSON.stringify(collAiData)},
                        borderColor: '#2980b9', // Blue
                        backgroundColor: 'rgba(41, 128, 185, 0.2)',
                        borderWidth: 4,
                        pointRadius: 4,
                        tension: 0.1,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 255,
                        title: { display: true, text: 'Trust Score (0-255)' }
                    },
                    x: {
                        title: { display: true, text: 'Simulation Time (Loops)' }
                    }
                },
                plugins: {
                    annotation: {
                        annotations: {
                            line1: {
                                type: 'line',
                                xMin: 'Loop 50',
                                xMax: 'Loop 50',
                                borderColor: 'black',
                                borderWidth: 2,
                                borderDash: [2, 2],
                                label: {
                                    content: 'AI Detection Triggered',
                                    enabled: true,
                                    position: 'top'
                                }
                            }
                        }
                    }
                }
            }
        });
    </script>
</body>
</html>
    `;

    fs.writeFileSync(HTML_FILE, htmlContent);
    console.log(`Generated HTML Chart: ${HTML_FILE}`);
}

main();
