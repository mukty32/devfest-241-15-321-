// Global State Variables
let graphData = null;
let currentLanguage = 'en';
let startNodeId = 'R1';
let hazardState = { blocked_nodes: [], blocked_edges: [], closed_exits: [] };
let isHighContrast = false;
let animStep = -1;
let animInterval = null;

// Translation Dictionary
const i18n = {
  en: {
    title: "Smart Escape Simulator",
    subtitle: "Interactive Evacuation Route Planner",
    reset: "Reset Hazards",
    export: "Export PNG",
    startLoc: "Select Start Location:",
    upload: "Import Custom Graph (JSON):",
    status: "Status",
    noRoute: "No route available",
    blockedStart: "Starting location blocked",
    routeFound: (exit, cost, seq) => `Best Route to ${exit} (Cost: ${cost}): ${seq.join(" → ")}`,
    guideTitle: "Quick Guide:",
    guideNode: "• Click any Node/Exit to toggle block/close state.",
    guideEdge: "• Click any Corridor line to toggle block state.",
    walkthrough: "Route Walkthrough:",
    playAnim: "Play Walkthrough",
    altTitle: "Alternative Routes:"
  },
  bn: {
    title: "স্মার্ট এস্কেপ সিমুলেটর",
    subtitle: "ইন্টারেক্টিভ উদ্ধার রুট সিমুলেটর",
    reset: "রিসেট রুট",
    export: "PNG এক্সপোর্ট",
    startLoc: "শুরুর স্থান নির্বাচন করুন:",
    upload: "কাস্টম গ্রাফ (JSON) আপলোড:",
    status: "অবস্থা",
    noRoute: "কোনো পথ পাওয়া যায়নি",
    blockedStart: "শুরুর স্থানটি অবরুদ্ধ",
    routeFound: (exit, cost, seq) => `${exit} এ যাওয়ার সেরা পথ (খরচ: ${cost}): ${seq.join(" → ")}`,
    guideTitle: "নির্দেশনা:",
    guideNode: "• নোড বা এক্সিটে ক্লিক করে বন্ধ/খুলুন।",
    guideEdge: "• করিডোর লাইনে ক্লিক করে ব্লক/খুলুন।",
    walkthrough: "ধাপভিত্তিক এনিমেশন:",
    playAnim: "এনিমেশন দেখুন",
    altTitle: "বিকল্প পথসমূহ:"
  }
};

// Application Initialization
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('src/building.json');
    graphData = await res.json();
    resetHazards();
    setupEventListeners();
    renderApp();
  } catch (e) {
    console.error("Error loading building.json:", e);
  }
});

function resetHazards() {
  hazardState = JSON.parse(JSON.stringify(graphData.initial_state));
  stopAnimation();
  renderApp();
}

function setupEventListeners() {
  // Language Switcher
  document.getElementById('lang-btn').addEventListener('click', () => {
    currentLanguage = currentLanguage === 'en' ? 'bn' : 'en';
    document.getElementById('lang-btn').innerText = currentLanguage === 'en' ? 'বাংলা' : 'English';
    updateLanguageTexts();
    renderApp();
  });

  // High Contrast Mode Toggle
  document.getElementById('contrast-btn').addEventListener('click', () => {
    isHighContrast = !isHighContrast;
    document.body.classList.toggle('bg-black', isHighContrast);
    renderApp();
  });

  // Reset Button
  document.getElementById('reset-btn').addEventListener('click', resetHazards);

  // Start Location Selector
  document.getElementById('start-select').addEventListener('change', (e) => {
    startNodeId = e.target.value;
    stopAnimation();
    renderApp();
  });

  // JSON Upload
  document.getElementById('json-input').addEventListener('change', handleFileUpload);

  // Export PNG
  document.getElementById('export-png-btn').addEventListener('click', exportMapPNG);

  // Play Walkthrough Animation
  document.getElementById('play-anim-btn').addEventListener('click', startWalkthroughAnimation);
}

function updateLanguageTexts() {
  const t = i18n[currentLanguage];
  document.getElementById('app-title').innerText = t.title;
  document.getElementById('app-subtitle').innerText = t.subtitle;
  document.getElementById('reset-btn-text').innerText = t.reset;
  document.getElementById('export-btn-text').innerText = t.export;
  document.getElementById('start-label').innerText = t.startLoc;
  document.getElementById('upload-label').innerText = t.upload;
  document.getElementById('status-title').innerText = t.status;
  document.getElementById('guide-title').innerText = t.guideTitle;
  document.getElementById('guide-node').innerText = t.guideNode;
  document.getElementById('guide-edge').innerText = t.guideEdge;
  document.getElementById('walkthrough-label').innerText = t.walkthrough;
  document.getElementById('play-anim-text').innerText = t.playAnim;
  document.getElementById('alt-routes-title').innerText = t.altTitle;
}

// JSON Schema Validation Rules
function validateBuildingData(data) {
  if (!data || !data.nodes || !data.edges) return "Invalid JSON schema";
  if (data.nodes.length < 2 || data.nodes.length > 60) return "Nodes must be between 2 and 60";
  if (data.edges.length < 1 || data.edges.length > 150) return "Edges must be between 1 and 150";
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
      if (err) { alert("Validation Error: " + err); return; }
      graphData = json;
      startNodeId = graphData.nodes[0].id;
      resetHazards();
    } catch {
      alert("Invalid JSON File");
    }
  };
  reader.readAsText(file);
}

// Exact Routing Logic with Tie Breaking Rules
function computeShortestRoute() {
  if (hazardState.blocked_nodes.includes(startNodeId)) {
    return { status: "BLOCKED_START" };
  }

  const validNodes = graphData.nodes.filter(n => !hazardState.blocked_nodes.includes(n.id));
  const validNodeIds = new Set(validNodes.map(n => n.id));
  const validExits = validNodes.filter(n => n.type === 'exit' && !hazardState.closed_exits.includes(n.id));

  if (validExits.length === 0) return { status: "NO_ROUTE" };

  const adj = {};
  validNodes.forEach(n => adj[n.id] = []);
  graphData.edges.forEach(e => {
    if (hazardState.blocked_edges.includes(e.id)) return;
    if (validNodeIds.has(e.from) && validNodeIds.has(e.to)) {
      adj[e.from].push({ node: e.to, cost: e.cost, edgeId: e.id });
      adj[e.to].push({ node: e.from, cost: e.cost, edgeId: e.id });
    }
  });

  let candidates = [];

  // Dijkstra Execution
  validExits.forEach(exit => {
    let queue = [{ id: startNodeId, cost: 0, path: [startNodeId] }];
    let visited = new Set();

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      let curr = queue.shift();

      if (curr.id === exit.id) {
        candidates.push({ exitId: exit.id, cost: curr.cost, path: curr.path });
        break;
      }

      if (visited.has(curr.id)) continue;
      visited.add(curr.id);

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

  return {
    status: "SUCCESS",
    route: candidates[0],
    alternatives: candidates.slice(1)
  };
}

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
  const altContainer = document.getElementById('alt-routes-container');
  const altList = document.getElementById('alt-routes-list');

  if (res.status === "BLOCKED_START") {
    detailsDiv.innerHTML = `<span class="text-red-400 font-bold">${t.blockedStart}</span>`;
    altContainer.classList.add('hidden');
  } else if (res.status === "NO_ROUTE") {
    detailsDiv.innerHTML = `<span class="text-amber-400 font-bold">${t.noRoute}</span>`;
    altContainer.classList.add('hidden');
  } else {
    detailsDiv.innerHTML = `<span class="text-emerald-400 font-bold">${t.routeFound(res.route.exitId, res.route.cost, res.route.path)}</span>`;
    
    // Render Alternative Routes
    if (res.alternatives && res.alternatives.length > 0) {
      altContainer.classList.remove('hidden');
      altList.innerHTML = res.alternatives.map((alt, i) => 
        `<div>• Alt ${i+1} (${alt.exitId}, Cost: ${alt.cost}): ${alt.path.join(" → ")}</div>`
      ).join('');
    } else {
      altContainer.classList.add('hidden');
    }
  }
}

// Map SVG Renderer
function renderSVG(routeResult) {
  const svg = document.getElementById('map-svg');
  svg.innerHTML = '';

  const activeEdges = new Set();
  let animatedNodes = [];

  if (routeResult.status === "SUCCESS") {
    const p = routeResult.route.path;
    animatedNodes = p;

    const limit = (animStep >= 0) ? Math.min(animStep, p.length - 1) : p.length - 1;
    for (let i = 0; i < limit; i++) {
      const e = graphData.edges.find(edge => 
        (edge.from === p[i] && edge.to === p[i+1]) || (edge.from === p[i+1] && edge.to === p[i])
      );
      if (e) activeEdges.add(e.id);
    }
  }

  // Render Corridor Edges
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
    line.setAttribute("stroke", isBlocked ? "#ef4444" : isActive ? "#3b82f6" : isHighContrast ? "#ffffff" : "#475569");
    line.setAttribute("stroke-width", isActive ? "6" : "3");
    if (isBlocked) line.setAttribute("stroke-dasharray", "6,6");
    line.style.cursor = "pointer";

    line.onclick = () => {
      if (isBlocked) {
        hazardState.blocked_edges = hazardState.blocked_edges.filter(id => id !== edge.id);
      } else {
        hazardState.blocked_edges.push(edge.id);
      }
      stopAnimation();
      renderApp();
    };

    svg.appendChild(line);

    // Edge Cost Badge
    const midX = (fromNode.x + toNode.x) / 2;
    const midY = (fromNode.y + toNode.y) / 2;

    const badge = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    badge.setAttribute("cx", midX);
    badge.setAttribute("cy", midY);
    badge.setAttribute("r", "10");
    badge.setAttribute("fill", "#1e293b");
    badge.setAttribute("stroke", "#475569");
    svg.appendChild(badge);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", midX);
    text.setAttribute("y", midY + 4);
    text.setAttribute("fill", "#38bdf8");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("text-anchor", "middle");
    text.textContent = edge.cost;
    svg.appendChild(text);
  });

  // Render Nodes
  graphData.nodes.forEach(node => {
    const isBlocked = hazardState.blocked_nodes.includes(node.id) || hazardState.closed_exits.includes(node.id);
    const isStart = node.id === startNodeId;
    const isWalkthroughActive = (animStep >= 0 && animatedNodes[animStep] === node.id);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    g.style.cursor = "pointer";

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", node.x);
    circle.setAttribute("cy", node.y);
    circle.setAttribute("r", isWalkthroughActive ? "24" : "20");
    
    let fill = "#334155";
    if (node.type === 'exit') fill = isBlocked ? "#ef4444" : "#10b981";
    else if (isBlocked) fill = "#ef4444";
    else if (isStart) fill = "#3b82f6";

    if (isWalkthroughActive) fill = "#f59e0b"; // Yellow pulse during walkthrough

    circle.setAttribute("fill", fill);
    circle.setAttribute("stroke", isWalkthroughActive ? "#fbbf24" : isStart ? "#93c5fd" : "#0f172a");
    circle.setAttribute("stroke-width", "3");

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
      stopAnimation();
      renderApp();
    };

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", node.x);
    text.setAttribute("y", node.y + 4);
    text.setAttribute("fill", "#ffffff");
    text.setAttribute("font-size", "11");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("text-anchor", "middle");
    text.textContent = node.id;

    g.appendChild(circle);
    g.appendChild(text);
    svg.appendChild(g);
  });
}

// Animation Walkthrough Control
function startWalkthroughAnimation() {
  const res = computeShortestRoute();
  if (res.status !== "SUCCESS") return;

  stopAnimation();
  animStep = 0;
  renderApp();

  animInterval = setInterval(() => {
    animStep++;
    if (animStep >= res.route.path.length) {
      stopAnimation();
    }
    renderApp();
  }, 700);
}

function stopAnimation() {
  if (animInterval) clearInterval(animInterval);
  animInterval = null;
  animStep = -1;
}

// PNG Export Feature
function exportMapPNG() {
  const svgElement = document.getElementById('map-svg');
  const svgData = new XMLSerializer().serializeToString(svgElement);
  const canvas = document.createElement("canvas");
  const svgSize = svgElement.getBoundingClientRect();

  canvas.width = svgSize.width || 800;
  canvas.height = svgSize.height || 600;

  const ctx = canvas.getContext("2d");
  const img = new Image();

  img.onload = () => {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.download = `Smart_Escape_Map_${startNodeId}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
}