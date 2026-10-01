const $ = (id) => document.getElementById(id);

let datasets = [];
let currentId = null;
let stats = null;
let solve = null;

const CACHE_COLORS = [
  "#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626",
  "#0891b2", "#ca8a04", "#4f46e5", "#db2777", "#65a30d",
];

const CHART = {
  line: "#1d4ed8",
  fill: "#2563eb",
  saved: "#059669",
  presence: "#e11d48",
  unique: "#2563eb",
  dup: "#e11d48",
  ink: "#0f172a",
  muted: "#64748b",
  empty: "#eef2f7",
  dc: "#475569",
  hover: "#0f172a",
};

function fmt(n) {
  return Number(n).toLocaleString("fr-FR");
}

function pct(x) {
  return (100 * x).toFixed(1) + " %";
}

async function loadDatasets() {
  const res = await fetch("/api/datasets");
  const data = await res.json();
  datasets = data.datasets;
  const box = $("dataset-list");
  box.innerHTML = "";
  datasets.forEach((ds) => {
    const btn = document.createElement("button");
    btn.className = "ds";
    btn.type = "button";
    btn.innerHTML = `<strong>${ds.fichier}</strong><small>${ds.famille} · V=${ds.V} E=${ds.E} R=${fmt(ds.R)} C=${ds.C} X=${ds.X} · ${(ds.solutions || []).length} .out</small>`;
    btn.onclick = () => selectDataset(ds.id);
    box.appendChild(btn);
  });
}

function setActive(id) {
  document.querySelectorAll(".ds").forEach((el, i) => {
    el.classList.toggle("active", datasets[i].id === id);
  });
}

async function selectDataset(id) {
  currentId = id;
  setActive(id);
  $("empty").classList.add("hidden");
  $("work").classList.remove("hidden");
  $("solution-block").classList.add("hidden");
  solve = null;
  const ds = datasets.find((d) => d.id === id);
  $("ds-name").textContent = ds.fichier;
  $("ds-meta").textContent = ds.chemin + " · " + ds.famille;
  const sel = $("out-select");
  sel.innerHTML = "";
  (ds.solutions || []).forEach((sol) => {
    const opt = document.createElement("option");
    opt.value = sol.id;
    opt.textContent = sol.fichier;
    sel.appendChild(opt);
  });
  if (!ds.solutions || !ds.solutions.length) {
    $("out-hint").textContent =
      "Aucun .out a cote de cette instance. Place un fichier du meme nom (ex. " +
      ds.fichier.replace(/\.in$/, ".out") +
      ") ou nom.auteur.out dans le meme dossier.";
    $("btn-analyse").disabled = true;
  } else {
    $("out-hint").textContent = "Le dashboard lit le .out : peu importe comment il a ete produit.";
    $("btn-analyse").disabled = false;
  }
  stats = await (await fetch("/api/stats/" + encodeURIComponent(id))).json();
  renderStats();
  $("score-cards").innerHTML = "";
  $("dup-cards").innerHTML = "";
  $("caches").innerHTML = "";
  hideTip();
  ["chart-fillpct", "chart-saved", "chart-presence", "chart-duphist", "chart-volume", "chart-matrix"].forEach((cid) => {
    const cv = $(cid);
    if (cv) clearCanvas(cv);
  });
  if (ds.solutions && ds.solutions.length) runAnalyse();
}

function card(label, value) {
  return `<div class="card"><b>${value}</b><span>${label}</span></div>`;
}

function canvasXY(cv, ev) {
  const rect = cv.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

function showTip(ev, lines) {
  const tip = $("chart-tip");
  if (!tip || !lines || !lines.length) return;
  tip.innerHTML = lines.join("<br>");
  tip.classList.remove("hidden");
  const pad = 14;
  const tw = tip.offsetWidth || 180;
  const th = tip.offsetHeight || 40;
  let left = ev.clientX + pad;
  let top = ev.clientY + pad;
  if (left + tw > window.innerWidth - 8) left = ev.clientX - tw - pad;
  if (top + th > window.innerHeight - 8) top = ev.clientY - th - pad;
  tip.style.left = Math.max(8, left) + "px";
  tip.style.top = Math.max(8, top) + "px";
}

function hideTip() {
  const tip = $("chart-tip");
  if (tip) tip.classList.add("hidden");
}

function hitAt(cv, x, y) {
  const hits = cv._hits || [];
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const h = hits[i];
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
  }
  return null;
}

function bindHover(cv) {
  if (!cv || cv._hoverBound) return;
  cv._hoverBound = true;
  cv.addEventListener("mousemove", (ev) => {
    const { x, y } = canvasXY(cv, ev);
    const hit = hitAt(cv, x, y);
    const key = hit ? hit.key : null;
    if (key !== cv._hi) {
      cv._hi = key;
      if (cv._redraw) cv._redraw();
    }
    if (hit) showTip(ev, hit.lines);
    else hideTip();
  });
  cv.addEventListener("mouseleave", () => {
    if (cv._hi != null) {
      cv._hi = null;
      if (cv._redraw) cv._redraw();
    }
    hideTip();
  });
}

function renderStats() {
  const s = stats;
  const v = s.videos;
  const c = s.connectivite;
  $("header-cards").innerHTML = [
    card("Videos", fmt(s.V)),
    card("Endpoints", fmt(s.E)),
    card("Demandes", fmt(s.R)),
    card("Caches", fmt(s.C)),
    card("Capacite", fmt(s.X) + " Mo"),
    card("Gini", v.gini_popularite.toFixed(2)),
    card("Top 10 % videos", pct(v.part_top_10pct)),
    card("Densite reseau", pct(c.densite)),
  ].join("");

  $("insight").textContent =
    `Trafic : les 10 % de videos les plus vues portent ${pct(v.part_top_10pct)} des requetes. ` +
    `Reseau : un endpoint voit en moyenne ${c.degre_endpoint.moyenne.toFixed(1)} caches.` +
    (c.endpoints_isoles ? ` ${c.endpoints_isoles} endpoint(s) sans cache.` : "");

  drawZipf($("chart-zipf"), s.graphiques.zipf);
  drawHeat($("chart-heat"), s.heatmap, (endpoint, cache, lat) => {
    if (!lat) {
      return [`<b>Endpoint ${endpoint} × cache ${cache}</b>`, "Pas de lien"];
    }
    const dc = (s.graphiques.latence_dc || [])[endpoint];
    const extra = dc != null ? [`Datacenter : ${fmt(dc)} ms`, `Gain possible : ${fmt(dc - lat)} ms`] : [];
    return [`<b>Endpoint ${endpoint} × cache ${cache}</b>`, `Latence cache : ${fmt(lat)} ms`, ...extra];
  });
}

function clearCanvas(cv) {
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
}

function sizeCanvas(cv) {
  const w = cv.clientWidth || 400;
  if (!cv.dataset.cssH) {
    cv.dataset.cssH = String(Number(cv.getAttribute("height")) || 140);
  }
  const h = Number(cv.dataset.cssH);
  cv.style.height = h + "px";
  const bw = Math.floor(w * devicePixelRatio);
  const bh = Math.floor(h * devicePixelRatio);
  if (cv.width !== bw || cv.height !== bh) {
    cv.width = bw;
    cv.height = bh;
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  return { ctx, w, h };
}

function drawZipf(cv, ranked) {
  bindHover(cv);
  cv._redraw = () => drawZipf(cv, ranked);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!ranked || !ranked.length) return;
  const maxY = Math.log10(ranked[0] + 1);
  const points = ranked.map((y, i) => {
    const x = (i / Math.max(ranked.length - 1, 1)) * (w - 8) + 4;
    const py = h - 6 - (Math.log10(y + 1) / maxY) * (h - 12);
    return { x, py, y, i };
  });
  ctx.strokeStyle = CHART.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.py);
    else ctx.lineTo(p.x, p.py);
  });
  ctx.stroke();
  const total = ranked.reduce((a, b) => a + b, 0);
  const strip = w / ranked.length;
  points.forEach((p) => {
    const hovered = cv._hi === p.i;
    if (hovered) {
      ctx.fillStyle = CHART.ink;
      ctx.beginPath();
      ctx.arc(p.x, p.py, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    cv._hits.push({
      x: Math.max(0, p.x - strip / 2),
      y: 0,
      w: strip,
      h,
      key: p.i,
      lines: [
        `<b>Rang ${p.i + 1}</b> (videos les plus demandees)`,
        `Volume : ${fmt(p.y)} lectures`,
        `Part du trafic affiche : ${pct(total ? p.y / total : 0)}`,
      ],
    });
  });
}

function drawBars(cv, values, color, labelFn) {
  bindHover(cv);
  cv._redraw = () => drawBars(cv, values, color, labelFn);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!values || !values.length) return;
  const m = Math.max(...values, 1);
  const bw = w / values.length;
  values.forEach((v, i) => {
    const bh = (v / m) * (h - 6);
    const x = i * bw;
    const hovered = cv._hi === i;
    ctx.fillStyle = color;
    ctx.fillRect(x, h - bh, Math.max(1, bw - 0.5), bh);
    if (hovered) {
      ctx.strokeStyle = CHART.ink;
      ctx.lineWidth = 1.25;
      ctx.strokeRect(x + 0.5, h - bh + 0.5, Math.max(1, bw - 1.5), Math.max(0, bh - 1));
    }
    cv._hits.push({
      x,
      y: 0,
      w: bw,
      h,
      key: i,
      lines: labelFn ? labelFn(i, v) : [`Valeur : ${fmt(v)}`],
    });
  });
}

function drawLine(cv, values, color, key) {
  bindHover(cv);
  cv._redraw = () => drawLine(cv, values, color, key);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!values || !values.length) return;
  const ys = values.map((p) => (key ? p[key] : p));
  const maxS = Math.max(...ys, 1);
  const points = ys.map((y, i) => {
    const x = (i / Math.max(ys.length - 1, 1)) * (w - 10) + 5;
    const py = h - 8 - (y / maxS) * (h - 16);
    return { x, py, y, i };
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.py);
    else ctx.lineTo(p.x, p.py);
  });
  ctx.stroke();
  const strip = w / values.length;
  points.forEach((p) => {
    if (cv._hi === p.i) {
      ctx.fillStyle = CHART.ink;
      ctx.beginPath();
      ctx.arc(p.x, p.py, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    const row = values[p.i];
    const extra = [];
    if (row && typeof row === "object") {
      if (row.n != null) extra.push(`Placement #${fmt(row.n)}`);
      if (row.fill_pct != null) extra.push(`Remplissage : ${row.fill_pct.toFixed(1)} %`);
      if (row.densite != null) extra.push(`Densite : ${row.densite}`);
      if (row.gain != null) extra.push(`Gain de ce coup : ${fmt(row.gain)} ms`);
    }
    cv._hits.push({
      x: Math.max(0, p.x - strip / 2),
      y: 0,
      w: strip,
      h,
      key: p.i,
      lines: [`<b>Score ${fmt(p.y)}</b>`, ...extra],
    });
  });
}

function drawHeat(cv, matrix, cellFn) {
  bindHover(cv);
  cv._redraw = () => drawHeat(cv, matrix, cellFn);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!matrix || !matrix.length) {
    ctx.fillStyle = CHART.muted;
    ctx.fillText("Trop grand pour afficher la matrice, ou aucun lien.", 12, 24);
    return;
  }
  const rows = matrix.length;
  const cols = matrix[0].length;
  let max = 1;
  matrix.forEach((row) => row.forEach((v) => { if (v > max) max = v; }));
  const cw = w / cols;
  const rh = h / rows;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const v = matrix[r][c];
      const key = r + ":" + c;
      if (!v) {
        ctx.fillStyle = CHART.empty;
      } else {
        const t = v / max;
        ctx.fillStyle = `rgb(${Math.round(219 - t * 182)}, ${Math.round(234 - t * 170)}, ${Math.round(254 - t * 79)})`;
      }
      ctx.fillRect(c * cw, r * rh, Math.ceil(cw), Math.ceil(rh));
      if (cv._hi === key) {
        ctx.strokeStyle = CHART.ink;
        ctx.strokeRect(c * cw + 0.5, r * rh + 0.5, Math.max(0, cw - 1), Math.max(0, rh - 1));
      }
      cv._hits.push({
        x: c * cw,
        y: r * rh,
        w: cw,
        h: rh,
        key,
        lines: cellFn ? cellFn(r, c, v) : [`Ligne ${r}, colonne ${c}`, `Valeur : ${fmt(v)}`],
      });
    }
  }
}

function cacheColor(i) {
  return CACHE_COLORS[i % CACHE_COLORS.length];
}

function drawDupHist(cv, hist) {
  bindHover(cv);
  cv._redraw = () => drawDupHist(cv, hist);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!hist || hist.length < 2) return;
  const values = hist.slice(1);
  const m = Math.max(...values, 1);
  const bw = w / values.length;
  const total = values.reduce((a, b) => a + b, 0);
  values.forEach((v, i) => {
    const k = i + 1;
    const bh = (v / m) * (h - 22);
    const hovered = cv._hi === k;
    ctx.fillStyle = hovered ? CHART.ink : (i === 0 ? CHART.unique : CHART.dup);
    ctx.fillRect(i * bw + 4, h - 16 - bh, Math.max(4, bw - 8), bh);
    ctx.fillStyle = CHART.muted;
    ctx.font = "11px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(String(k), i * bw + bw / 2, h - 4);
    cv._hits.push({
      x: i * bw,
      y: 0,
      w: bw,
      h,
      key: k,
      lines: [
        `<b>${k} copie${k > 1 ? "s" : ""}</b>`,
        `${fmt(v)} video${v > 1 ? "s" : ""} avec ${k} copie${k > 1 ? "s" : ""}`,
        total ? `Soit ${pct(v / total)} des videos en cache` : "",
      ].filter(Boolean),
    });
  });
}

function drawStacked(cv, dc, cacheEp) {
  bindHover(cv);
  cv._redraw = () => drawStacked(cv, dc, cacheEp);
  const { ctx, w, h } = sizeCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  cv._hits = [];
  if (!dc || !dc.length) {
    ctx.fillStyle = CHART.muted;
    ctx.fillText("Volume trop grand a afficher, ou aucun trafic.", 12, 24);
    return;
  }
  const E = dc.length;
  const series = [dc];
  const colors = [CHART.dc];
  const names = ["datacenter"];
  if (cacheEp) {
    cacheEp.forEach((row, i) => {
      series.push(row);
      colors.push(cacheColor(i));
      names.push("cache " + i);
    });
  }
  const totals = new Array(E).fill(0);
  series.forEach((row) => {
    row.forEach((v, i) => { totals[i] += v; });
  });
  const m = Math.max(...totals, 1);
  const bw = w / E;
  for (let e = 0; e < E; e += 1) {
    cv._hits.push({
      x: e * bw,
      y: 0,
      w: bw,
      h,
      key: e + ":col",
      lines: [`<b>Endpoint ${e}</b>`, `Volume total : ${fmt(totals[e])} Mo`],
    });
    let y = h;
    series.forEach((row, s) => {
      const bh = (row[e] / m) * (h - 4);
      if (bh <= 0) return;
      const key = e + ":" + s;
      ctx.fillStyle = cv._hi === key ? CHART.ink : colors[s];
      y -= bh;
      ctx.fillRect(e * bw, y, Math.max(1, bw - 0.4), bh);
      cv._hits.push({
        x: e * bw,
        y,
        w: bw,
        h: bh,
        key,
        lines: [
          `<b>Endpoint ${e}</b>`,
          `Source : ${names[s]}`,
          `Volume : ${fmt(row[e])} Mo`,
          `Total endpoint : ${fmt(totals[e])} Mo`,
        ],
      });
    });
  }
}

function buildCaches() {
  const C = solve.C;
  const box = $("caches");
  box.innerHTML = "";
  for (let i = 0; i < C; i += 1) {
    const used = (solve.remplissage_Mo || [])[i] || 0;
    const occ = solve.X ? (100 * used) / solve.X : 0;
    const nvid = (solve.videos_par_cache || [])[i] || 0;
    const row = document.createElement("div");
    row.className = "cache-row";
    row.innerHTML = `<span>cache ${i}</span><div class="track"><div class="fill" style="width:${Math.min(100, occ)}%"></div></div><span>${fmt(used)} / ${fmt(solve.X)} Mo</span>`;
    row.addEventListener("mousemove", (ev) => {
      showTip(ev, [
        `<b>Cache ${i}</b>`,
        `Occupation : ${occ.toFixed(1)} %`,
        `${fmt(used)} / ${fmt(solve.X)} Mo`,
        `Videos : ${fmt(nvid)}`,
      ]);
    });
    row.addEventListener("mouseleave", hideTip);
    box.appendChild(row);
  }
}

function renderSolveCharts() {
  drawBars($("chart-fillpct"), solve.occupation_pct, CHART.fill, (i, v) => [
    `<b>Cache ${i}</b>`,
    `Remplissage : ${v.toFixed(1)} %`,
    `Utilise : ${fmt((solve.remplissage_Mo || [])[i] || 0)} / ${fmt(solve.X)} Mo`,
    `Videos : ${fmt((solve.videos_par_cache || [])[i] || 0)}`,
  ]);
  const savedTotal = (solve.gain_par_cache || []).reduce((a, b) => a + b, 0);
  drawBars($("chart-saved"), solve.gain_par_cache, CHART.saved, (i, v) => [
    `<b>Cache ${i}</b>`,
    `Temps gagne : ${fmt(v)} ms`,
    savedTotal ? `Part du gain : ${pct(v / savedTotal)}` : "Aucun gain",
  ]);
  if (solve.presence && solve.presence.length) {
    drawBars($("chart-presence"), solve.presence, CHART.presence, (i, v) => {
      const lines = [`<b>Video ${i}</b>`];
      if (!v) lines.push("Absente des caches");
      else lines.push(`${v} copie${v > 1 ? "s" : ""}`, v >= 2 ? "Dupliquee" : "Une seule copie");
      return lines;
    });
    $("presence-legend").textContent =
      "Hauteur = nombre de caches qui stockent cette video. 0 = absente, 2+ = dupliquee.";
  } else {
    drawDupHist($("chart-presence"), solve.histogramme_copies);
    $("presence-legend").textContent =
      "Trop de videos pour tout afficher : histogramme des copies (k = 1, 2, …).";
  }
  drawDupHist($("chart-duphist"), solve.histogramme_copies);
  drawStacked($("chart-volume"), solve.volume_dc, solve.volume_cache_ep);
  if (solve.matrice) {
    $("matrix-wrap").classList.remove("hidden");
    drawHeat($("chart-matrix"), solve.matrice, (cache, video, present) => {
      const copies = (solve.presence || [])[video];
      return [
        `<b>Video ${video} × cache ${cache}</b>`,
        present ? "Presente dans ce cache" : "Absente de ce cache",
        copies != null ? `Copies au total : ${copies}` : "",
      ].filter(Boolean);
    });
  } else {
    $("matrix-wrap").classList.add("hidden");
  }
}

function renderDupTable() {
  const rows = solve.dupliquees || [];
  const wrap = $("dup-table-wrap");
  const tbody = $("dup-table");
  if (!rows.length) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  tbody.innerHTML = rows.map((r) =>
    `<tr><td>${r.v}</td><td>${r.copies}</td><td>${fmt(r.taille)}</td></tr>`
  ).join("");
}

async function runAnalyse() {
  if (!currentId) return;
  const outId = $("out-select").value;
  if (!outId) return;
  $("btn-analyse").disabled = true;
  $("btn-analyse").textContent = "Analyse…";
  const res = await fetch(
    "/api/analyse/" + encodeURIComponent(currentId) + "/" + encodeURIComponent(outId)
  );
  solve = await res.json();
  $("btn-analyse").disabled = false;
  $("btn-analyse").textContent = "Analyser";
  if (solve.erreur) {
    $("out-hint").textContent = solve.erreur;
    $("solution-block").classList.add("hidden");
    return;
  }
  $("solution-block").classList.remove("hidden");
  $("sol-file").textContent = "Fichier : " + solve.fichier_out;
  const warns = solve.avertissements || [];
  const box = $("warn-box");
  if (warns.length) {
    box.classList.remove("hidden");
    box.textContent = warns.join(" · ");
  } else {
    box.classList.add("hidden");
    box.textContent = "";
  }
  $("score-cards").innerHTML = [
    card("Score", fmt(solve.score)),
    card("% du mieux possible*", pct(solve.part_plafond)),
    card("Remplissage moyen", solve.moyenne_occupation_pct + " %"),
    card("Caches remplis", `${solve.caches_utilises} / ${solve.C}`),
    card("Requetes servies cache", pct(solve.part_requetes_cachees)),
    card("ms / requete", String(solve.ms_par_requete)),
  ].join("");
  $("dup-cards").innerHTML = [
    card("Taux de duplication", pct(solve.taux_duplication)),
    card("Videos dupliquees", pct(solve.taux_videos_dupliquees)),
    card("Copies en trop", `${fmt(solve.copies_en_trop)} / ${fmt(solve.copies)}`),
    card("Mo dupliques", pct(solve.taux_mo_dupliques)),
    card("Copies inutiles", pct(solve.taux_copies_inutiles)),
    card("Copies / video", String(solve.copies_moyennes)),
  ].join("");
  $("dup-legend").textContent =
    "* Mieux possible = cache le plus proche, sans limite de Mo. " +
    "Duplication = meme video dans plusieurs caches. " +
    "Une copie est inutile si elle n'est jamais le cache le plus rapide. " +
    "Seul le cache le plus rapide compte pour le score.";
  renderSolveCharts();
  renderDupTable();
  buildCaches();
}

$("btn-analyse").onclick = runAnalyse;
$("out-select").onchange = () => {
  if ($("out-select").value) runAnalyse();
};

loadDatasets();
window.addEventListener("resize", () => {
  if (stats) renderStats();
  if (solve) {
    renderSolveCharts();
    buildCaches();
  }
});
