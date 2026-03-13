const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    nodesCount: 50,
    rounds: 50,
    alpha: 0.4,
    beta: 0.3,
    gamma: 0.3,
    maxTrust: 200,
    blacklistThreshold: 80,
    responseTimeCap: 1000,
    onlineMaxSeconds: 3600
};

// --- Node Class (Digital Twin) ---
class Node {
    constructor(id, type) {
        this.id = id;
        this.type = type;
        this.trustValue = 100; // Initial
        this.successRate = 100;
        this.responseTime = 100;
        this.onlineTime = 0;
        this.isBlacklisted = false;
        this.history = [];
    }

    updateMetrics(success, latency, onlineIncrement) {
        if (this.isBlacklisted) return;

        this.successRate = success;
        this.responseTime = latency;
        this.onlineTime += onlineIncrement;

        // Calculate Trust (Replicating Solidity Logic)
        const normSuccess = this.successRate;
        
        let rt = this.responseTime > CONFIG.responseTimeCap ? CONFIG.responseTimeCap : this.responseTime;
        let normResponse = 0;
        if (rt === 0) normResponse = 100;
        else {
            let raw = Math.floor((CONFIG.responseTimeCap * 100) / (rt + 10));
            normResponse = raw > 100 ? 100 : raw;
        }

        let normOnline = this.onlineTime > CONFIG.onlineMaxSeconds ? 100 : Math.floor((this.onlineTime * 100) / CONFIG.onlineMaxSeconds);

        // Weighted Sum (0-100 scale)
        // Alpha, Beta, Gamma are 0.x
        let calculatedTrust = (CONFIG.alpha * normSuccess) + (CONFIG.beta * normResponse) + (CONFIG.gamma * normOnline);
        
        // Scale to 0-200
        this.trustValue = Math.floor(calculatedTrust * 2);

        // Check Blacklist
        if (this.trustValue < CONFIG.blacklistThreshold) {
            this.isBlacklisted = true;
            this.trustValue = 0; // Or keep as is? Contract keeps it, but effective trust is 0.
        }

        this.history.push(this.trustValue);
    }
}

// --- Simulation Runner ---
function runSimulation() {
    console.log(`🚀 Starting Digital Twin Simulation (${CONFIG.nodesCount} Nodes, ${CONFIG.rounds} Rounds)...`);

    const nodes = [];
    
    // Create Nodes
    const distribution = {
        "Honest": 20,
        "Oscillating": 10,
        "Stealth": 10,
        "Sybil": 5,
        "Collusion": 5
    };

    let idCounter = 1;
    for (const [type, count] of Object.entries(distribution)) {
        for (let i = 0; i < count; i++) {
            nodes.push(new Node(`0xNode_${type}_${idCounter++}`, type));
        }
    }

    // Run Rounds
    for (let r = 1; r <= CONFIG.rounds; r++) {
        for (const node of nodes) {
            let success = 100;
            let latency = 50;

            // Behavior Logic
            if (node.type === "Honest") {
                success = 100; latency = 50;
            } else if (node.type === "Oscillating") {
                // Good -> Bad -> Good cycle
                if (r % 20 > 10) { success = 20; latency = 2000; }
                else { success = 100; latency = 50; }
            } else if (node.type === "Stealth") {
                // Marginal
                success = 85; latency = 450;
            } else if (node.type === "Sybil") {
                // Bad until blacklist, then "Reset" (New ID)
                if (node.isBlacklisted) {
                    // Simulate identity swap: Reset metrics
                    node.isBlacklisted = false;
                    node.trustValue = 100; // Reset
                    node.onlineTime = 0;
                    // node.id = ... (In stats we just track the entity)
                } else {
                    success = 0; latency = 5000;
                }
            } else if (node.type === "Collusion") {
                success = 100; latency = 50;
            }

            node.updateMetrics(success, latency, 3600);
        }
    }

    // Export Results
    const csvHeader = "Type,ID,Trust,Blacklisted\n";
    const csvRows = nodes.map(n => `${n.type},${n.id},${n.trustValue},${n.isBlacklisted}`).join("\n");
    fs.writeFileSync(path.join(process.cwd(), 'large_scale_simulation.csv'), csvHeader + csvRows);
    
    console.log(`✅ Simulation Complete. Data saved to large_scale_simulation.csv`);
    
    // Also generate a detailed time-series for plotting
    // Format: Round,Type,AvgTrust
    let timeSeries = "Round,Type,AvgTrust\n";
    for (let r = 0; r < CONFIG.rounds; r++) {
        const typeSums = {};
        const typeCounts = {};
        
        for (const node of nodes) {
            if (!typeSums[node.type]) { typeSums[node.type] = 0; typeCounts[node.type] = 0; }
            typeSums[node.type] += node.history[r] || 0;
            typeCounts[node.type]++;
        }
        
        for (const type in typeSums) {
            const avg = typeSums[type] / typeCounts[type];
            timeSeries += `${r+1},${type},${avg.toFixed(2)}\n`;
        }
    }
    fs.writeFileSync(path.join(process.cwd(), 'large_scale_timeseries.csv'), timeSeries);
    console.log(`✅ Time Series saved to large_scale_timeseries.csv`);
}

runSimulation();
