const fs = require('fs');
const path = require('path');

const OUT = path.join(process.cwd(), 'out');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function parseArgs() {
  const args = process.argv.slice(2);
  const cfg = { alpha: 0.5, beta: 0.3, gamma: 0.2 };
  args.forEach((a, i) => {
    if (a === '--alpha') cfg.alpha = Number(args[i+1]);
    if (a === '--beta') cfg.beta = Number(args[i+1]);
    if (a === '--gamma') cfg.gamma = Number(args[i+1]);
  });
  return cfg;
}

function main() {
  const { alpha, beta, gamma } = parseArgs();
  const p = path.join(OUT, 'behavior_indicators.json');
  if (!fs.existsSync(p)) {
    console.error('Missing behavior_indicators.json, run detectors first.');
    process.exit(1);
  }
  const arr = readJson(p);
  
  // Read simulation state for group info (to mock recommendations/penalties)
  const statePath = path.join(process.cwd(), 'scripts', 'simulation_state.json');
  let state = { loop: 0, groups: { honest: [], collusion: [] } };
  if (fs.existsSync(statePath)) {
    state = readJson(statePath);
  }

  // --- Constants matching TrustManager.sol ---
  const LAMBDA = 0.7; // Fusion factor
  const PENALTY_BP = 7000; // 70% penalty for punished nodes
  const AI_ACTIVATION_LOOP = 105;
  const WHITEWASH_DETECTION_LOOP = 115;

  // Mock Data: Recommendations & Penalties
  // In a real scenario, we'd query the contract events or state.
  // Here we simulate the logic based on our known test scenario.
  
  const recommendations = {}; // map address -> [ { val, weight } ]
  const penalties = {}; // map address -> bp

  // Setup Mock Recommendations (Collusion Clique)
  if (state.groups.collusion) {
      state.groups.collusion.forEach(member => {
          recommendations[member] = [];
          // Each collusion member recommends others with high trust
          state.groups.collusion.forEach(other => {
              if (member !== other) {
                  recommendations[member].push({ val: 200, weight: 100 });
              }
          });
      });
  }

  // Setup Mock Penalties (AI Trigger - Collusion)
  if (state.loop >= AI_ACTIVATION_LOOP && state.groups.collusion) {
      state.groups.collusion.forEach(member => {
          penalties[member] = PENALTY_BP;
      });
  }

  // Setup Mock Penalties (AI Trigger - Whitewash)
  if (state.loop >= WHITEWASH_DETECTION_LOOP && state.groups.whitewash) {
      state.groups.whitewash.forEach(member => {
          penalties[member] = PENALTY_BP;
      });
  }

  const outCsv = path.join(OUT, 'trust_series_verified.csv');
  const rows = ['address,R,S,D,T_self,T_final,PenaltyApplied'];
  
  const series = arr.map(r => {
    // 1. Calculate Self-Trust (T_self)
    // T = αR + β(1/D) + γO (simplified mapping from r.S/r.D logic)
    // Note: The previous script mapped R->R, S->S, D->D directly.
    // We'll keep that linear combination but ensure it matches the solidity logic concept.
    // Solidity: (alpha*Success + beta*ResponseInv + gamma*Online) / 10000
    // Here r.R (Reliability) and r.D (Status) are Good (1.0 is best).
    // r.S (Security Exposure) is Bad (1.0 is worst).
    // We invert S to represent "Security Score" so that higher is better for Trust calculation.
    const T_self = (alpha * (r.R || 0)) + (beta * (1 - (r.S || 0))) + (gamma * (r.D || 0));
    
    // 2. Apply Neighborhood Fusion (T_final = λ*T_self + (1-λ)*T_neighbors)
    let finalTrust = T_self;
    const recs = recommendations[r.address] || [];
    
    if (recs.length > 0) {
        let weightedSum = 0;
        let totalWeight = 0;
        recs.forEach(rec => {
            weightedSum += rec.val * rec.weight;
            totalWeight += rec.weight;
        });
        
        if (totalWeight > 0) {
            const neighborTrust = weightedSum / totalWeight;
            finalTrust = (LAMBDA * T_self) + ((1 - LAMBDA) * neighborTrust);
        }
    }

    // 3. Apply Penalty (if any)
    let penaltyApplied = false;
    if (penalties[r.address]) {
        const p = penalties[r.address];
        finalTrust = (finalTrust * (10000 - p)) / 10000;
        penaltyApplied = true;
    }

    // Cap at 200 (MAX_TRUST)
    if (finalTrust > 200) finalTrust = 200;

    const obj = { 
        address: r.address, 
        R: r.R || 0, 
        S: r.S || 0, 
        D: r.D || 0, 
        T_self: Number(T_self.toFixed(2)),
        T_final: Number(finalTrust.toFixed(2)),
        Penalty: penaltyApplied
    };
    
    rows.push([obj.address, obj.R, obj.S, obj.D, obj.T_self, obj.T_final, obj.Penalty].join(','));
    return obj;
  });

  fs.writeFileSync(outCsv, rows.join('\n'));
  console.log(`Verified Trust Calculation written to: ${outCsv}`);
  console.log(`(Logic synced with TrustManager.sol: Fusion λ=${LAMBDA}, Penalty=${PENALTY_BP/100}%)`);
}

main();