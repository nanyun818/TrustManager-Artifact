const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

console.log("Starting bootstrap_testnet.js...");

const ROOT = process.cwd();
console.log("ROOT:", ROOT);
dotenv.config();

// Force load logic
try {
  const envPath = path.resolve(ROOT, '.env');
  if (fs.existsSync(envPath)) {
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

console.log("Env loaded.");

const STATE_FILE = path.join(__dirname, 'simulation_state.json');
const NODES_FILE = path.join(__dirname, 'large_scale_nodes.json');

async function main() {
    console.log("Entering main...");
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    console.log("RPC:", rpcUrl);
    console.log("Private Key length:", privateKey ? privateKey.length : 0);
    
    let contractAddress = process.env.CONTRACT_ADDRESS;
    if (!contractAddress) {
        try {
            contractAddress = fs.readFileSync(path.join(ROOT, 'contract_address.txt'), 'utf8').trim();
            console.log("Loaded contract address from file:", contractAddress);
        } catch (e) {
            console.error("Missing contract_address.txt");
            return;
        }
    }

    if (!rpcUrl || !privateKey) {
        throw new Error("Missing RPC_URL or PRIVATE_KEY in .env");
    }

    console.log(`Using RPC: ${rpcUrl}`);
    console.log(`Using Contract: ${contractAddress}`);

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const balance = await wallet.getBalance();
    console.log(`Wallet Balance: ${ethers.utils.formatEther(balance)} ETH`);

    const abi = [
        'function registerNode(address _node) public',
        'function updateNodeMetrics(address _node, uint _successRate, uint _responseTime, uint _onlineTime) public',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];

    const contract = new ethers.Contract(contractAddress, abi, wallet);

    // 1. Load Nodes
    const nodesRaw = JSON.parse(fs.readFileSync(NODES_FILE, 'utf8'));
    const groups = {
        honest: [],
        collusion: [],
        whitewash: [],
        on_off: []
    };

    for (const n of nodesRaw) {
        if (n.type === 'honest') groups.honest.push(n.address);
        else if (n.type === 'collusion') groups.collusion.push(n.address);
        else if (n.type === 'whitewash') groups.whitewash.push(n.address);
    }

    // 2. Register & Bootstrap
    console.log(`🚀 Bootstrapping Testnet Network (${nodesRaw.length} nodes)...`);

    // Use legacy gas price if EIP-1559 is tricky, but Sepolia supports EIP-1559.
    // We can let ethers handle gas, but maybe set a manual limit.
    const overrides = { gasLimit: 800000 }; 

    // Helper to check if registered to save gas
    async function isRegistered(addr) {
        try {
            const info = await contract.getNodeInfo(addr);
            return info.isActive; // Assuming isActive is true after registration
        } catch (e) {
            return false;
        }
    }

    // Helper for delay
    const delay = ms => new Promise(res => setTimeout(res, ms));

    // Honest nodes
    for (const addr of groups.honest) {
        process.stdout.write(`Processing Honest ${addr.substring(0,6)}... `);
        try {
            // Check if already registered
            const info = await contract.getNodeInfo(addr);
            if (!info.isActive) {
                process.stdout.write("Registering... ");
                const tx = await contract.registerNode(addr, overrides);
                console.log(`(Tx: ${tx.hash}) `);
                await tx.wait();
            } else {
                process.stdout.write("Skipping reg... ");
            }
            
            await delay(2000); // Rate limit protection

            // Update metrics (1 update is enough for pilot)
            process.stdout.write("Updating metrics... ");
            const tx2 = await contract.updateNodeMetrics(addr, 100, 100, 3600, overrides);
            console.log(`(Tx: ${tx2.hash}) `);
            await tx2.wait();
            console.log("✅");
            await delay(2000);
        } catch (e) { 
            console.log("⚠️ Error:"); 
            if (e.transaction) console.log("  Tx Hash:", e.transaction.hash);
            console.log("  Message:", e.message);
        }
    }

    // Collusion nodes
    for (const addr of groups.collusion) {
        process.stdout.write(`Processing Collusion ${addr.substring(0,6)}... `);
        try {
            const info = await contract.getNodeInfo(addr);
            if (!info.isActive) {
                process.stdout.write("Registering... ");
                const tx = await contract.registerNode(addr, overrides);
                console.log(`(Tx: ${tx.hash}) `);
                await tx.wait();
            } else {
                process.stdout.write("Skipping reg... ");
            }

            await delay(2000);

            process.stdout.write("Updating metrics... ");
            const tx2 = await contract.updateNodeMetrics(addr, 90, 500, 3000, overrides);
            console.log(`(Tx: ${tx2.hash}) `);
            await tx2.wait();
            console.log("✅");
            await delay(2000);
        } catch (e) { 
            console.log("⚠️ Error:"); 
            if (e.transaction) console.log("  Tx Hash:", e.transaction.hash);
            console.log("  Message:", e.message);
        }
    }

    // Whitewash nodes
    for (const addr of groups.whitewash) {
        process.stdout.write(`Processing Whitewash ${addr.substring(0,6)}... `);
        try {
            const info = await contract.getNodeInfo(addr);
            if (!info.isActive) {
                process.stdout.write("Registering... ");
                const tx = await contract.registerNode(addr, overrides);
                console.log(`(Tx: ${tx.hash}) `);
                await tx.wait();
                console.log("✅ (Fresh)");
            } else {
                console.log("✅ (Already Registered)");
            }
            await delay(2000);
        } catch (e) { 
            console.log("⚠️ Error:"); 
            if (e.transaction) console.log("  Tx Hash:", e.transaction.hash);
            console.log("  Message:", e.message);
        }
    }

    // 3. Save State
    const newState = {
        loop: 100,
        groups: groups,
        whitewash_active_map: {}
    };
    
    fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
    console.log(`💾 State file updated.`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
