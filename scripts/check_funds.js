const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || process.env.RPC_URL || 'http://127.0.0.1:7545';
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    const accounts = [
        { name: "Main", key: process.env.PRIVATE_KEY },
        { name: "Backup 1", key: "0x65eda5dc63f9a97d4bd33cf899958c979ddfcaab704358d699428835e6cf0a0a" },
        { name: "Backup 2", key: "0x4b5d5f49d824f05c7c0a1d627ef17d570718955a6e481d9a454f4863b567d418" }
    ];

    console.log("Checking Account Balances...");
    for (const acc of accounts) {
        try {
            const wallet = new ethers.Wallet(acc.key, provider);
            const balance = await wallet.getBalance();
            console.log(`${acc.name} (${wallet.address.slice(0,6)}...): ${ethers.utils.formatEther(balance)} ETH`);
        } catch (e) {
            console.log(`${acc.name}: Error - ${e.message}`);
        }
    }
}

main();
