const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const HTML_FILE = path.join(OUT_DIR, 'attack_charts.html');

// Hardcoded data from the analysis report for simplicity and reliability
// In a real pipeline, we would parse the CSVs dynamically, but this ensures the chart matches the text report exactly.
const data = {
  labels: ['Baseline', 'Loop 5', 'Loop 10', 'Loop 15', 'Loop 20', 'Loop 25', 'Loop 30'],
  datasets: [
    {
      label: 'On-off & Bad-mouth Victim (0x7B9E...)',
      data: [186, 89, 89, 89, 133, 133, 133],
      borderColor: 'rgb(255, 99, 132)', // Red
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      tension: 0.1,
      fill: true
    },
    {
      label: 'Sybil Attacker Root (0x3018...)',
      data: [186, 190, 190, 190, 190, 190, 190],
      borderColor: 'rgb(54, 162, 235)', // Blue
      backgroundColor: 'rgba(54, 162, 235, 0.2)',
      tension: 0.1,
      fill: false
    },
    {
      label: 'Trust Threshold (Level 3)',
      data: [180, 180, 180, 180, 180, 180, 180],
      borderColor: 'rgb(75, 192, 192)', // Green dashed
      borderDash: [5, 5],
      pointRadius: 0,
      borderWidth: 2
    }
  ]
};

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Trust Model Attack Resilience Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: 'Segoe UI', sans-serif; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #333; }
    .chart-box { position: relative; height: 500px; width: 100%; margin-top: 30px; }
    .analysis { margin-top: 30px; padding: 20px; background: #f8f9fa; border-left: 5px solid #007bff; }
    .metric-card { display: inline-block; width: 45%; padding: 15px; margin: 10px 2%; background: #fff; border: 1px solid #ddd; border-radius: 8px; vertical-align: top; }
    .metric-title { font-weight: bold; color: #555; display: block; margin-bottom: 5px; }
    .metric-value { font-size: 24px; font-weight: bold; }
    .metric-change.down { color: #dc3545; }
    .metric-change.up { color: #28a745; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Trust Model Attack Resilience</h1>
    <p style="text-align: center; color: #666;">Analysis of On-off, Bad-mouthing, and Sybil Attacks (30 Minute Simulation)</p>
    
    <div style="margin-top: 20px;">
      <div class="metric-card">
        <span class="metric-title">Victim Trust Drop (Max)</span>
        <span class="metric-value metric-change down">186 ➔ 89 (-52%)</span>
        <p><small>Combined On-off & Bad-mouthing Attack</small></p>
      </div>
      <div class="metric-card">
        <span class="metric-title">Sybil Attack Gain (Max)</span>
        <span class="metric-value metric-change up">186 ➔ 190 (+2.1%)</span>
        <p><small>Gain capped despite massive fake recommendations</small></p>
      </div>
    </div>

    <div class="chart-box">
      <canvas id="attackChart"></canvas>
    </div>

    <div class="analysis">
      <h3>Analysis Conclusions for Paper:</h3>
      <ul>
        <li><strong>Rapid Penalization:</strong> The model successfully detects performance degradation (On-off attack), reducing trust by >50% within 5 cycles.</li>
        <li><strong>Sticky Recovery:</strong> Even after behavior normalizes (Loop 20+), trust only recovers to 133 (Level 2), demonstrating the "Hard to gain, easy to lose" property.</li>
        <li><strong>Sybil Resistance:</strong> The recommendation weight algorithm effectively saturates trust gain from new nodes, preventing Sybil attackers from artificially inflating scores beyond a safe margin (+4 points max).</li>
      </ul>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('attackChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: ${JSON.stringify(data)},
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            max: 250,
            title: { display: true, text: 'Trust Score (0-255)' }
          },
          x: {
            title: { display: true, text: 'Simulation Progress' }
          }
        },
        plugins: {
          tooltip: {
            mode: 'index',
            intersect: false,
          },
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  </script>
</body>
</html>
`;

fs.writeFileSync(HTML_FILE, htmlContent);
console.log(`Charts generated at: ${HTML_FILE}`);
