const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out/ml_data');
if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Helper to generate random int
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function generateAdvancedDataset() {
    console.log("Generating Advanced Adversarial Dataset for ML Training...");
    
    const samples = [];
    const NUM_SAMPLES = 2000; // per category

    // 1. Honest Nodes (Label: 0)
    // High Success, Low Latency, High Uptime
    for (let i = 0; i < NUM_SAMPLES; i++) {
        samples.push({
            success: rand(98, 100),
            latency: rand(20, 150),
            online: rand(80000, 86400),
            label: 0
        });
    }

    // 2. Simple Malicious (Label: 1)
    // Low Success
    for (let i = 0; i < NUM_SAMPLES; i++) {
        samples.push({
            success: rand(0, 40),
            latency: rand(100, 3000), // Random latency
            online: rand(0, 86400),
            label: 1
        });
    }

    // 3. "Laggy" Attacker (Label: 1) - The "Silent Killer"
    // High Success (trying to fool baseline), but Terrible Latency
    for (let i = 0; i < NUM_SAMPLES; i++) {
        samples.push({
            success: rand(95, 100), // Looks honest!
            latency: rand(2000, 5000), // But very slow
            online: rand(40000, 86400),
            label: 1
        });
    }

    // 4. "On-Off" Attacker (Label: 1) - Attack Phase
    // Captured during their attack window
    for (let i = 0; i < NUM_SAMPLES; i++) {
        samples.push({
            success: rand(10, 30),
            latency: rand(50, 200), // Normal latency to confuse
            online: rand(80000, 86400),
            label: 1
        });
    }

    // 5. Unstable / Sybil (Label: 1)
    // Good behavior but very low uptime (newly created accounts spamming)
    for (let i = 0; i < NUM_SAMPLES; i++) {
        samples.push({
            success: rand(90, 100),
            latency: rand(50, 200),
            online: rand(0, 3000), // Only online for < 1 hour
            label: 1 // We treat unstable short-lived nodes as risky
        });
    }

    // Convert to CSV
    let csv = "success_rate,response_time,uptime,label\n";
    samples.forEach(s => {
        csv += `${s.success},${s.latency},${s.online},${s.label}\n`;
    });

    const filePath = path.join(OUT_DIR, 'advanced_training_set.csv');
    fs.writeFileSync(filePath, csv);
    console.log(`✅ Saved ${samples.length} samples to ${filePath}`);
}

generateAdvancedDataset();
