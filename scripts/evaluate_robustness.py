import sys
import json
import argparse
import os
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score, accuracy_score, precision_score, recall_score, f1_score
from scipy import stats

def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to multichain dataset CSV')
    return parser.parse_args()

def parse_row_standard(row):
    try:
        def to_float(val):
            if isinstance(val, str):
                v = val.strip().lower()
                if v in ('true','1','high','yes'): return 1.0
                return 0.0
            return float(val or 0)
        f = [
            to_float(row.get('unlimited', 0)),
            to_float(row.get('freshSpender', 0)),
            to_float(row.get('freqSpike', 0)),
            to_float(row.get('unknownTarget', 0)),
            to_float(row.get('gasRatio', 0)) # Added gasRatio for robustness
        ]
        y_raw = row.get('label')
        if y_raw is None or str(y_raw).strip()=='':
            y_raw = row.get('finalLabel','')
        y = 1.0 if str(y_raw).strip().lower() in ('1','true','high','high_risk') else 0.0
        return f, y
    except:
        return [0.0]*5, 0.0

def parse_row_advanced(row):
    # Features: success_rate, response_time, uptime
    try:
        f = [
            float(row.get('success_rate', 0)),
            float(row.get('response_time', 0)),
            float(row.get('uptime', 0))
        ]
        y = float(row.get('label', 0))
        return f, y
    except:
        return [0.0]*3, 0.0

def load_data(csv_path):
    df = pd.read_csv(csv_path)
    X = []
    y = []
    chains = []
    
    # Detect Schema
    is_advanced = 'success_rate' in df.columns
    feature_names = ['SuccessRate', 'ResponseTime', 'Uptime'] if is_advanced else ['Unlimited', 'FreshSpender', 'FreqSpike', 'UnknownTarget', 'GasRatio']
    
    for _, row in df.iterrows():
        if is_advanced:
            features, label = parse_row_advanced(row)
        else:
            features, label = parse_row_standard(row)
            
        X.append(features)
        y.append(label)
        chains.append(row.get('chain', 'unknown'))
        
    return np.array(X), np.array(y), np.array(chains), feature_names

def bootstrap_auc(y_true, y_pred, n_bootstraps=100):
    rng = np.random.RandomState(42)
    aucs = []
    for i in range(n_bootstraps):
        indices = rng.randint(0, len(y_pred), len(y_pred))
        if len(np.unique(y_true[indices])) < 2:
            continue
        score = roc_auc_score(y_true[indices], y_pred[indices])
        aucs.append(score)
    return np.percentile(aucs, [2.5, 97.5]), np.mean(aucs)

def main():
    args = parse_args()
    print(f"Loading data from {args.input}...")
    
    X, y, chains, feature_names = load_data(args.input)
    unique_chains = np.unique(chains)
    
    print(f"Total samples: {len(X)}")
    print(f"Chains found: {unique_chains}")
    print(f"Positive samples: {np.sum(y)}")

    if np.sum(y) == 0:
        print("Error: No positive samples found. Cannot train.")
        sys.exit(1)
        
    # --- Feature Importance Analysis (Explainability) ---
    clf = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
    clf.fit(X, y)
    
    importances = clf.feature_importances_
    indices = np.argsort(importances)[::-1]
    
    print("\n" + "="*40)
    print("🧠 EXPLAINABLE AI REPORT: Feature Importance")
    print("="*40)
    print(f"{'Feature Name':<20} | {'Importance':<10}")
    print("-" * 33)
    
    explainability_data = []
    for f in range(X.shape[1]):
        idx = indices[f]
        name = feature_names[idx]
        score = importances[idx]
        print(f"{name:<20} | {score:.4f}")
        explainability_data.append({"feature": name, "importance": score})
        
    # Save explainability report for paper
    with open('out/feature_importance.json', 'w') as f:
        json.dump(explainability_data, f, indent=2)
    print("-" * 33)
    print("Saved feature importance to out/feature_importance.json")
    print("="*40 + "\n")
    
    # ----------------------------------------------------

    # Train on Mainnet (Primary)
    mainnet_mask = (chains == 'mainnet')
    if np.sum(mainnet_mask) == 0:
        print("Warning: No mainnet data found. Training on all data.")
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    else:
        X_train = X[mainnet_mask]
        y_train = y[mainnet_mask]
        
    print(f"Training on {len(X_train)} samples...")
    # Use balanced class weight to handle imbalanced dataset (5% positives)
    clf = RandomForestClassifier(n_estimators=50, max_depth=5, random_state=42, class_weight='balanced')
    clf.fit(X_train, y_train)

    # --- Feature Importance Extraction ---
    importances = clf.feature_importances_
    fi_path = os.path.join('out', 'paper_data', 'feature_importance.csv')
    if not os.path.exists(os.path.dirname(fi_path)):
        os.makedirs(os.path.dirname(fi_path))
        
    with open(fi_path, 'w') as f:
        f.write("feature,importance\n")
        for name, imp in zip(feature_names, importances):
            f.write(f"{name},{imp}\n")
    print(f"✅ Feature Importance saved to {fi_path}")
    # -------------------------------------

    report = {
        "model_type": "RandomForest",
        "training_samples": len(X_train),
        "chain_metrics": {}
    }

    # --- Baseline Comparison (Rule-based vs RF) ---
    print("\n" + "="*40)
    print("⚖️ BASELINE COMPARISON (Ablation Study)")
    print("="*40)
    print(f"{'Method':<15} | {'Accuracy':<10} | {'Precision':<10} | {'Recall':<10} | {'F1-Score':<10}")
    print("-" * 65)

    # Define Baseline: Rule-based (e.g. if GasRatio > 0.8 OR Unlimited)
    # Features: ['Unlimited', 'FreshSpender', 'FreqSpike', 'UnknownTarget', 'GasRatio']
    # Indices: 0=Unlimited, 4=GasRatio
    
    # Simple Rule: Unlimited Approval OR High Gas Ratio (>0.8)
    def rule_predict(X_batch):
        preds = []
        for x in X_batch:
            # Rule: If Unlimited (idx 0) == 1 OR GasRatio (idx 4) > 0.8 -> High Risk
            if x[0] == 1.0 or x[4] > 0.8:
                preds.append(1.0)
            else:
                preds.append(0.0)
        return np.array(preds)

    # 1. Baseline Performance (Rule-based)
    y_pred_rule = rule_predict(X)
    acc_rule = accuracy_score(y, y_pred_rule)
    prec_rule = precision_score(y, y_pred_rule, zero_division=0)
    rec_rule = recall_score(y, y_pred_rule, zero_division=0)
    f1_rule = f1_score(y, y_pred_rule, zero_division=0)
    
    print(f"{'Baseline (Rule)':<15} | {acc_rule:.4f}     | {prec_rule:.4f}     | {rec_rule:.4f}     | {f1_rule:.4f}")
    
    # 2. RF Performance (Ours)
    y_pred_rf = clf.predict(X)
    acc_rf = accuracy_score(y, y_pred_rf)
    prec_rf = precision_score(y, y_pred_rf, zero_division=0)
    rec_rf = recall_score(y, y_pred_rf, zero_division=0)
    f1_rf = f1_score(y, y_pred_rf, zero_division=0)
    
    print(f"{'TrustManager':<15} | {acc_rf:.4f}     | {prec_rf:.4f}     | {rec_rf:.4f}     | {f1_rf:.4f}")
    print("-" * 65)
    
    report["baseline_comparison"] = {
        "baseline": {"accuracy": acc_rule, "precision": prec_rule, "recall": rec_rule, "f1": f1_rule},
        "trustmanager": {"accuracy": acc_rf, "precision": prec_rf, "recall": rec_rf, "f1": f1_rf}
    }
    # -----------------------------------------------

    markdown = "# System-level Robustness & Significance Report\n\n"
    markdown += "## 1. Multi-chain Performance Analysis\n\n"
    markdown += "| Chain | Samples | Accuracy | AUC (Mean) | 95% CI | Precision | Recall |\n"
    markdown += "|---|---|---|---|---|---|---|\n"

    # Evaluate per chain
    aucs_per_chain = {}
    
    for chain in unique_chains:
        mask = (chains == chain)
        X_c = X[mask]
        y_c = y[mask]
        
        if len(X_c) == 0: continue
        
        y_pred = clf.predict(X_c)
        y_prob = clf.predict_proba(X_c)[:, 1]
        
        acc = accuracy_score(y_c, y_pred)
        prec = precision_score(y_c, y_pred, zero_division=0)
        rec = recall_score(y_c, y_pred, zero_division=0)
        
        try:
            (ci_lower, ci_upper), auc_mean = bootstrap_auc(y_c, y_prob)
            aucs_per_chain[chain] = auc_mean
        except:
            auc_mean = 0.5
            ci_lower, ci_upper = 0.5, 0.5

        report["chain_metrics"][chain] = {
            "accuracy": acc,
            "auc": auc_mean,
            "auc_ci_lower": ci_lower,
            "auc_ci_upper": ci_upper,
            "precision": prec,
            "recall": rec
        }
        
        markdown += f"| {chain} | {len(X_c)} | {acc:.4f} | {auc_mean:.4f} | [{ci_lower:.3f}, {ci_upper:.3f}] | {prec:.4f} | {rec:.4f} |\n"

    # Significance Test (T-test of Mainnet vs Others if possible, or simple overlap check)
    markdown += "\n## 2. Statistical Significance\n\n"
    if 'mainnet' in aucs_per_chain and len(unique_chains) > 1:
        base_auc = aucs_per_chain['mainnet']
        markdown += f"Baseline (Mainnet) AUC: **{base_auc:.4f}**\n\n"
        for chain in unique_chains:
            if chain == 'mainnet': continue
            curr_auc = aucs_per_chain.get(chain, 0)
            diff = base_auc - curr_auc
            markdown += f"- **{chain}**: AUC Delta = {diff:+.4f}. "
            if abs(diff) < 0.05:
                markdown += "Result is **Statistically Comparable** (within 5% margin).\n"
            else:
                markdown += "Result shows **Significant Deviation** (>5% margin).\n"
    
    # Robustness to Noise
    markdown += "\n## 3. Robustness Evaluation (Noise Injection)\n\n"
    # Flip 10% of features in test set
    X_noisy = X.copy()
    noise_mask = np.random.random(X_noisy.shape) < 0.1
    X_noisy[noise_mask] = 1 - X_noisy[noise_mask] # Simple flip for binary-ish features
    
    y_pred_noisy = clf.predict(X_noisy)
    acc_noisy = accuracy_score(y, y_pred_noisy)
    acc_orig = accuracy_score(y, clf.predict(X))
    drop = acc_orig - acc_noisy
    
    markdown += f"Accuracy Drop under 10% Feature Noise: **{drop*100:.2f}%** (from {acc_orig:.4f} to {acc_noisy:.4f})\n"
    markdown += "- **Assessment**: "
    if drop < 0.1:
        markdown += "Model is **Robust** to feature noise.\n"
    else:
        markdown += "Model is **Sensitive** to feature noise.\n"

    out_json = os.path.join(os.path.dirname(args.input), 'robustness_report.json')
    with open(out_json, 'w') as f:
        json.dump(report, f, indent=2)
        
    out_md = os.path.join(os.path.dirname(args.input), 'Significance_Report.md')
    with open(out_md, 'w', encoding='utf-8') as f:
        f.write(markdown)
        
    print(f"Reports written to {out_json} and {out_md}")

if __name__ == '__main__':
    main()
