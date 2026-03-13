const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const abi = [
        'function admin() public view returns (address)',
        'function getNodeInfo(address _node) public view returns (uint trustValue, uint successRate, uint responseTime, uint onlineTime, uint interactionCount, bool isActive, bool isBlacklisted)'
    ];
    
    const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
    
    console.log(`Checking contract at ${process.env.CONTRACT_ADDRESS}`);
    
    try {
        const admin = await contract.admin();
        console.log(`Contract Admin: ${admin}`);
        console.log(`Wallet Address: ${wallet.address}`);
        console.log(`Match? ${admin === wallet.address}`);
        
        const testNode = "0x90b6e8986C8AE5dDaC27799fD9f9d9FDed05aCB5"; // From logs
        const info = await contract.getNodeInfo(testNode);
        console.log(`Node ${testNode}:`);
        console.log(`  Active: ${info.isActive}`);
        console.log(`  Blacklisted: ${info.isBlacklisted}`);
        console.log(`  Trust: ${info.trustValue.toString()}`);
        
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
