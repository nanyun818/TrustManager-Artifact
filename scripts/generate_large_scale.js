const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

const OUT_FILE = path.join(__dirname, 'large_scale_nodes.json');
const COUNT = process.env.NODE_COUNT ? parseInt(process.env.NODE_COUNT) : 100;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

async function main() {
    console.log(`Connecting to ${RPC_URL} to fetch accounts...`);
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    
    try {
        const accounts = await provider.listAccounts();
        
        if (accounts.length < COUNT + 1) {
            console.error(`❌ Not enough accounts in Ganache! Need ${COUNT + 1}, found ${accounts.length}.`);
            console.error(`👉 Restart Ganache with: npx ganache -a ${COUNT + 5}`);
            process.exit(1);
        }

        // Skip account 0 (Owner)
        const available = accounts.slice(1, COUNT + 1);
        
        // Shuffle
        for (let i = available.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [available[i], available[j]] = [available[j], available[i]];
        }

        const nodes = [];
        const honestCount = Math.floor(COUNT * 0.7);
        const collusionCount = Math.floor(COUNT * 0.2);
        const whitewashCount = COUNT - honestCount - collusionCount;

        available.forEach((addr, i) => {
            let type = 'honest';
            if (i >= honestCount && i < honestCount + collusionCount) {
                type = 'collusion';
            } else if (i >= honestCount + collusionCount) {
                type = 'whitewash';
            }
            nodes.push({
                address: addr,
                type: type
            });
        });

        fs.writeFileSync(OUT_FILE, JSON.stringify(nodes, null, 2));
        console.log(`✅ Generated ${COUNT} nodes in ${OUT_FILE}`);
        console.log(`Distribution: ${honestCount} Honest, ${collusionCount} Collusion, ${whitewashCount} Whitewash`);
    } catch (e) {
        console.error("Failed to connect to RPC:", e.message);
    }
}

main();
