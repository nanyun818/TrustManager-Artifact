// Lightweight compiler using solc to produce ABI and bytecode with optimizer
// Usage: node scripts/compile.js

const fs = require('fs');
const path = require('path');
const solc = require('solc');

const ROOT = path.resolve(__dirname, '..');
const sourcePath = path.join(ROOT, 'TrustManager.sol');
const source = fs.readFileSync(sourcePath, 'utf8');

const input = {
  language: 'Solidity',
  sources: {
    'TrustManager.sol': { content: source },
  },
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    },
    viaIR: true,
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
};

async function getCompiler() {
  const desired = process.env.SOLC_VERSION || 'v0.8.19';
  if (desired === 'local') {
    return solc; // use installed local version
  }
  if (solc.version && solc.version().includes(desired.replace('v',''))) {
    return solc;
  }
  return new Promise((resolve, reject) => {
    solc.loadRemoteVersion(desired, (err, loaded) => {
      if (err) return reject(err);
      resolve(loaded);
    });
  });
}

async function compile() {
  const compiler = await getCompiler();
  const output = JSON.parse(compiler.compile(JSON.stringify(input)));
  if (output.errors) {
    const fatal = output.errors.filter((e) => e.severity === 'error');
    fatal.forEach((e) => console.error(e.formattedMessage || e.message));
    if (fatal.length) {
      throw new Error('Solidity compilation failed');
    }
    // Show warnings too
    output.errors
      .filter((e) => e.severity !== 'error')
      .forEach((e) => console.warn(e.formattedMessage || e.message));
  }
  const c = output.contracts['TrustManager.sol'] && output.contracts['TrustManager.sol'].TrustManager;
  if (!c) throw new Error('Contract TrustManager not found in compilation output');

  const abi = c.abi;
  const bytecode = c.evm.bytecode.object;
  const deployedBytecode = c.evm.deployedBytecode.object;
  if (!bytecode || bytecode.length < 2) throw new Error('Empty bytecode');

  const outDir = path.join(ROOT, 'artifacts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const outPath = path.join(outDir, 'TrustManager.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify({ abi, bytecode: bytecode.startsWith('0x') ? bytecode : '0x' + bytecode, deployedBytecode }, null, 2),
    'utf8'
  );
  console.log('Wrote', outPath);
  console.log('deployedBytecodeBytes', deployedBytecode.length / 2);
}

compile().catch((e)=>{ console.error('compile error:', e.message || e); process.exit(1); });
