
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import f1_score, accuracy_score
from sklearn.model_selection import train_test_split

def parse_row(row):
    try:
        def to_float(val):
            if isinstance(val, str):
                v = val.strip().lower()
                if v in ('true','1','high','yes'): return 1.0
                try:
                    return float(v)
                except:
                    return 0.0
            if pd.isna(val): return 0.0
            return float(val or 0)
        return [
            to_float(row.get('unlimited', 0)),
            to_float(row.get('freshSpender', 0)),
            to_float(row.get('freqSpike', 0)),
            to_float(row.get('unknownTarget', 0)),
            to_float(row.get('gasRatio', 0))
        ]
    except:
        return [0.0]*5

def run_ablation():
    print("Loading dataset...")
    df = pd.read_csv('out/multichain_dataset.csv')
    
    X = np.array([parse_row(row) for _, row in df.iterrows()])
    y = np.array([1 if str(row.get('finalLabel')).lower() == 'high_risk' else 0 for _, row in df.iterrows()])
    
    print(f"Dataset Size: {len(X)}")
    print(f"Feature Sums: {np.sum(X, axis=0)}")
    
    feature_names = ['Unlimited', 'FreshSpender', 'FreqSpike', 'UnknownTarget', 'GasRatio']
    
    # Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    
    results = []
    
    # 1. Full Model
    clf = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
    clf.fit(X_train, y_train)
    
    # Feature Importance
    importances = clf.feature_importances_
    for name, imp in zip(feature_names, importances):
        print(f"Feature {name}: {imp:.4f}")
        
    y_pred = clf.predict(X_test)
    f1_full = f1_score(y_test, y_pred)
    results.append({'Variant': 'Full Model (TrustManager)', 'F1': f1_full, 'Drop': '-'})
    
    print(f"Full Model F1: {f1_full:.4f}")
    
    # 2. Ablation Loop
    for i, name in enumerate(feature_names):
        # Create dataset without feature i
        X_train_ablated = np.delete(X_train, i, axis=1)
        X_test_ablated = np.delete(X_test, i, axis=1)
        
        clf_ablated = RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42)
        clf_ablated.fit(X_train_ablated, y_train)
        y_pred_ablated = clf_ablated.predict(X_test_ablated)
        
        f1_ablated = f1_score(y_test, y_pred_ablated)
        diff = f1_full - f1_ablated
        
        print(f"w/o {name}: F1={f1_ablated:.4f} (Drop: {diff:.4f})")
        results.append({'Variant': f'w/o {name}', 'F1': f1_ablated, 'Drop': f"-{diff:.4f}"})

    # Generate LaTeX Table Content
    print("\n=== LaTeX Table Body ===")
    for r in results:
        print(f"{r['Variant']} & {r['F1']*100:.2f}\\% & {r['Drop']} \\\\")
    print("========================")

if __name__ == "__main__":
    run_ablation()
