import z3

def prove_trust_logic():
    print("🔬 Starting Formal Verification with Z3 Theorem Prover...")
    
    # 1. Define Variables (Integers to match Solidity uint)
    # Weights
    alpha = z3.Int('alpha')
    beta = z3.Int('beta')
    gamma = z3.Int('gamma')
    
    # Metrics (0-100)
    R = z3.Int('R') # Reliability
    S = z3.Int('S') # Security
    D = z3.Int('D') # Decentralization/Activity
    
    # Trust Score
    T = z3.Int('T')
    
    # 2. Define System Constraints (The "Rules" of the Contract)
    solver = z3.Solver()
    
    # Constraint A: Weights must sum to 10000 (100%)
    solver.add(alpha + beta + gamma == 10000)
    solver.add(alpha >= 0, beta >= 0, gamma >= 0)
    
    # Constraint B: Metrics are within valid range [0, 100]
    solver.add(R >= 0, R <= 100)
    solver.add(S >= 0, S <= 100)
    solver.add(D >= 0, D <= 100)
    
    # Logic Definition: Trust Calculation Formula
    # T = (alpha * R + beta * S + gamma * D) / 10000
    # In Z3, integer division truncates, matching Solidity
    trust_formula = (alpha * R + beta * S + gamma * D) / 10000
    solver.add(T == trust_formula)
    
    print("\n--- Proof 1: Safety Property (Malicious Bound) ---")
    # Theorem: If a node is malicious (all metrics <= 20), Trust Score MUST be <= 20, regardless of weight distribution.
    # To prove this, we try to find a Counter-Example:
    # "Exists a state where (Metrics <= 20) AND (Trust > 20)"
    
    solver.push() # Save state
    
    # Condition: Malicious Node
    solver.add(R <= 20, S <= 20, D <= 20)
    
    # Counter-Example Condition: Trust is somehow high (> 20)
    solver.add(T > 20)
    
    result = solver.check()
    if result == z3.unsat:
        print("✅ VERIFIED: It is impossible for a malicious node (metrics<=20) to get Trust > 20.")
    else:
        print("❌ FAILED: Found a counter-example where a malicious node gets high trust!")
        print(solver.model())
        
    solver.pop() # Restore state
    
    print("\n--- Proof 2: Liveness Property (Honest Reward) ---")
    # Theorem: If a node is honest (all metrics >= 90), Trust Score MUST be >= 90.
    
    solver.push()
    
    # Condition: Honest Node
    solver.add(R >= 90, S >= 90, D >= 90)
    
    # Counter-Example Condition: Trust is somehow low (< 90)
    solver.add(T < 90)
    
    result = solver.check()
    if result == z3.unsat:
        print("✅ VERIFIED: It is impossible for an honest node (metrics>=90) to get Trust < 90.")
    else:
        print("❌ FAILED: Found a counter-example!")
        print(solver.model())
        
    solver.pop()

    print("\n--- Proof 3: Sybil Resistance (Simplistic) ---")
    # Theorem: If a Sybil node has perfect S (Security=100) but 0 R and 0 D (New/Inactive), 
    # and we prioritize Reliability (alpha > 5000), can it exceed Trust 50?
    
    solver.push()
    
    # Condition: Sybil (New account pretending to be secure)
    solver.add(S == 100)
    solver.add(R == 0)
    solver.add(D == 0)
    
    # Condition: System emphasizes Reliability
    solver.add(alpha > 5000) 
    
    # Counter-Example: Can it trick the system to get > 50?
    solver.add(T > 50)
    
    result = solver.check()
    if result == z3.unsat:
        print("✅ VERIFIED: A Sybil node (S=100, R=0, D=0) cannot exceed Trust 50 when Alpha > 0.5.")
    else:
        print("⚠️  Insight: Under some conditions, Sybil MIGHT exceed 50. Let's see when:")
        # If it's satisfiable (sat), it means there IS a case where T > 50. 
        # Actually, if alpha > 5000 (e.g. 6000), then beta+gamma < 4000. 
        # T = (alpha*0 + beta*100 + gamma*0)/10000 = beta/100. 
        # If beta can be 4000, T=40. So it should be unsat. 
        # Wait, if alpha=5001, beta could be 4999. T = 49.99 -> 49.
        # So it should be impossible to get > 50.
        # Let's see what Z3 says.
        if result == z3.sat:
             print("   [!] Counter-example found (this is mathematically possible):")
             print(solver.model())
        
    solver.pop()
    
    print("\nformal verification complete.")

if __name__ == "__main__":
    prove_trust_logic()
