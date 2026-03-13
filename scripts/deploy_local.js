const fs = require('fs');
const path = require('path');
require('dotenv').config();
const solc = require('solc');
const { ethers } = require('ethers');

function compileContract(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [path.basename(filePath)]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } }
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors && output.errors.length) {
    const msgs = output.errors.map(e => String(e.formattedMessage || e.message || '')).join('\n');
    throw new Error(msgs);
  }
  const fileKey = path.basename(filePath);
  const contractNames = Object.keys(output.contracts[fileKey] || {});
  if (contractNames.length === 0) throw new Error('No contracts compiled');
  const name = 'TrustManager';
  const c = output.contracts[fileKey][name];
  if (!c) throw new Error('Contract TrustManager not found');
  return { abi: c.abi, bytecode: c.evm.bytecode.object };
}

async function main() {
  const ROOT = process.cwd();
  const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
  const filePath = path.join(ROOT, 'TrustManager.sol');
  const { abi, bytecode } = compileContract(filePath);
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const signer = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : provider.getSigner(0);
  const factory = new ethers.ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy();
  const receipt = await contract.deployTransaction.wait();
  const outDir = path.join(ROOT, 'out');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const info = { address: contract.address, txHash: receipt.transactionHash, network: await provider.getNetwork() };
  fs.writeFileSync(path.join(outDir, 'deploy.json'), JSON.stringify(info, null, 2));
  process.stdout.write(contract.address + '\n');
}

main().catch((e) => { process.stderr.write(String(e && e.message ? e.message : e) + '\n'); process.exit(1); });
