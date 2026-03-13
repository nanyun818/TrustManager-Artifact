import pandas as pd
import numpy as np
import json
import os
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_validate
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

# Ensure output directory exists
os.makedirs('out', exist_ok=True)

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
            return float(val)
        
        return [
            to_float(row.get('unlimited', 0)),
            to_float(row.get('freshSpender', 0)),
            to_float(row.get('freqSpike', 0)),
            to_float(row.get('unknownTarget', 0)),
            to_float(row.get('gasRatio', 0))
        ]
    except:
        return [0.0]*5

from sklearn.base import BaseEstimator, ClassifierMixin

class RuleBasedClassifier(BaseEstimator, ClassifierMixin):
    def fit(self, X, y=None):
        self.classes_ = np.array([0, 1])
        return self
    def predict(self, X):
        # Index 4 is GasRatio. If > 0.8, predict 1 (High Risk), else 0.
        return (X[:, 4] > 0.8).astype(int)
    def predict_proba(self, X):
        preds = self.predict(X)
        # Return probability matrix: [prob_0, prob_1]
        # If pred is 1, [0, 1]. If pred is 0, [1, 0].
        return np.vstack([1 - preds, preds]).T

def run_evaluation():
    print("Loading dataset...")
    df = pd.read_csv('out/multichain_dataset.csv')
    
    # Feature Extraction
    X = np.array([parse_row(row) for _, row in df.iterrows()])
    y = np.array([1 if str(row.get('finalLabel')).lower() == 'high_risk' else 0 for _, row in df.iterrows()])
    
    # Handle NaNs globally just in case
    imputer = SimpleImputer(strategy='constant', fill_value=0.0)
    X = imputer.fit_transform(X)
    
    print(f"Dataset Size: {len(X)}")
    print(f"Class Balance: {np.sum(y)} Positive ({(np.sum(y)/len(y))*100:.2f}%) / {len(y)-np.sum(y)} Negative")

    # Scale Data (Important for LR)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    # Models
    models = {
        'Rule-Based (Gas > 0.8)': RuleBasedClassifier(),
        'Logistic Regression': LogisticRegression(max_iter=1000),
        'Random Forest (Ours)': RandomForestClassifier(n_estimators=100, max_depth=10, random_state=42),
        'Gradient Boosting': GradientBoostingClassifier(n_estimators=100, learning_rate=0.1, max_depth=3, random_state=42)
    }

    results = {}
    
    # 5-Fold Cross Validation
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    
    print("\nRunning 5-Fold Cross-Validation...")
    print(f"{'Model':<30} | {'Accuracy':<8} | {'Precision':<9} | {'Recall':<8} | {'F1-Score':<8} | {'AUC':<8}")
    print("-" * 85)

    for name, model in models.items():
        # Use X_scaled for LR, X for Trees (though Trees don't care, consistent is fine)
        X_curr = X_scaled if name == 'Logistic Regression' else X
        
        scores = cross_validate(model, X_curr, y, cv=cv, 
                                scoring=['accuracy', 'precision', 'recall', 'f1', 'roc_auc'],
                                n_jobs=1)
        
        res = {
            'accuracy': f"{np.mean(scores['test_accuracy']):.4f} ± {np.std(scores['test_accuracy']):.4f}",
            'precision': f"{np.mean(scores['test_precision']):.4f} ± {np.std(scores['test_precision']):.4f}",
            'recall': f"{np.mean(scores['test_recall']):.4f} ± {np.std(scores['test_recall']):.4f}",
            'f1': f"{np.mean(scores['test_f1']):.4f} ± {np.std(scores['test_f1']):.4f}",
            'auc': f"{np.mean(scores['test_roc_auc']):.4f} ± {np.std(scores['test_roc_auc']):.4f}",
            'raw_f1': np.mean(scores['test_f1']) # for sorting if needed
        }
        results[name] = res
        
        print(f"{name:<30} | {np.mean(scores['test_accuracy']):.4f}   | {np.mean(scores['test_precision']):.4f}    | {np.mean(scores['test_recall']):.4f}   | {np.mean(scores['test_f1']):.4f}   | {np.mean(scores['test_roc_auc']):.4f}")

    # Generate LaTeX Table Content
    print("\n=== LaTeX Table Body ===")
    for name, res in results.items():
        # Clean format for LaTeX
        acc = res['accuracy'].split(' ± ')[0]
        prec = res['precision'].split(' ± ')[0]
        rec = res['recall'].split(' ± ')[0]
        f1 = res['f1'].split(' ± ')[0]
        auc = res['auc'].split(' ± ')[0]
        
        # Convert to percentage
        acc = f"{float(acc)*100:.2f}"
        prec = f"{float(prec)*100:.2f}"
        rec = f"{float(rec)*100:.2f}"
        f1 = f"{float(f1)*100:.2f}"
        auc = f"{float(auc):.4f}" # Keep AUC as 0.xxxx
        
        if "Ours" in name:
            print(f"\\textbf{{{name}}} & \\textbf{{{acc}\\%}} & \\textbf{{{prec}\\%}} & \\textbf{{{rec}\\%}} & \\textbf{{{f1}\\%}} & \\textbf{{{auc}}} \\\\")
        else:
            print(f"{name} & {acc}\\% & {prec}\\% & {rec}\\% & {f1}\\% & {auc} \\\\")
    print("========================")

if __name__ == "__main__":
    run_evaluation()
