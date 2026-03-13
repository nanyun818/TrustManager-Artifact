const fs = require('fs');
const path = require('path');

// --- Configuration ---
const CONFIG = {
    nodesCount: 200,
    rounds: 50,
    collusionSize: 20, // Larger clique
};

class Node {
    constructor(id, type) {
        this.id = id;
        this.type = type;
        this.interactions = {}; // target -> count
    }

    interact(targetId) {
        if (!this.interactions[targetId]) this.interactions[targetId] = 0;
        this.interactions[targetId]++;
    }
}

function runGraphSimulation() {
    console.log("🕸️ Starting Graph Attack Simulation (Collusion Detection)...");

    const nodes = [];
    
    // 1. Create Nodes
    // Honest nodes (Majority)
    for(let i=0; i<140; i++) nodes.push(new Node(`Honest_${i}`, "Honest"));
    
    // Smart Collusion (Whitewashing/Mixing)
    const smartCliqueNodes = [];
    for(let i=0; i<CONFIG.collusionSize; i++) {
        const n = new Node(`Smart_${i}`, "SmartCollusion");
        nodes.push(n);
        smartCliqueNodes.push(n);
    }
    
    // Sybil nodes
    for(let i=0; i<40; i++) nodes.push(new Node(`Sybil_${i}`, "Sybil"));

    // 2. Simulate Interactions
    const interactionLog = []; // from,to,round

    for (let r = 1; r <= CONFIG.rounds; r++) {
        nodes.forEach(node => {
            let target = null;

            if (node.type === "Collusion") {
                // Classic Dumb Attacker: 90% internal
                if (Math.random() < 0.9) {
                    const mate = cliqueNodes[Math.floor(Math.random() * cliqueNodes.length)];
                    if (mate.id !== node.id) target = mate;
                } else {
                    target = nodes[Math.floor(Math.random() * 140)]; 
                }
            } else if (node.type === "SmartCollusion") {
                // Smart Attacker: 50% internal, 50% external (Mimicry)
                if (Math.random() < 0.5) {
                    const mate = smartCliqueNodes[Math.floor(Math.random() * smartCliqueNodes.length)];
                    if (mate.id !== node.id) target = mate;
                } else {
                    // Interact with honest nodes to dilute clique score
                    target = nodes[Math.floor(Math.random() * 140)];
                }
            } else if (node.type === "Honest") {
                // Interact randomly with anyone
                target = nodes[Math.floor(Math.random() * nodes.length)];
            } else if (node.type === "Sybil") {
                // Sybils attack a random target then stop
                if (r < 5) target = nodes[Math.floor(Math.random() * nodes.length)];
            }

            if (target && target.id !== node.id) {
                node.interact(target.id);
                interactionLog.push({ from: node.id, to: target.id, round: r, type: node.type });
            }
        });
    }

    // 3. Export Interaction Graph CSV
    let csv = "from,to,round,label\n";
    interactionLog.forEach(log => {
        csv += `${log.from},${log.to},${log.round},${log.type}\n`;
    });
    fs.writeFileSync(path.join(process.cwd(), 'graph_interactions.csv'), csv);
    console.log(`✅ Interaction Graph saved to graph_interactions.csv (${interactionLog.length} edges)`);

    // 4. Compute Graph Features (Simple JS Implementation for Demo)
    // In production, this would be Python/NetworkX
    console.log("🔍 Computing Graph Features...");
    
    const graphStats = nodes.map(node => {
        // Feature 1: Degree (Total Interactions)
        const degree = Object.values(node.interactions).reduce((a,b) => a+b, 0);
        
        // Feature 2: Unique Partners (Fan-out)
        const uniquePartners = Object.keys(node.interactions).length;

        // Feature 3: Clique Ratio (Interactions with partners who also interact with me)
        // This requires a full graph lookup.
        // Simplified: "Clustering Coefficient" approximation or just "Recursive Interaction"
        
        // Let's compute a simple "Clique Score": 
        // How many of my partners interacted with EACH OTHER?
        // This is expensive O(N^3) naively, but N=50 is fine.
        let triangles = 0;
        const partners = Object.keys(node.interactions);
        
        // We need global access to interactions for this.
        // Let's build an adjacency set
        const adj = {};
        nodes.forEach(n => {
            adj[n.id] = new Set(Object.keys(n.interactions));
        });

        partners.forEach(p1 => {
            partners.forEach(p2 => {
                if (p1 !== p2) {
                    if (adj[p1] && adj[p1].has(p2)) {
                        triangles++;
                    }
                }
            });
        });
        
        // Normalize triangles
        const possibleTriangles = partners.length * (partners.length - 1);
        const clusteringCoeff = possibleTriangles > 0 ? triangles / possibleTriangles : 0;

        return {
            id: node.id,
            type: node.type,
            degree: degree,
            uniquePartners: uniquePartners,
            cliqueScore: clusteringCoeff.toFixed(4), // This is the graph feature!
            isCollusion: (node.type === "Collusion" || node.type === "SmartCollusion") ? 1 : 0
        };
    });

    // 5. Export Dataset for ML
    let mlCsv = "id,degree,uniquePartners,cliqueScore,label\n";
    graphStats.forEach(s => {
        mlCsv += `${s.id},${s.degree},${s.uniquePartners},${s.cliqueScore},${s.isCollusion}\n`;
    });
    fs.writeFileSync(path.join(process.cwd(), 'graph_features_dataset.csv'), mlCsv);
    console.log(`✅ ML Dataset saved to graph_features_dataset.csv`);
}

runGraphSimulation();
