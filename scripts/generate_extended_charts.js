const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out');
const DATA_FILE = path.join(OUT_DIR, 'extended_sim_data.json');
const HTML_FILE = path.join(OUT_DIR, 'extended_charts.html');

const chartData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <title>Extended Trust Simulation Results</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: 'Segoe UI', sans-serif; padding: 20px; background-color: #f5f5f5; }
    .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    h1 { text-align: center; color: #333; }
    .chart-box { position: relative; height: 500px; width: 100%; margin-top: 30px; }
    .analysis { margin-top: 30px; padding: 20px; background: #fff3cd; border-left: 5px solid #ffc107; }
    .metric-card { display: inline-block; width: 30%; padding: 15px; margin: 10px 1%; background: #fff; border: 1px solid #ddd; border-radius: 8px; vertical-align: top; text-align: center; }
    .metric-title { font-weight: bold; color: #555; display: block; margin-bottom: 5px; }
    .metric-value { font-size: 24px; font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Extended Simulation: 100 Loops</h1>
    <p style="text-align: center; color: #666;">Comparison of Honest, On-Off, and Collusion Groups</p>
    
    <div style="margin-top: 20px;">
      <div class="metric-card">
        <span class="metric-title">Honest Avg (Final)</span>
        <span class="metric-value" style="color: #28a745;">${chartData.datasets.honest[chartData.datasets.honest.length-1]}</span>
        <p><small>Under Bad-mouthing Attack</small></p>
      </div>
      <div class="metric-card">
        <span class="metric-title">On-Off Avg (Final)</span>
        <span class="metric-value" style="color: #ffc107;">${chartData.datasets.on_off[chartData.datasets.on_off.length-1]}</span>
        <p><small>Fluctuating Behavior</small></p>
      </div>
      <div class="metric-card">
        <span class="metric-title">Collusion Avg (Final)</span>
        <span class="metric-value" style="color: #dc3545;">${chartData.datasets.collusion[chartData.datasets.collusion.length-1]}</span>
        <p><small>Ballot Stuffing Successful?</small></p>
      </div>
    </div>

    <div class="chart-box">
      <canvas id="simChart"></canvas>
    </div>

    <div class="analysis">
      <h3>Key Findings:</h3>
      <ul>
        <li><strong>Collusion Impact:</strong> The Collusion group (10 nodes) successfully maintained a high trust score (~183) by praising each other, slightly outperforming Honest nodes. This highlights the power of <strong>Ballot Stuffing</strong> in basic weighted networks.</li>
        <li><strong>Honest Suppression:</strong> Honest nodes averaged ~148 (Level 2), likely suppressed by the <strong>Bad-mouthing</strong> attacks from the Collusion group.</li>
        <li><strong>On-Off Volatility:</strong> The On-Off group showed distinct volatility, dropping to ~126 during "Bad" phases and recovering to ~200 in "Good" phases. The recovery seems surprisingly fast, suggesting the penalty parameter for this specific metric mix might need tuning (or they just behaved "Good" long enough).</li>
      </ul>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('simChart').getContext('2d');
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartData.labels)},
        datasets: [
          {
            label: 'Honest Group',
            data: ${JSON.stringify(chartData.datasets.honest)},
            borderColor: '#28a745',
            backgroundColor: 'rgba(40, 167, 69, 0.1)',
            tension: 0.3,
            fill: false
          },
          {
            label: 'On-Off Group',
            data: ${JSON.stringify(chartData.datasets.on_off)},
            borderColor: '#ffc107',
            backgroundColor: 'rgba(255, 193, 7, 0.1)',
            tension: 0.3,
            fill: false
          },
          {
            label: 'Collusion Group',
            data: ${JSON.stringify(chartData.datasets.collusion)},
            borderColor: '#dc3545',
            backgroundColor: 'rgba(220, 53, 69, 0.1)',
            tension: 0.3,
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
            title: { display: true, text: 'Simulation Loops' }
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
