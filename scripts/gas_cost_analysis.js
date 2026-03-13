const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../out/paper_data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// Gas Costs (Approximate Estimates in Gas Units)
const GAS = {
    BASE_TX: 21000,
    SSTORE_NEW: 20000,
    SSTORE_UPDATE: 5000,
    SLOAD: 2100,
    KECCAK256: 30, // + dynamic
    LOG: 375
};

// --- Scenario Setup ---
const NODES_COUNT = [10, 50, 100, 200, 500, 1000];
const UPDATES_PER_DAY = 144; // Every 10 mins

function calculateCosts() {
    let csvContent = "nodes,method,gas_per_day,cost_usd_per_day\n";
    const gasPriceGwei = 20; // Assume 20 Gwei
    const ethPrice = 3000; // $3000 per ETH

    NODES_COUNT.forEach(n => {
        // 1. Baseline: Full On-Chain (Every interaction recorded)
        // Assume each node interacts 10 times per update window
        // 10 interactions * n nodes * 144 windows
        // Each interaction: Base + 2 SSTORE (Sender, Receiver updates)
        const txsPerDay = n * 10 * UPDATES_PER_DAY;
        const gasBaseline = txsPerDay * (GAS.BASE_TX + 2 * GAS.SSTORE_UPDATE);

        // 2. Periodic Batch (Our Current Implementation)
        // 144 updates * n nodes * SSTORE (Trust Score Update)
        // We batch them, so Base TX is shared? 
        // Let's assume optimal batching: 144 TXs per day.
        // Each TX updates n slots.
        const gasPeriodic = UPDATES_PER_DAY * (GAS.BASE_TX + n * GAS.SSTORE_UPDATE);

        // 3. Optimized Merkle Root (L2 / Rollup Style)
        // 144 updates * 1 SSTORE (Root Hash)
        // Data is calldata (much cheaper: 16 gas per byte)
        // n nodes * 32 bytes * 16 gas
        const calldataCost = n * 32 * 16;
        const gasMerkle = UPDATES_PER_DAY * (GAS.BASE_TX + GAS.SSTORE_UPDATE + calldataCost);

        // Convert to USD
        const toUsd = (gas) => (gas * gasPriceGwei * 1e-9 * ethPrice).toFixed(2);

        csvContent += `${n},Baseline (Per-Tx),${gasBaseline},${toUsd(gasBaseline)}\n`;
        csvContent += `${n},Periodic (Batch),${gasPeriodic},${toUsd(gasPeriodic)}\n`;
        csvContent += `${n},Merkle (Optimized),${gasMerkle},${toUsd(gasMerkle)}\n`;
    });

    fs.writeFileSync(path.join(OUT_DIR, 'gas_cost_analysis.csv'), csvContent);
    console.log("✅ Gas cost data saved to gas_cost_analysis.csv");
}

calculateCosts();
