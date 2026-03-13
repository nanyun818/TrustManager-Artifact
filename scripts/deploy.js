// Simple deployment script using ethers v5 and local RPC
// Usage:
// 1) Set PROVIDER_URL and PRIVATE_KEY in .env
// 2) npm install --save ethers@5 dotenv
// 3) node scripts/deploy.js

const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
const ROOT = process.cwd();

// Simplest approach: assume we run from root
require('dotenv').config();

// Fallback: manually read .env if dotenv failed to pick it up
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

function log(msg, obj) {
  if (obj !== undefined) {
    console.log(msg, obj);
  } else {
    console.log(msg);
  }
}

function findBuildInfoFile() {
  const dir = path.join(ROOT, 'artifacts', 'build-info');
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length === 0) return null;
    // Prefer the latest file by mtime
    const withTime = files.map((f) => ({
      name: f,
      time: fs.statSync(path.join(dir, f)).mtimeMs,
    }));
    withTime.sort((a, b) => b.time - a.time);
    return path.join(dir, withTime[0].name);
  } catch (e) {
    return null;
  }
}

function tryLoadFromTrustManagerJson() {
  const p = path.join(ROOT, 'artifacts', 'TrustManager.json');
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (j && j.abi && j.bytecode && typeof j.bytecode === 'string' && j.bytecode.length > 2) {
      return { abi: j.abi, bytecode: j.bytecode.startsWith('0x') ? j.bytecode : '0x' + j.bytecode };
    }
  } catch (_) {}
  return null;
}

function loadAbiBytecode() {
  // 1) Try quick path: artifacts/TrustManager.json
  const quick = tryLoadFromTrustManagerJson();
  if (quick) {
    log('Loaded ABI/bytecode from artifacts/TrustManager.json');
    return quick;
  }

  // 2) Fallback: scan artifacts/build-info/*.json produced by solc
  const buildInfo = findBuildInfoFile();
  if (!buildInfo) throw new Error('No build-info JSON found under artifacts/build-info');
  const data = JSON.parse(fs.readFileSync(buildInfo, 'utf8'));
  
  // Try with and without directory prefix
  let contractKey = 'TrustManager.sol';
  if (!data.output.contracts[contractKey]) {
      contractKey = 'contracts/TrustManager.sol';
  }
  
  const out = data.output && data.output.contracts && data.output.contracts[contractKey] && data.output.contracts[contractKey].TrustManager;
  if (!out) {
    throw new Error(`TrustManager contract not found in build-info output (tried keys: TrustManager.sol, contracts/TrustManager.sol)`);
  }
  const abi = out.abi;
  const bytecodeObj = out.evm && out.evm.bytecode && out.evm.bytecode.object;
  if (!abi || !bytecodeObj || bytecodeObj === '' || bytecodeObj === '0x') {
    throw new Error('Invalid ABI or bytecode in build-info');
  }
  const bytecode = bytecodeObj.startsWith('0x') ? bytecodeObj : '0x' + bytecodeObj;
  log(`Loaded ABI/bytecode from build-info: ${path.basename(buildInfo)}`);
  return { abi, bytecode };
}

async function main() {
  const RPC_URL = process.env.RPC_URL || process.env.PROVIDER_URL || 'http://127.0.0.1:8545';
  let PRIVATE_KEY = process.env.PRIVATE_KEY_OVERRIDE || process.env.PRIVATE_KEY;

  // Extra robust check: if PRIVATE_KEY is missing/empty, try to read it directly from .env file
  // ignoring process.env
  if (!PRIVATE_KEY || PRIVATE_KEY.trim() === '') {
      try {
          const envConfig = dotenv.parse(fs.readFileSync(path.resolve(ROOT, '.env')));
          if (envConfig.PRIVATE_KEY) {
              console.log("Loaded PRIVATE_KEY manually from .env file.");
              PRIVATE_KEY = envConfig.PRIVATE_KEY;
          }
      } catch (e) {
          console.warn("Failed to manually read .env for key:", e);
      }
  }

  console.log("--- Deploy Script Config Check ---");
  console.log("RPC_URL:", RPC_URL);
  console.log("PRIVATE_KEY present:", !!PRIVATE_KEY);
  console.log("PRIVATE_KEY length:", PRIVATE_KEY ? PRIVATE_KEY.length : 0);
  console.log("----------------------------------");
  
  if ((!PRIVATE_KEY || PRIVATE_KEY === '') && (RPC_URL.includes("infura") || RPC_URL.includes("alchemy") || RPC_URL.includes("sepolia"))) {
    // Check if it's the empty string case (sometimes .env parsing leaves it empty)
    throw new Error(`PRIVATE_KEY is missing/empty but required for public testnets. (Value: "${PRIVATE_KEY}")`);
  }

  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const { chainId } = await provider.getNetwork();

  // Choose signer: prefer explicit private key; otherwise use Ganache unlocked account[0]
  let signer;
  if (PRIVATE_KEY) {
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith('0x')) {
      pk = '0x' + pk;
    }
    signer = new ethers.Wallet(pk, provider);
    log(`Using pk_head=${pk.slice(0, 14)}`);
  } else {
    signer = provider.getSigner(0);
    log('Using unlocked account index=0 from local Ganache');
  }

  const signerAddress = await signer.getAddress();
  const balance = await provider.getBalance(signerAddress);
  log(`Preflight: address=${signerAddress} chainId=${chainId} rpc=${RPC_URL} balance=${ethers.utils.formatEther(balance)} ETH`);
  if (balance.isZero()) {
    throw new Error('Insufficient funds: signer balance is 0');
  }

  const { abi, bytecode } = loadAbiBytecode();
  const factory = new ethers.ContractFactory(abi, bytecode, signer);

  // Prefer EIP-1559 fees when available, fallback to legacy-compatible values
  const fee = await provider.getFeeData();

  // Estimate deployment gas; if fails, use a generous fallback (3,000,000)
  let estGas;
  try {
    estGas = await factory.estimateGas.deploy();
  } catch (e) {
    log('Estimate gas failed, using default 10000000. reason=', e && e.message ? e.message : e);
    estGas = ethers.BigNumber.from('10000000');
  }
  let gasLimit = estGas.mul(15).div(10); // +50%
  // Clamp to current block gas limit to avoid exceeding network cap
  try {
    const latest = await provider.getBlock('latest');
    if (latest && latest.gasLimit) {
      const cap = latest.gasLimit; // use full block gas limit
      if (gasLimit.gt(cap)) gasLimit = cap;
    }
  } catch (_) {}

  const maxFee = fee.maxFeePerGas || ethers.BigNumber.from('2000000000'); // 2 gwei fallback
  const maxPrio = fee.maxPriorityFeePerGas || ethers.BigNumber.from('2000000000');
  log(`Deploying TrustManager with maxFeePerGas=${maxFee.toString()} maxPriority=${maxPrio.toString()} gasLimit=${gasLimit.toString()}`);

  const contract = await factory.deploy({ gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPrio });
  const tx = contract.deployTransaction;
  log('Deployment tx sent:', tx.hash);
  // Wait for 1 confirmation on Ganache/Hardhat; then read receipt
  // Some environments may not resolve tx.wait properly; use provider.waitForTransaction
  const receipt = await provider.waitForTransaction(tx.hash, 1, 30000);
  if (!receipt) {
    throw new Error('Timeout waiting for transaction to be mined');
  }
  log('Deployment mined. Block:', receipt.blockNumber);
  log('Deployment success. Address:', receipt.contractAddress);

  // Save address to file for other scripts
  fs.writeFileSync(path.join(ROOT, 'contract_address.txt'), receipt.contractAddress);
  console.log('Saved address to contract_address.txt');
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Deployment failed:', err);
      process.exit(1);
    });
}