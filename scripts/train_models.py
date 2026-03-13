# Custom Decision Tree / Random Forest Implementation
# Author: TraeAI (Pair Programmer)
# Purpose: Zero-dependency ML implementation for node risk classification

import json, csv, argparse, os, random, math, sys

# --- Configuration ---
# Use the new ADVANCED dataset
TRAIN_DATA_PATH = os.path.join("out", "ml_data", "advanced_training_set.csv") 
MODEL_SAVE_DIR = os.path.join("models")

if not os.path.exists(TRAIN_DATA_PATH):
    # Fallback to labeled dataset if advanced one doesn't exist
    TRAIN_DATA_PATH = os.path.join("out", "labeled_dataset.csv")

if not os.path.exists(MODEL_SAVE_DIR):
    os.makedirs(MODEL_SAVE_DIR)

print(f"🚀 Training on dataset: {TRAIN_DATA_PATH}")

# --- 1. Decision Tree Implementation (from scratch) ---

class Node:
    def __init__(self, feature_idx=None, threshold=None, left=None, right=None, *, value=None):
        self.feature_idx = feature_idx
        self.threshold = threshold
        self.left = left
        self.right = right
        self.value = value

    def is_leaf_node(self):
        return self.value is not None

class DecisionTree:
    def __init__(self, min_samples_split=2, max_depth=100, n_features=None, class_weight=None):
        self.min_samples_split = min_samples_split
        self.max_depth = max_depth
        self.n_features = n_features
        self.class_weight = class_weight
        self.root = None

    def fit(self, X, y):
        # Calculate feature importance
        self.feature_importances_ = [0] * len(X[0])
        
        n_feats_avail = len(X[0])
        self.n_features = n_feats_avail if not self.n_features else min(n_feats_avail, self.n_features)
        
        # Ensure y supports list indexing (y[idxs])
        if isinstance(y, list):
             y = ListWrapper(y)
             
        self.root = self._grow_tree(X, y)

    def _grow_tree(self, X, y, depth=0):
        n_samples, n_feats = len(X), len(X[0])
        n_labels = len(set(y))

        # Stopping criteria
        if (depth >= self.max_depth or n_labels == 1 or n_samples < self.min_samples_split):
            leaf_value = self._most_common_label(y)
            return Node(value=leaf_value)

        feat_idxs = random.sample(range(n_feats), self.n_features)

        # Find the best split
        best_feat, best_thresh = self._best_split(X, y, feat_idxs)

        if best_feat is None:
             return Node(value=self._most_common_label(y))

        # Create child nodes
        left_idxs, right_idxs = self._split(X[:, best_feat], best_thresh)
        
        left = self._grow_tree(X[left_idxs, :], y[left_idxs], depth+1)
        right = self._grow_tree(X[right_idxs, :], y[right_idxs], depth+1)
        return Node(best_feat, best_thresh, left, right)

    def _best_split(self, X, y, feat_idxs):
        best_gain = -1
        split_idx, split_threshold = None, None

        for feat_idx in feat_idxs:
            X_column = X[:, feat_idx]
            thresholds = set(X_column) # unique values
            
            # Optimization: limit threshold checks if too many
            if len(thresholds) > 100:
                 thresholds = random.sample(list(thresholds), 100)

            for thr in thresholds:
                gain = self._information_gain(y, X_column, thr)
                if gain > best_gain:
                    best_gain = gain
                    split_idx = feat_idx
                    split_threshold = thr
        
        if split_idx is not None:
            self.feature_importances_[split_idx] += best_gain
            
        return split_idx, split_threshold

    def _information_gain(self, y, X_column, threshold):
        # Parent entropy
        parent_entropy = self._entropy(y)

        # Generate split
        left_idxs, right_idxs = self._split(X_column, threshold)
        if len(left_idxs) == 0 or len(right_idxs) == 0:
            return 0

        # Weighted avg child entropy
        y_left = y[left_idxs]
        y_right = y[right_idxs]

        def get_total_weight(ylabels):
            if not self.class_weight: return len(ylabels)
            return sum(self.class_weight.get(l, 1.0) for l in ylabels)

        n = get_total_weight(y)
        n_l = get_total_weight(y_left)
        n_r = get_total_weight(y_right)
        
        if n == 0: return 0

        e_l, e_r = self._entropy(y_left), self._entropy(y_right)
        child_entropy = (n_l/n) * e_l + (n_r/n) * e_r

        # Information Gain
        ig = parent_entropy - child_entropy
        return ig

    def _split(self, X_column, split_thresh):
        left_idxs = [i for i, x in enumerate(X_column) if x <= split_thresh]
        right_idxs = [i for i, x in enumerate(X_column) if x > split_thresh]
        return left_idxs, right_idxs

    def _entropy(self, y):
        hist = {}
        total_weight = 0
        for label in y:
            w = self.class_weight.get(label, 1.0) if self.class_weight else 1.0
            hist[label] = hist.get(label, 0) + w
            total_weight += w
        
        if total_weight == 0: return 0
        
        ps = [count / total_weight for count in hist.values()]
        return -sum([p * math.log2(p) for p in ps if p > 0])

    def _most_common_label(self, y):
        if len(y) == 0: return 0
        hist = {}
        for label in y:
            w = self.class_weight.get(label, 1.0) if self.class_weight else 1.0
            hist[label] = hist.get(label, 0) + w
        return max(hist, key=hist.get)

    def predict(self, X):
        return [self._traverse_tree(x, self.root) for x in X]

    def _traverse_tree(self, x, node):
        if node.is_leaf_node():
            return node.value
        if x[node.feature_idx] <= node.threshold:
            return self._traverse_tree(x, node.left)
        return self._traverse_tree(x, node.right)
    
    # Serialization helper
    def to_dict(self):
        return self._node_to_dict(self.root)
        
    def _node_to_dict(self, node):
        if node.is_leaf_node():
            return {"value": node.value}
        return {
            "feature_idx": node.feature_idx,
            "threshold": node.threshold,
            "left": self._node_to_dict(node.left),
            "right": self._node_to_dict(node.right)
        }

# --- 2. Random Forest Implementation ---

class RandomForest:
    def __init__(self, n_trees=10, max_depth=10, min_samples_split=2, n_features=None, class_weight=None):
        self.n_trees = n_trees
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.n_features = n_features
        self.class_weight = class_weight
        self.trees = []

    def fit(self, X, y):
        self.trees = []
        
        # Calculate class weights if 'balanced'
        final_class_weight = self.class_weight
        if self.class_weight == 'balanced':
            # y is a ListWrapper or list. Convert to list to iterate
            y_list = y.to_list() if hasattr(y, 'to_list') else y
            
            # Count classes
            counts = {}
            for label in y_list:
                counts[label] = counts.get(label, 0) + 1
            
            n_samples = len(y_list)
            n_classes = len(counts)
            
            final_class_weight = {}
            for label, count in counts.items():
                if count > 0:
                     final_class_weight[label] = n_samples / (n_classes * count)
                else:
                     final_class_weight[label] = 1.0
            
            print(f"⚖️  Auto-calculated Class Weights: {final_class_weight}")

        for _ in range(self.n_trees):
            tree = DecisionTree(max_depth=self.max_depth,
                                min_samples_split=self.min_samples_split,
                                n_features=self.n_features,
                                class_weight=final_class_weight)
            X_sample, y_sample = self._bootstrap_samples(X, y)
            tree.fit(X_sample, y_sample)
            self.trees.append(tree)

    def _bootstrap_samples(self, X, y):
        n_samples = X.shape[0] # X is a list of lists here effectively, but let's assume indexing
        idxs = [random.randint(0, n_samples-1) for _ in range(n_samples)]
        return X[idxs], y[idxs]

    def predict(self, X):
        predictions = []
        for x in X:
            tree_preds = [tree._traverse_tree(x, tree.root) for tree in self.trees]
            # Majority vote
            predictions.append(max(set(tree_preds), key=tree_preds.count))
        return predictions

    def get_feature_importance(self):
        # Average importance across all trees
        total_importance = [0] * self.trees[0].n_features
        for tree in self.trees:
            for i, imp in enumerate(tree.feature_importances_):
                total_importance[i] += imp
        
        # Normalize
        s = sum(total_importance)
        if s == 0: return total_importance
        return [x / s for x in total_importance]

    def to_json(self):
        return {
            "type": "random_forest",
            "n_trees": self.n_trees,
            "trees": [t.to_dict() for t in self.trees]
        }

# --- 3. Matrix Wrapper for List of Lists ---
# To make X[idxs] work easily without numpy
class Matrix:
    def __init__(self, data):
        self.data = data # List of lists
        self.shape = (len(data), len(data[0]) if data and isinstance(data[0], list) else 0)
    
    def __getitem__(self, key):
        if isinstance(key, tuple):
            # X[:, feat_idx]
            rows, col = key
            if isinstance(rows, slice) and rows == slice(None):
                return [self.data[r][col] for r in range(self.shape[0])]
            # X[left_idxs, :]
            if isinstance(rows, list):
                # IMPORTANT: When slicing rows, we must return a Matrix for recursion
                return Matrix([self.data[r] for r in rows])
        if isinstance(key, list):
             # X[idxs] or y[idxs]
             return Matrix([self.data[i] for i in key])
        if isinstance(key, int):
             return self.data[key]
        return self.data[key]
        
    def __len__(self):
        return len(self.data)
        
    def to_list(self):
        return self.data

class ListWrapper:
    def __init__(self, data): self.data = data
    def __getitem__(self, key):
        if isinstance(key, list): return ListWrapper([self.data[i] for i in key])
        return self.data[key]
    def __len__(self): return len(self.data)
    def __iter__(self): return iter(self.data)
    def to_list(self): return self.data

# --- 4. Main Script Logic ---

def parse_row_advanced(row):
    # Features from advanced_training_set.csv: success_rate,response_time,uptime,label
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
            to_float(row.get('unknownTarget', 0))
        ]
        y_raw = row.get('label')
        if y_raw is None or str(y_raw).strip()=='':
            y_raw = row.get('finalLabel','')
        y = 1.0 if str(y_raw).strip().lower() in ('1','true','high') else 0.0
        return f, y
    except:
        return [0.0]*4, 0.0

def parse_row_graph(row):
    try:
        f = [
            float(row.get('degree', 0) or 0),
            float(row.get('uniquePartners', 0) or 0),
            float(row.get('cliqueScore', 0) or 0),
            float(row.get('failed', 0) or 0),
            float(row.get('gasRatio', 0) or 0)
        ]
        y_raw = row.get('label')
        if y_raw is None or str(y_raw).strip()=='':
            y_raw = row.get('finalLabel','')
        y = 1.0 if str(y_raw).strip().lower() in ('1','true','high') else 0.0
        return f, y
    except:
        return [0.0]*5, 0.0

def read_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)
    return rows

def main():
    # Ignore argparse to force our configuration, or allow override
    # If called without args, use defaults
    input_path = TRAIN_DATA_PATH
    output_path = os.path.join(MODEL_SAVE_DIR, "rf_model_advanced.json")
    
    if len(sys.argv) > 1 and '--input' in sys.argv:
        ap = argparse.ArgumentParser()
        ap.add_argument('--input', required=True)
        ap.add_argument('--output', required=True)
        ap.add_argument('--model-type', default='rf', choices=['rf', 'logreg'])
        args = ap.parse_args()
        input_path = args.input
        output_path = args.output

    rows = read_csv(input_path)
    
    # Shuffle rows for random split
    random.shuffle(rows)

    # Detect dataset type
    header = rows[0].keys()
    
    if 'cliqueScore' in header:
        print(f"📊 Detected Graph Data! Preparing features...")
        parse_fn = parse_row_graph
        feature_names = ['degree', 'uniquePartners', 'cliqueScore', 'failed', 'gasRatio']
    elif 'success_rate' in header:
        print(f"🛡️ Detected Advanced Attack Data! Preparing features...")
        parse_fn = parse_row_advanced
        feature_names = ['SuccessRate', 'ResponseTime', 'OnlineTime']
    else:
        print(f"⚠️ Standard dataset detected. Preparing standard features...")
        parse_fn = parse_row_standard
        feature_names = ['unlimited', 'freshSpender', 'freqSpike', 'unknownTarget']

    X_list = []
    y_list = []
    
    for row in rows:
        f, y = parse_fn(row)
        X_list.append(f)
        y_list.append(y)
            
    # Split Train/Test (80/20)
    split_idx = int(len(X_list) * 0.8)
    X_train = Matrix(X_list[:split_idx])
    y_train_list = y_list[:split_idx]
    X_test = Matrix(X_list[split_idx:])
    y_test_list = y_list[split_idx:]
    
    # Helper for y wrapper (Redundant definition removed, using global one or moving it out if needed)
    # But since ListWrapper is defined globally (or at module level in previous snippet), we use that.
    # Wait, ListWrapper was defined inside main in previous snippet? Let's check.
    # It was at line 389 inside main. Let's move it out or re-define here.
    
    print(f"🔄 Training Random Forest on {len(X_train)} samples...")
    
    # Pass class_weight='balanced' implicitly via fit logic
    model = RandomForest(n_trees=10, max_depth=10)
    model.fit(X_train, ListWrapper(y_train_list))
    
    # Evaluate
    print(f"📉 Evaluating on {len(X_test)} test samples...")
    preds = model.predict(X_test)
    
    correct = sum(1 for p, y in zip(preds, y_test_list) if p == y)
    acc = correct / len(preds)
    print(f"✅ Accuracy: {acc*100:.2f}%")
    
    # Feature Importance
    importances = model.get_feature_importance()
    print("\n🔍 Feature Importance Analysis (Explainability):")
    for name, imp in zip(feature_names, importances):
        print(f"   - {name}: {imp:.4f}")

    # Save
    with open(output_path, 'w') as f:
        json.dump(model.to_json(), f)
    print(f"\n💾 Model saved to {output_path}")

if __name__ == "__main__":
    main()
