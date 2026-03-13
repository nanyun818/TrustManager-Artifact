const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

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
} catch (e) {}

async function main() {
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.PRIVATE_KEY;
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const contractAddress = fs.readFileSync(path.join(ROOT, 'contract_address.txt'), 'utf8').trim();
    let buildInfoPath = path.join(ROOT, 'artifacts', 'contracts', 'TrustManager.sol', 'TrustManager.json');
    if (!fs.existsSync(buildInfoPath)) buildInfoPath = path.join(ROOT, 'artifacts', 'TrustManager.json');
    const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
    const contract = new ethers.Contract(contractAddress, buildInfo.abi, wallet);

    // Target: The bad actor from previous run
    const target = "0xD9E460A385dAEBcDA66BC52B3A1DC5256a5E1627"; 

    console.log(`Checking status of ${target}...`);
    const info = await contract.nodes(target);
    console.log(`Trust: ${info.trustValue}, Blacklisted: ${info.isBlacklisted}`);

    if (!info.isBlacklisted) {
        console.log("Node is NOT blacklisted. Cannot unban.");
        return;
    }

    console.log("Attempting to unban...");
    try {
        // Manually set gas limit to avoid estimation errors
        const tx = await contract.removeFromBlacklist(target, { gasLimit: 200000 });
        console.log(`Tx sent: ${tx.hash}`);
        await tx.wait();
        console.log("✅ Unbanned successfully.");
        
        const newInfo = await contract.nodes(target);
        console.log(`New Trust: ${newInfo.trustValue}`);
    } catch (e) {
        console.error("Failed:", e);
    }
}

main();
