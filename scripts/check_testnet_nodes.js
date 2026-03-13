const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Helper to handle .env
const ROOT = process.cwd();
try {
  const envPath = path.resolve(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const dotenv = require('dotenv');
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
      if (!process.env[k] || process.env[k] === '') {
        process.env[k] = envConfig[k];
      }
    }
  }
} catch (e) {
  console.warn("Manual .env load failed:", e);
}

const STATE_FILE = path.join(__dirname, 'simulation_state.json');

async function main() {
    const rpcUrl = process.env.RPC_URL;
    if (!rpcUrl) throw new Error("Missing RPC_URL");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Load contract address
    const contractAddress = fs.readFileSync(path.join(ROOT, 'contract_address.txt'), 'utf8').trim();
    console.log(`Contract: ${contractAddress}`);

    // Load ABI
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) {
        buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    }
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, provider);

    // Load Nodes
    if (!fs.existsSync(STATE_FILE)) {
        console.error("No simulation state found. Run bootstrap_testnet.js first.");
        return;
    }
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const allNodes = [
        ...state.groups.honest.map(addr => ({ addr, type: 'Honest 😇' })),
        ...state.groups.collusion.map(addr => ({ addr, type: 'Collusion 😈' })),
        ...state.groups.whitewash.map(addr => ({ addr, type: 'Whitewash 👻' }))
    ];

    console.log(`\n🔍 Checking status of ${allNodes.length} nodes on Sepolia...\n`);
    console.log("Address                                      | Type        | Trust | Active | Blacklisted");
    console.log("-".repeat(85));

    for (const node of allNodes) {
        try {
            const info = await contract.nodes(node.addr);
            console.log(`${node.addr} | ${node.type.padEnd(11)} | ${info.trustValue.toString().padStart(5)} | ${info.isActive.toString().padEnd(6)} | ${info.isBlacklisted}`);
        } catch (e) {
            console.log(`${node.addr} | Error fetching status`);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
