const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = process.cwd();

async function main() {
    console.log("🔍 Fetching Network State from Sepolia...");

    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL;
    if (!rpcUrl) throw new Error("Missing RPC URL");

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    // Load contract address
    const sepoliaInfoPath = path.join(ROOT, 'out', 'deploy_sepolia.json');
    const info = JSON.parse(fs.readFileSync(sepoliaInfoPath, 'utf8'));
    const contractAddress = info.address;

    // Load ABI
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, provider);

    // Get all nodes
    // There is no function to get array length directly if public getter is auto-generated?
    // Auto-generated getter for array `address[] public nodeList` takes an index.
    // We need to find the length. 
    // Usually standard is `nodeList(index)`.
    // If we want length, we might need to try-catch or if there's a getter?
    // Wait, Solidity public arrays don't expose length via getter.
    // We usually need a separate `getNodeCount` function or read storage.
    // OR we just try index 0, 1, 2... until revert.
    
    const nodes = [];
    let index = 0;
    console.log("   Reading node list (this may take a moment)...");
    
    while (true) {
        try {
            const nodeAddr = await contract.nodeList(index);
            const nodeData = await contract.nodes(nodeAddr);
            
            nodes.push({
                address: nodeAddr,
                trust: nodeData.trustValue.toString(),
                success: nodeData.successRate.toString(),
                latency: nodeData.responseTime.toString(),
                online: nodeData.onlineTime.toString(),
                active: nodeData.isActive,
                blacklisted: nodeData.isBlacklisted,
                interactions: nodeData.interactionCount.toString()
            });
            
            process.stdout.write(`\r   Found ${index + 1} nodes...`);
            index++;
        } catch (e) {
            // Likely reached end of array
            break;
        }
    }
    
    console.log(`\n✅ Successfully fetched ${nodes.length} nodes.`);
    
    // Save to file
    const outPath = path.join(ROOT, 'network_state.json');
    fs.writeFileSync(outPath, JSON.stringify(nodes, null, 2));
    
    // CSV
    const csvPath = path.join(ROOT, 'network_state.csv');
    const header = "Address,Trust,SuccessRate,Latency,OnlineTime,Active,Blacklisted,Interactions\n";
    const rows = nodes.map(n => 
        `${n.address},${n.trust},${n.success},${n.latency},${n.online},${n.active},${n.blacklisted},${n.interactions}`
    ).join("\n");
    fs.writeFileSync(csvPath, header + rows);
    
    console.log(`📂 Saved to network_state.json / .csv`);
}

main().catch(console.error);
