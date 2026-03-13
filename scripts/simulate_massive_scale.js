const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    nodesCount: 200, // Expanded Scale: 200 Nodes
    rounds: 100,     // Expanded Duration: 100 Rounds
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
        this.penaltyCount = 0; // Track AI penalties
    }

    applyPenalty(amount) {
        this.trustValue = Math.max(0, this.trustValue - amount);
        this.penaltyCount++;
        // If trust drops below threshold, blacklist immediately (Contract logic)
        if (this.trustValue < CONFIG.blacklistThreshold) {
            this.isBlacklisted = true;
            this.trustValue = 0;
        }
    }

    updateMetrics(success, latency, onlineIncrement) {
        if (this.isBlacklisted) {
            this.history.push(0);
            return;
        }

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
        let calculatedTrust = (CONFIG.alpha * normSuccess) + (CONFIG.beta * normResponse) + (CONFIG.gamma * normOnline);
        
        // Scale to 0-200
        this.trustValue = Math.floor(calculatedTrust * 2);

        // Check Blacklist
        if (this.trustValue < CONFIG.blacklistThreshold) {
            this.isBlacklisted = true;
            this.trustValue = 0;
        }

        this.history.push(this.trustValue);
    }
}

// --- AI Agent Logic (Simulated) ---
// The AI Agent scans for patterns that evade the static rules
function runAIAgentCheck(nodes, currentRound) {
    for (const node of nodes) {
        if (node.isBlacklisted) continue;

        // Pattern 1: Stealth (Low but passing success rate)
        // If success rate is consistently between 80-90% for > 10 rounds, it's suspicious
        if (node.type === 'Stealth' && currentRound > 10) {
            // In a real agent, we look at history. Here we simulate detection probability.
            // 20% chance per round to get caught after round 10
            if (Math.random() < 0.2) {
                // Apply Penalty
                node.applyPenalty(50); // Trust -50
            }
        }

        // Pattern 2: Sybil (New node high activity)
        // Handled by type behavior, but let's say AI catches them faster
        if (node.type === 'Sybil' && currentRound > 5) {
             if (Math.random() < 0.3) {
                node.applyPenalty(80); // Heavy penalty
             }
        }
    }
}

// --- Simulation Runner ---
function runSimulation() {
    console.log(`🚀 Starting MASSIVE Digital Twin Simulation (${CONFIG.nodesCount} Nodes, ${CONFIG.rounds} Rounds)...`);

    const nodes = [];
    
    // Create Nodes with expanded distribution
    const distribution = {
        "Honest": 100,      // 50%
        "Oscillating": 30,  // 15%
        "Stealth": 30,      // 15% - Tries to fly under radar
        "Sybil": 20,        // 10% - Re-registers constantly
        "RandomFault": 20   // 10% - Honest but has network issues
    };

    let idCounter = 1;
    for (const [type, count] of Object.entries(distribution)) {
        for (let i = 0; i < count; i++) {
            nodes.push(new Node(`0xNode_${type}_${idCounter++}`, type));
        }
    }

    // Run Rounds
    for (let r = 1; r <= CONFIG.rounds; r++) {
        // 1. Update Metrics
        for (const node of nodes) {
            let success = 100;
            let latency = 50;

            // Behavior Logic
            if (node.type === "Honest") {
                success = 100; latency = 50 + Math.random() * 20;
            } else if (node.type === "Oscillating") {
                // Good -> Bad -> Good cycle (Period 20)
                if (r % 20 > 12) { success = 20; latency = 2000; } // Bad for 8 rounds
                else { success = 100; latency = 50; }
            } else if (node.type === "Stealth") {
                // Just above threshold (e.g. 85%) to avoid static <80 blacklist
                // But creates latent risk
                success = 85 + (Math.random() * 5); // 85-90%
                latency = 400; // Slower
            } else if (node.type === "Sybil") {
                // If blacklisted, reset identity (Simulate new account)
                if (node.isBlacklisted) {
                    node.isBlacklisted = false;
                    node.trustValue = 100; // Reset trust
                    node.onlineTime = 0;
                    node.penaltyCount = 0;
                    // In real life this is a new address, but for stats we track the "Sybil Entity"
                } else {
                    // Attack
                    success = 0; latency = 5000;
                }
            } else if (node.type === "RandomFault") {
                // 10% chance of failure
                if (Math.random() < 0.1) { success = 0; latency = 3000; }
                else { success = 100; latency = 50; }
            }

            node.updateMetrics(success, latency, 3600);
        }

        // 2. AI Agent Intervention (Every 5 rounds)
        if (r % 5 === 0) {
            runAIAgentCheck(nodes, r);
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
