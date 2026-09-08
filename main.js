// UI wiring. Pure conversion logic lives in convert.js (loaded before this file).

// --- Autofill from v1 URL or cURL ---
const KNOWN_LANGS = new Set(["no", "nb", "nn", "en", "se", "fi", "sv", "da"]);
const TABLE_TOKEN_RE = /^(?:\d{4,7}[a-zA-Z]?|[A-Za-z0-9]{4,12})(?:\.px)?$/;

function parseCurlForUrl(text) {
  const m = text.match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}

function detectFromUrl(urlStr) {
  const res = { domain: "", tableId: "", lang: "" };
  if (!urlStr) return res;
  let u;
  try {
    u = new URL(/^https?:\/\//i.test(urlStr) ? urlStr : "https://" + urlStr);
  } catch {
    return res;
  }
  res.domain = `${u.protocol}//${u.hostname}${u.port ? ":" + u.port : ""}`;

  if (u.searchParams.has("lang")) {
    const l = u.searchParams.get("lang");
    if (l) res.lang = l.toLowerCase();
  }

  const parts = u.pathname.split("/").filter(Boolean);
  for (const p of parts) {
    const t = p.toLowerCase();
    if (KNOWN_LANGS.has(t)) {
      res.lang = t;
      break;
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].toLowerCase();
    if (p === "tables" || p === "table") {
      const cand = parts[i + 1] || "";
      const tid = cand.replace(/\.px$/i, "");
      if (TABLE_TOKEN_RE.test(tid)) {
        res.tableId = tid;
        break;
      }
    }
  }
  if (!res.tableId) {
    for (const token of parts.slice().reverse()) {
      const tid = token.replace(/\.px$/i, "");
      if (TABLE_TOKEN_RE.test(tid)) {
        res.tableId = tid;
        break;
      }
    }
  }
  if (!res.tableId) {
    for (const k of ["table", "tableId", "id"]) {
      const v = u.searchParams.get(k);
      if (v && TABLE_TOKEN_RE.test(v)) {
        res.tableId = v;
        break;
      }
    }
  }

  if (!res.lang) res.lang = "no";
  return res;
}

function applyAutofill(det, hostEl, tableEl, langEl) {
  if (det.domain) hostEl.value = det.domain;
  if (det.tableId) tableEl.value = det.tableId;
  if (det.lang) langEl.value = det.lang;
}

document.getElementById("autofillBtn").addEventListener("click", () => {
  const inputEl = document.getElementById("v0Input");
  const msgEl = document.getElementById("autofillMsg");
  const hostEl = document.getElementById("host");
  const tableEl = document.getElementById("tableId");
  const langEl = document.getElementById("lang");

  let source = (inputEl.value || "").trim();
  if (!source) {
    msgEl.textContent = "Lim inn en nettadresse eller cURL-kommando først.";
    return;
  }

  if (/^\s*curl\b/i.test(source)) {
    const url = parseCurlForUrl(source);
    if (!url) {
      msgEl.textContent = "Fant ingen nettadresse i det du limte inn.";
      return;
    }
    source = url;
  }

  const det = detectFromUrl(source);
  applyAutofill(det, hostEl, tableEl, langEl);

  const parts = [];
  parts.push(`Domene: ${det.domain || "(ukjent)"}`);
  parts.push(`Tabell-ID: ${det.tableId || "(ukjent)"}`);
  parts.push(`Språk: ${det.lang || "(ukjent)"}`);
  msgEl.textContent = parts.join(" • ");
});

document.getElementById("clearUrlBtn").addEventListener("click", () => {
  document.getElementById("v0Input").value = "";
  document.getElementById("autofillMsg").textContent = "";
});

// --- Main conversion ---

function tryParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getOutputMode() {
  const checked = document.querySelector('input[name="outputMode"]:checked');
  return checked ? checked.value : "GET";
}

function setOutputAsUrl(url) {
  const outEl = document.getElementById("output");
  const openBtn = document.getElementById("openBtn");
  outEl.value = url;
  openBtn.href = url;
  openBtn.hidden = false;
}

function setOutputAsText(text) {
  const outEl = document.getElementById("output");
  const openBtn = document.getElementById("openBtn");
  outEl.value = text;
  openBtn.href = "#";
  openBtn.hidden = true;
}

document.getElementById("btn").addEventListener("click", () => {
  const hostEl = document.getElementById("host");
  const tableEl = document.getElementById("tableId");
  const langEl = document.getElementById("lang");
  const bodyEl = document.getElementById("postBody");
  const basePreview = document.getElementById("basePreview");
  const mode = getOutputMode();
  const text = bodyEl.value;
  const kind = detectInputKind(text);

  try {
    if (kind === "empty") {
      throw new Error("Lim inn spørringen din i boksen over først.");
    }

    if (kind === "url") {
      const source = /^\s*curl\b/i.test(text) ? parseCurlForUrl(text) : text.trim();
      if (!source) throw new Error("Fant ingen nettadresse i det du limte inn.");
      const det = detectFromUrl(source);
      applyAutofill(det, hostEl, tableEl, langEl);
      basePreview.textContent = "";
      setOutputAsText(
        "Dette var bare en nettadresse, ikke selve spørringen. Domene/tabell/språk under «Avansert» er fylt ut — lim nå inn hele Power BI-spørringen (eller JSON-spørringen) i boksen for å fullføre."
      );
      return;
    }

    if (kind === "unknown") {
      throw new Error(
        "Kjenner ikke igjen dette som en spørring. Prøv å lime inn hele M-koden fra Power BI, eller bare JSON-delen av den gamle spørringen."
      );
    }

    if (kind === "mcode") {
      const extracted = extractV1QueryFromMCode(text);
      assertPxWebJson(extracted.query);

      const det = detectFromUrl(extracted.url);
      if (det.domain) hostEl.value = det.domain;
      if (det.tableId) tableEl.value = det.tableId;
      if (det.lang) langEl.value = det.lang;

      const newCall = buildMWebContentsCall(mode, hostEl.value, tableEl.value, langEl.value, extracted.query);
      const result = text.slice(0, extracted.callStart) + newCall + text.slice(extracted.callEnd);

      basePreview.textContent = `Fant spørringen mot: ${extracted.url}`;
      setOutputAsText(result);
      return;
    }

    // kind === "json"
    const px = tryParseJSON(text);
    if (!px) throw new Error("Dette ser ikke ut som gyldig JSON. Sjekk at du har limt inn hele spørringen.");
    assertPxWebJson(px);

    if (mode === "GET") {
      const url = buildV2GetUrl(hostEl.value, tableEl.value, langEl.value, px);
      basePreview.textContent = `Ny nettadresse: ${buildV2BaseUrl(hostEl.value, tableEl.value, langEl.value)}`;
      setOutputAsUrl(url);
    } else {
      const url = buildV2PostUrl(hostEl.value, tableEl.value, langEl.value, px);
      const body = buildV2PostBody(px);
      basePreview.textContent = `Sender til: ${url}`;
      setOutputAsText(`POST ${url}\n\n${JSON.stringify(body, null, 2)}`);
    }
  } catch (e) {
    basePreview.textContent = "";
    setOutputAsText(`Feil: ${e.message}`);
  }
});

document.getElementById("copyBtn").addEventListener("click", async () => {
  const val = document.getElementById("output").value;
  if (!val) return;
  try {
    await navigator.clipboard.writeText(val);
    alert("Kopiert!");
  } catch (e) {
    const el = document.getElementById("output");
    el.focus();
    el.select();
    alert("Kopier manuelt (Ctrl/Cmd + C).");
  }
});

document.getElementById("clearBtn").addEventListener("click", () => {
  document.getElementById("postBody").value = "";
  document.getElementById("output").value = "";
  document.getElementById("basePreview").textContent = "";
});
