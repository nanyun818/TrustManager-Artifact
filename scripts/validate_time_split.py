import csv, json, argparse, os, math

def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))

def parse_row(row):
    # Feature mapping aligned with train_models.py
    failed = float(row.get('failed', 0) or 0)
    gasRatio = float(row.get('gasRatio', 0) or 0)
    isSwap = float(row.get('isSwap', 0) or 0)
    isApprove = float(row.get('isApprove', 1) or 1)
    approveToUnusual = row.get('approveToUnusual')
    if approveToUnusual is None:
        approveToUnusual = 1.0 if str(row.get('unknownTarget','')).lower() == 'true' else 0.0
    else:
        approveToUnusual = float(approveToUnusual or 0)
    freqNorm = row.get('freqNorm')
    if freqNorm is None:
        freqNorm = 1.0 if str(row.get('freqSpike','')).lower() == 'true' else 0.0
    else:
        freqNorm = float(freqNorm or 0)
    f = {
        'failed': failed,
        'gasRatio': gasRatio,
        'isSwap': isSwap,
        'isApprove': isApprove,
        'approveToUnusual': approveToUnusual,
        'freqNorm': freqNorm,
        'unlimited': 1.0 if str(row.get('unlimited','')).lower() == 'true' else 0.0,
        'freshSpender': 1.0 if str(row.get('freshSpender','')).lower() == 'true' else 0.0,
        'freqSpike': 1.0 if str(row.get('freqSpike','')).lower() == 'true' else 0.0,
        'unknownTarget': 1.0 if str(row.get('unknownTarget','')).lower() == 'true' else 0.0,
        'score': float(row.get('score', 0) or 0),
    }
    lbl = row.get('label')
    if lbl is not None and str(lbl).strip() != '':
        y = 1.0 if str(lbl).strip() in ('1','true','True','HIGH','high','High') else 0.0
    else:
        y = 1.0 if (row.get('finalLabel','') == 'high_risk') else 0.0
    return f, y

def read_csv(path):
    rows = []
    with open(path, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append(row)
    return rows

def train(dataset, lr=0.1, epochs=50):
    keys = ['failed','gasRatio','isSwap','isApprove','approveToUnusual','freqNorm',
            'unlimited','freshSpender','freqSpike','unknownTarget','score']
    w = {k: 0.0 for k in keys}
    b = 0.0
    n = max(1, len(dataset))
    for _ in range(epochs):
        grad_w = {k: 0.0 for k in keys}
        grad_b = 0.0
        for row in dataset:
            f, y = parse_row(row)
            z = b + sum(w[k]*f[k] for k in keys)
            p = sigmoid(z)
            err = p - y
            for k in keys:
                grad_w[k] += err * f[k]
            grad_b += err
        for k in keys:
            w[k] -= lr * grad_w[k] / n
        b -= lr * grad_b / n
    return {'bias': b, 'weights': w}

def risk(row, model):
    f, _ = parse_row(row)
    z = model['bias'] + sum(model['weights'].get(k,0.0)*f[k] for k in f)
    return sigmoid(z)

def evaluate(rows, model, thresholds):
    metrics = []
    preds = [risk(r, model) for r in rows]
    labels = []
    for r in rows:
        lbl = r.get('label')
        if lbl is not None and str(lbl).strip() != '':
            y = 1 if str(lbl).strip() in ('1','true','True','HIGH','high','High') else 0
        else:
            y = 1 if (r.get('finalLabel','')=='high_risk') else 0
        labels.append(y)
    for th in thresholds:
        tp=fp=tn=fn=0
        for p,y in zip(preds,labels):
            yhat = 1 if p >= th else 0
            if yhat==1 and y==1: tp+=1
            elif yhat==1 and y==0: fp+=1
            elif yhat==0 and y==0: tn+=1
            else: fn+=1
        precision = tp / max(1, tp+fp)
        recall = tp / max(1, tp+fn)
        f1 = 2*precision*recall / max(1e-9, precision+recall)
        metrics.append({'threshold': th, 'TP': tp, 'FP': fp, 'TN': tn, 'FN': fn,
                        'precision': round(precision,4), 'recall': round(recall,4), 'f1': round(f1,4)})
    # Top-K metrics on test
    paired = sorted(zip(preds, labels), key=lambda x: x[0], reverse=True)
    def precision_at_k(k):
        if k<=0: return 0.0
        top = paired[:min(k,len(paired))]
        pos = sum(1 for _,y in top if y==1)
        return round(pos / max(1,len(top)), 4)
    topk = {
        'precision@50': precision_at_k(50),
        'precision@100': precision_at_k(100),
        'precision@200': precision_at_k(200)
    }
    return metrics, topk

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', default='out/labeled_dataset.csv')
    ap.add_argument('--sortField', default='block')  # 'block' or 'timestamp'
    ap.add_argument('--trainRatio', default=0.8, type=float)
    ap.add_argument('--thresholds', default='0.1,0.2,0.3,0.4,0.5')
    ap.add_argument('--outPrefix', default='out/val_timesplit')
    args = ap.parse_args()

    rows = read_csv(args.input)
    # determine sort field
    field = args.sortField
    if field == 'block':
        key = lambda r: int(r.get('block', r.get('blockNumber', '0')) or 0)
    else:
        key = lambda r: int(r.get('timestamp', r.get('timeStamp', '0')) or 0)
    rows_sorted = sorted(rows, key=key)
    n = len(rows_sorted)
    split_idx = int(n * args.trainRatio)
    train_rows = rows_sorted[:split_idx]
    test_rows = rows_sorted[split_idx:]

    # train
    model = train(train_rows)

    # evaluate
    ths = [float(x) for x in args.thresholds.split(',') if x]
    metrics, topk = evaluate(test_rows, model, ths)

    # write outputs
    os.makedirs(os.path.dirname(args.outPrefix), exist_ok=True)
    json_out = {
        'config': {'input': args.input, 'sortField': args.sortField, 'trainRatio': args.trainRatio, 'thresholds': ths},
        'train_size': len(train_rows),
        'test_size': len(test_rows),
        'metrics': metrics,
        'topk': topk,
    }
    with open(args.outPrefix + '_summary.json', 'w', encoding='utf-8') as f:
        json.dump(json_out, f, indent=2)
    print('Time-split validation done.')
    print(json.dumps(json_out, indent=2))

if __name__ == '__main__':
    main()