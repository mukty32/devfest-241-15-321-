// --- Application State ---
let graphData = null;
let currentLanguage = 'en';
let startNodeId = 'R1';
let hazardState = { blocked_nodes: [], blocked_edges: [], closed_exits: [] };

// --- Bilingual Dictionary ---
const i18n = {
  en: {
    title: "Smart Escape Simulator",
    reset: "Reset Hazards",
    startLoc: "Select Start Location:",
    import: "Import JSON File:",
    status: "Status",
    noRoute: "No route available",
    blockedStart: "Starting location blocked",
    routeFound: (exit, cost, seq) => `Route to ${exit} (Cost: ${cost}): ${seq.join(" → ")}`
  },
  bn: {
    title: "স্মার্ট এস্কেপ সিমুলেটর",
    reset: "রিসেট রুট",
    startLoc: "শুরুর স্থান নির্বাচন করুন:",
    import: "JSON ফাইল আপলোড করুন:",
    status: "অবস্থা",
    noRoute: "কোনো পথ পাওয়া যায়নি",
    blockedStart: "শুরুর স্থানটি অবরুদ্ধ",
    routeFound: (exit, cost, seq) => `${exit} এ যাওয়ার পথ (খরচ: ${cost}): ${seq.join(" → ")}`
  }
};

// --- Initializer ---
document.addEventListener('DOMContentLoaded', async () => {
  const res = await fetch('src/building.json');
  graphData = await res.json();
  resetHazards();
  setupEventListeners();
  renderApp();
});

function resetHazards() {
  hazardState = JSON.parse(JSON.stringify(graphData.initial_state));
  renderApp();
}

function setupEventListeners() {
  document.getElementById('lang-btn').addEventListener('click', () => {
    currentLanguage = currentLanguage === 'en' ? 'bn' : 'en';
    document.getElementById('lang-btn').innerText = currentLanguage === 'en' ? 'বাংলা' : 'English';
    updateLanguageTexts();
    renderApp();
  });

  document.getElementById('reset-btn').addEventListener('click', resetHazards);
  
  document.getElementById('start-select').addEventListener('change', (e) => {
    startNodeId = e.target.value;
    renderApp();
  });

  document.getElementById('json-input').addEventListener('change', handleFileUpload);
}

function updateLanguageTexts() {
  const t = i18n[currentLanguage];
  document.getElementById('app-title').innerText = t.title;
  document.getElementById('reset-btn').innerText = t.reset;
  document.getElementById('start-label').innerText = t.startLoc;
  document.getElementById('upload-label').innerText = t.import;
}

// --- JSON Validation ---
function validateBuildingData(data) {
  if (!data || !data.nodes || !data.edges) return "Invalid format";
  if (data.nodes.length < 2 || data.nodes.length > 60) return "Nodes count must be 2-60";
  if (data.edges.length < 1 || data.edges.length > 150) return "Edges count must be 1-150";
  return null;
}

function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const json = JSON.parse(evt.target.result);
      const err = validateBuildingData(json);
      if (err) { alert("Error: " + err); return; }
      graphData = json;
      startNodeId = graphData.nodes[0].id;
      resetHazards();
    } catch {
      alert("Invalid JSON file");
    }
  };
  reader.readAsText(file);
}

// --- Pathfinding Algorithm (Dijkstra + Ties) ---
function computeShortestRoute() {
  if (hazardState.blocked_nodes.includes(startNodeId)) {
    return { status: "BLOCKED_START" };
  }

  const validNodes = graphData.nodes.filter(n => !hazardState.blocked_nodes.includes(n.id));
  const validNodeIds = new Set(validNodes.map(n => n.id));
  const validExits = validNodes.filter(n => n.type === 'exit' && !hazardState.closed_exits.includes(n.id));

  if (validExits.length === 0) return { status: "NO_ROUTE" };

  // Build Adjacency List
  const adj = {};
  validNodes.forEach(n => adj[n.id] = []);
  graphData.edges.forEach(e => {
    if (hazardState.blocked_edges.includes(e.id)) return;
    if (validNodeIds.has(e.from) && validNodeIds.has(e.to)) {
      adj[e.from].push({ node: e.to, cost: e.cost, edgeId: e.id });
      adj[e.to].push({ node: e.from, cost: e.cost, edgeId: e.id });
    }
  });

  // Track all possible paths using BFS/Dijkstra
  let candidates = [];

  validExits.forEach(exit => {
    let distances = {}, previous = {};
    validNodes.forEach(n => distances[n.id] = Infinity);
    distances[startNodeId] = 0;
    
    let queue = [{ id: startNodeId, cost: 0, path: [startNodeId] }];

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      let curr = queue.shift();

      if (curr.id === exit.id) {
        candidates.push({ exitId: exit.id, cost: curr.cost, path: curr.path });
        break;
      }

      for (let neighbor of adj[curr.id]) {
        if (!curr.path.includes(neighbor.node)) {
          queue.push({
            id: neighbor.node,
            cost: curr.cost + neighbor.cost,
            path: [...curr.path, neighbor.node]
          });
        }
      }
    }
  });

  if (candidates.length === 0) return { status: "NO_ROUTE" };

  // Lexicographical Tie-breaking
  candidates.sort((a, b) => {
    if (a.cost !== b.cost) return a.cost - b.cost;
    if (a.exitId !== b.exitId) return a.exitId.localeCompare(b.exitId);
    return a.path.join('-').localeCompare(b.path.join('-'));
  });

  return { status: "SUCCESS", route: candidates[0] };
}

// --- Render SVG Map and Controls ---
function renderApp() {
  populateStartSelect();
  const routeResult = computeShortestRoute();
  updateStatusBanner(routeResult);
  renderSVG(routeResult);
}

function populateStartSelect() {
  const select = document.getElementById('start-select');
  select.innerHTML = '';
  graphData.nodes.forEach(n => {
    if (n.type !== 'exit') {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.innerText = `${n.label} (${n.id})`;
      if (n.id === startNodeId) opt.selected = true;
      select.appendChild(opt);
    }
  });
}

function updateStatusBanner(res) {
  const t = i18n[currentLanguage];
  const detailsDiv = document.getElementById('status-details');

  if (res.status === "BLOCKED_START") {
    detailsDiv.innerHTML = `<span class="text-red-400 font-bold">${t.blockedStart}</span>`;
  } else if (res.status === "NO_ROUTE") {
    detailsDiv.innerHTML = `<span class="text-amber-400 font-bold">${t.noRoute}</span>`;
  } else {
    detailsDiv.innerHTML = `<span class="text-emerald-400 font-semibold">${t.routeFound(res.route.exitId, res.route.cost, res.route.path)}</span>`;
  }
}

function renderSVG(routeResult) {
  const svg = document.getElementById('map-svg');
  svg.innerHTML = '';

  const activeEdges = new Set();
  if (routeResult.status === "SUCCESS") {
    const p = routeResult.route.path;
    for (let i = 0; i < p.length - 1; i++) {
      const e = graphData.edges.find(edge => 
        (edge.from === p[i] && edge.to === p[i+1]) || (edge.from === p[i+1] && edge.to === p[i])
      );
      if (e) activeEdges.add(e.id);
    }
  }

  // Draw Edges
  graphData.edges.forEach(edge => {
    const fromNode = graphData.nodes.find(n => n.id === edge.from);
    const toNode = graphData.nodes.find(n => n.id === edge.to);
    const isBlocked = hazardState.blocked_edges.includes(edge.id);
    const isActive = activeEdges.has(edge.id);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", fromNode.x);
    line.setAttribute("y1", fromNode.y);
    line.setAttribute("x2", toNode.x);
    line.setAttribute("y2", toNode.y);
    line.setAttribute("stroke", isBlocked ? "#ef4444" : isActive ? "#3b82f6" : "#475569");
    line.setAttribute("stroke-width", isActive ? "6" : "3");
    if (isBlocked) line.setAttribute("stroke-dasharray", "5,5");
    line.style.cursor = "pointer";

    // Toggle Edge Hazard
    line.onclick = () => {
      if (isBlocked) {
        hazardState.blocked_edges = hazardState.blocked_edges.filter(id => id !== edge.id);
      } else {
        hazardState.blocked_edges.push(edge.id);
      }
      renderApp();
    };

    svg.appendChild(line);

    // Edge Cost Label
    const midX = (fromNode.x + toNode.x) / 2;
    const midY = (fromNode.y + toNode.y) / 2;
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY - 5);
    text.setAttribute("fill", "#94a3b8");
    text.setAttribute("font-size", "12");
    text.setAttribute("text-anchor", "middle");
    text.textContent = edge.cost;
    svg.appendChild(text);
  });

  // Draw Nodes
  graphData.nodes.forEach(node => {
    const isBlocked = hazardState.blocked_nodes.includes(node.id) || hazardState.closed_exits.includes(node.id);
    const isStart = node.id === startNodeId;
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.style.cursor = "pointer";

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", "20");
    
    let fill = "#334155";
    if (node.type === 'exit') fill = isBlocked ? "#7f1d1d" : "#059669";
    else if (isBlocked) fill = "#991b1b";
    else if (isStart) fill = "#2563eb";

    circle.setAttribute("fill", fill);
    circle.setAttribute("stroke", isStart ? "#60a5fa" : "#0f172a");
    circle.setAttribute("stroke-width", "3");

    // Toggle Node / Exit Hazard
    g.onclick = () => {
      if (node.type === 'exit') {
        if (hazardState.closed_exits.includes(node.id)) {
          hazardState.closed_exits = hazardState.closed_exits.filter(id => id !== node.id);
        } else {
          hazardState.closed_exits.push(node.id);
        }
      } else {
        if (hazardState.blocked_nodes.includes(node.id)) {
          hazardState.blocked_nodes = hazardState.blocked_nodes.filter(id => id !== node.id);
        } else {
          hazardState.blocked_nodes.push(node.id);
        }
      }
      renderApp();
    };

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", node.x);
    text.setAttribute("y", node.y + 5);
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-size", "12");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("text-anchor", "middle");
    text.textContent = node.id;

    g.appendChild(circle);
    g.appendChild(text);
    svg.appendChild(g);
  });
}