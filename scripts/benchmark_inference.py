
import time
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

def benchmark():
    print("Loading dataset...")
    df = pd.read_csv('out/multichain_dataset.csv')
    
    # Prepare data
    def parse_row(row):
        try:
            def to_float(val):
                if isinstance(val, str):
                    v = val.strip().lower()
                    if v in ('true','1','high','yes'): return 1.0
                    return 0.0
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

    X = np.array([parse_row(row) for _, row in df.iterrows()])
    y = np.array([1 if str(row.get('finalLabel')).lower() == 'high_risk' else 0 for _, row in df.iterrows()])
    
    # Train
    print(f"Training on {len(X)} samples...")
    clf = RandomForestClassifier(n_estimators=100, max_depth=5, n_jobs=-1)
    clf.fit(X, y)
    
    # Benchmark Inference
    print("Benchmarking inference...")
    
    # Batch inference
    start_time = time.time()
    _ = clf.predict(X)
    end_time = time.time()
    
    total_time = end_time - start_time
    throughput = len(X) / total_time
    latency_ms = (total_time / len(X)) * 1000
    
    print(f"\n=== Performance Metrics ===")
    print(f"Total Transactions: {len(X)}")
    print(f"Total Time: {total_time:.4f}s")
    print(f"Throughput: {throughput:.2f} tx/sec")
    print(f"Avg Latency: {latency_ms:.4f} ms/tx")
    print("===========================")

if __name__ == "__main__":
    benchmark()
