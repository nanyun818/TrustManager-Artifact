const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:7545';
    console.log(`Connecting to ${rpcUrl}`);
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    
    try {
        const net = await provider.getNetwork();
        console.log(`Connected to Chain ID: ${net.chainId}`);
        
        const block = await provider.getBlockNumber();
        console.log(`Current Block: ${block}`);
        
        const pk = process.env.PRIVATE_KEY;
        const wallet = new ethers.Wallet(pk, provider);
        console.log(`Wallet: ${wallet.address}`);
        
        const balance = await wallet.getBalance();
        console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`);
        
        const code = await provider.getCode(process.env.CONTRACT_ADDRESS);
        console.log(`Contract Code at ${process.env.CONTRACT_ADDRESS}: ${code.slice(0, 20)}...`);
        
    } catch (e) {
        console.error("Error:", e.message);
    }
}

main();
