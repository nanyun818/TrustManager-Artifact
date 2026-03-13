// Lightweight model inference: Supports Logistic Regression OR Random Forest
const fs = require('fs');
const path = require('path');

let CACHED_MODEL = null;

function loadModel() {
  if (CACHED_MODEL) return CACHED_MODEL;
  
  // Try loading Random Forest first (New Model)
  const rfPath = path.join(process.cwd(), 'models', 'rf_model.json');
  if (fs.existsSync(rfPath)) {
      try {
          CACHED_MODEL = JSON.parse(fs.readFileSync(rfPath, 'utf-8'));
          console.log("🌲 Loaded Random Forest Model");
          return CACHED_MODEL;
      } catch (e) { console.error("Error loading RF model", e); }
  }

  // Fallback to LogReg
  const modelPath = path.join(process.cwd(), 'models', 'logreg.json');
  try {
    const j = JSON.parse(fs.readFileSync(modelPath, 'utf-8'));
    CACHED_MODEL = j;
    return j;
  } catch (e) {
    // Default weights if none trained
    return {
      bias: -0.5,
      weights: {
        failed: 2.0,
        gasRatio: 0.5,
        isSwap: 0.5,
        isApprove: 0.6,
        approveToUnusual: 1.5,
        approveUnlimited: 1.2,
        approveLarge: 0.8,
        freqNorm: 0.8,
        spenderSafe: -0.5
      }
    };
  }
}

function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

// Tree Traversal Logic
function traverseTree(node, featuresArr) {
    if (node.value !== undefined) return node.value; // Leaf
    
    const val = featuresArr[node.feature_idx];
    if (val <= node.threshold) {
        return traverseTree(node.left, featuresArr);
    } else {
        return traverseTree(node.right, featuresArr);
    }
}

function predictRF(model, featuresArr) {
    const votes = [];
    for (const tree of model.trees) {
        votes.push(traverseTree(tree, featuresArr));
    }
    // Average vote (Regression/Probability-like) or Majority Vote?
    // Our training uses Majority Vote for 0/1. 
    // Let's return Probability (avg of votes) to map to Risk Score [0,1]
    const sum = votes.reduce((a, b) => a + b, 0);
    return sum / votes.length; 
}

function riskScore(tx) {
  const model = loadModel();
  const f = tx.features || {};

  // Check model type
  if (model.type === 'random_forest') {
      // Map features to array [degree, uniquePartners, cliqueScore, failed, gasRatio]
      // Default to 0 if missing
      const featuresArr = [
          Number(f.degree || 0),
          Number(f.uniquePartners || 0),
          Number(f.cliqueScore || 0),
          Number(f.failed || 0),
          Number(f.gasRatio || 0)
      ];
      return predictRF(model, featuresArr);
  } else {
      // Logistic Regression Fallback
      let z = model.bias || 0;
      const w = model.weights || model; // handle nested or flat structure
      for (const k of Object.keys(w)) {
        if (k === 'bias' || k === 'weights') continue;
        z += (w[k] || 0) * Number(f[k] || 0);
      }
      return sigmoid(z);
  }
}

module.exports = { riskScore };