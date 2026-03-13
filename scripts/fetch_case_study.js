
require('dotenv').config();

const API_KEY = process.env.ETHERSCAN_API_KEY;
const TX_HASH = '0x7c78ac94ee7feb5474d75d22c5950d663ad7bd5ad393c972f40a3e9386244fb7';

async function fetchTx() {
    if (!API_KEY) {
        console.error("Error: ETHERSCAN_API_KEY not found in .env");
        process.exit(1);
    }

    const url = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${TX_HASH}&apikey=${API_KEY}`;
    const receiptUrl = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionReceipt&txhash=${TX_HASH}&apikey=${API_KEY}`;

    try {
        console.log("Fetching Tx Info...");
        const txRes = await fetch(url);
        const txData = await txRes.json();
        const tx = txData.result;

        console.log("Fetching Receipt...");
        const receiptRes = await fetch(receiptUrl);
        const receiptData = await receiptRes.json();
        const receipt = receiptData.result;

        if (!tx || !receipt) {
            console.error("Failed to fetch tx or receipt", txData, receiptData);
            return;
        }

        const gasLimit = parseInt(tx.gas, 16);
        const gasUsed = parseInt(receipt.gasUsed, 16);
        const gasRatio = gasUsed / gasLimit;

        console.log("\n=== SCAT Rug Pull Case Study Data ===");
        console.log(`Tx Hash: ${TX_HASH}`);
        console.log(`From: ${tx.from}`);
        console.log(`To: ${tx.to}`);
        console.log(`Gas Limit: ${gasLimit}`);
        console.log(`Gas Used: ${gasUsed}`);
        console.log(`Gas Ratio: ${gasRatio.toFixed(4)}`);
        console.log(`Status: ${receipt.status === '0x1' ? 'Success' : 'Fail'}`);
        console.log("=====================================\n");

    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

fetchTx();
