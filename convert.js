// PXWeb v1 -> v2 conversion core (pure functions, no DOM).
// Loaded both as a plain <script> in the browser and via require() in Node tests.

function convertV1DimensionToV2(dim) {
  const code = dim.code;
  const selection = dim.selection || {};
  const filter = selection.filter || "item";
  const values = selection.values || [];

  if (filter === "all") {
    return { variableCode: code, valueCodes: ["*"] };
  }

  if (filter === "top") {
    const n = values[0] != null ? values[0] : "1";
    return { variableCode: code, valueCodes: [`top(${n})`] };
  }

  const colonIdx = filter.indexOf(":");
  if (colonIdx !== -1) {
    const codelist = filter.slice(colonIdx + 1);
    return { variableCode: code, codelist, valueCodes: values };
  }

  return { variableCode: code, valueCodes: values };
}

function buildV2Selection(v1Query) {
  return v1Query.query.map(convertV1DimensionToV2);
}

function buildV2PostBody(v1Query) {
  return { selection: buildV2Selection(v1Query) };
}

function buildV2GetQueryString(v1Query) {
  const parts = [];
  for (const dim of buildV2Selection(v1Query)) {
    if (dim.codelist) {
      parts.push(`codelist[${dim.variableCode}]=${encodeURIComponent(dim.codelist)}`);
    }
    const joined = dim.valueCodes.map((v) => encodeURIComponent(String(v))).join(",");
    parts.push(`valueCodes[${dim.variableCode}]=${joined}`);
  }
  return parts.join("&");
}

function buildOutputFormatParam(v1Query) {
  const format = v1Query.response && v1Query.response.format;
  if (!format || format === "json-stat2") return "";
  return `outputFormat=${encodeURIComponent(format)}`;
}

function buildV2BaseUrl(host, tableId, lang) {
  return `${host}/api/pxwebapi/v2/tables/${tableId}/data?lang=${encodeURIComponent(lang)}`;
}

function buildV2GetUrl(host, tableId, lang, v1Query) {
  const base = buildV2BaseUrl(host, tableId, lang);
  const outputFormat = buildOutputFormatParam(v1Query);
  const valueCodes = buildV2GetQueryString(v1Query);
  const extra = [outputFormat, valueCodes].filter(Boolean).join("&");
  return extra ? `${base}&${extra}` : base;
}

function buildV2PostUrl(host, tableId, lang, v1Query) {
  const base = buildV2BaseUrl(host, tableId, lang);
  const outputFormat = buildOutputFormatParam(v1Query);
  return outputFormat ? `${base}&${outputFormat}` : base;
}

function unescapeMString(text) {
  return text.replace(/""/g, '"');
}

function escapeMString(text) {
  return text.replace(/"/g, '""');
}

// Minimal parser for the subset of Power Query M literal syntax used to embed
// PXWeb query records: records `[k=v, ...]`, lists `{a, b, ...}`, strings
// (M escapes `"` as `""`), and bare word/number tokens.
function parseMLiteral(text) {
  let i = 0;

  function skipWs() {
    while (i < text.length && /\s/.test(text[i])) i++;
  }

  function parseValue() {
    skipWs();
    const c = text[i];
    if (c === "[") return parseRecord();
    if (c === "{") return parseList();
    if (c === '"') return parseString();
    return parseBareToken();
  }

  function parseRecord() {
    i++; // consume [
    const obj = {};
    skipWs();
    if (text[i] === "]") {
      i++;
      return obj;
    }
    while (true) {
      skipWs();
      const key = parseIdent();
      skipWs();
      if (text[i] !== "=") {
        throw new Error(`Forventet '=' etter feltnavn '${key}' (posisjon ${i})`);
      }
      i++; // consume =
      obj[key] = parseValue();
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        break;
      }
      throw new Error(`Forventet ',' eller ']' i M-record (posisjon ${i})`);
    }
    return obj;
  }

  function parseList() {
    i++; // consume {
    const arr = [];
    skipWs();
    if (text[i] === "}") {
      i++;
      return arr;
    }
    while (true) {
      arr.push(parseValue());
      skipWs();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        break;
      }
      throw new Error(`Forventet ',' eller '}' i M-liste (posisjon ${i})`);
    }
    return arr;
  }

  function parseString() {
    i++; // consume opening quote
    let out = "";
    while (i < text.length) {
      if (text[i] === '"') {
        if (text[i + 1] === '"') {
          out += '"';
          i += 2;
          continue;
        }
        i++; // consume closing quote
        return out;
      }
      out += text[i];
      i++;
    }
    throw new Error("Uavsluttet strengliteral i M-koden");
  }

  function parseIdent() {
    skipWs();
    if (text[i] === "#") {
      i++;
      return parseString();
    }
    const start = i;
    while (i < text.length && /[A-Za-z0-9_.]/.test(text[i])) i++;
    if (i === start) throw new Error(`Forventet et identifikatornavn (posisjon ${i})`);
    return text.slice(start, i);
  }

  function parseBareToken() {
    const start = i;
    while (i < text.length && /[A-Za-z0-9_.\-]/.test(text[i])) i++;
    const tok = text.slice(start, i);
    if (tok === "") throw new Error(`Uventet tegn '${text[i]}' (posisjon ${i})`);
    if (tok === "true") return true;
    if (tok === "false") return false;
    if (tok === "null") return null;
    if (tok !== "" && !isNaN(Number(tok))) return Number(tok);
    return tok;
  }

  const result = parseValue();
  skipWs();
  return result;
}

function assertPxWebJson(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.query)) {
    throw new Error("Fant ikke en gyldig spørring (mangler feltet «query»).");
  }
  for (const q of obj.query) {
    if (!q || typeof q.code !== "string" || !q.selection || !Array.isArray(q.selection.values)) {
      throw new Error("En av radene i spørringen mangler variabelnavn («code») eller valgte verdier.");
    }
  }
}

function detectInputKind(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return "empty";
  if (/^let\b/i.test(trimmed) || /Web\.Contents\s*\(/.test(trimmed)) return "mcode";
  if (/^https?:\/\//i.test(trimmed) || /^curl\b/i.test(trimmed)) return "url";
  if (trimmed.startsWith("{")) return "json";
  return "unknown";
}

// --- Power BI M-code (Web.Contents) extraction & rebuild ---

function skipMString(text, i) {
  i++; // consume opening quote
  while (i < text.length) {
    if (text[i] === '"') {
      if (text[i + 1] === '"') {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  throw new Error("Uavsluttet strengliteral i M-koden");
}

function findMatchingBracket(text, openIndex, openChar, closeChar) {
  let depth = 0;
  let i = openIndex;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i = skipMString(text, i);
      continue;
    }
    if (c === openChar) {
      depth++;
      i++;
      continue;
    }
    if (c === closeChar) {
      depth--;
      i++;
      if (depth === 0) return i - 1;
      continue;
    }
    i++;
  }
  throw new Error(`Fant ikke avsluttende '${closeChar}' i M-koden`);
}

function extractWebContentsCall(text) {
  const m = /Web\.Contents\s*\(/.exec(text);
  if (!m) return null;
  const openParen = m.index + m[0].length - 1;
  const closeParen = findMatchingBracket(text, openParen, "(", ")");
  return {
    callStart: m.index,
    callEnd: closeParen + 1,
    argsText: text.slice(openParen + 1, closeParen),
  };
}

function parseWebContentsArgs(argsText) {
  const urlMatch = /^\s*"((?:[^"]|"")*)"/.exec(argsText);
  if (!urlMatch) throw new Error("Fant ikke nettadressen i Web.Contents(...)-kallet.");
  const url = unescapeMString(urlMatch[1]);
  let rest = argsText.slice(urlMatch.index + urlMatch[0].length);
  rest = rest.replace(/^\s*,\s*/, "");
  if (!rest.trim()) return { url, optionsText: null };
  return { url, optionsText: rest };
}

function extractContentExpression(optionsText) {
  const contentMatch = /Content\s*=\s*/.exec(optionsText);
  if (!contentMatch) {
    throw new Error("Fant spørringen, men ikke noe «Content»-felt (selve dataene) i den.");
  }
  const exprStart = contentMatch.index + contentMatch[0].length;
  const remainder = optionsText.slice(exprStart);

  if (/^Text\.ToBinary\s*\(/.test(remainder)) {
    const parenRel = optionsText.indexOf("(", exprStart);
    const closeParen = findMatchingBracket(optionsText, parenRel, "(", ")");
    const inner = optionsText.slice(parenRel + 1, closeParen).trim();
    const strMatch = /^"((?:[^"]|"")*)"$/.exec(inner);
    if (!strMatch) throw new Error("Klarte ikke å lese teksten inni Text.ToBinary(...) i spørringen.");
    const jsonText = unescapeMString(strMatch[1]);
    let query;
    try {
      query = JSON.parse(jsonText);
    } catch (e) {
      throw new Error("Det appen fant inni spørringen er ikke gyldig JSON.");
    }
    return query;
  }

  if (/^Json\.FromValue\s*\(/.test(remainder)) {
    const parenRel = optionsText.indexOf("(", exprStart);
    const closeParen = findMatchingBracket(optionsText, parenRel, "(", ")");
    const inner = optionsText.slice(parenRel + 1, closeParen).trim();
    return parseMLiteral(inner);
  }

  throw new Error(
    "Kjenner ikke igjen denne typen spørring i M-koden (forventet Text.ToBinary(...) eller Json.FromValue(...))."
  );
}

function extractV1QueryFromMCode(text) {
  const call = extractWebContentsCall(text);
  if (!call) throw new Error("Fant ingen Power BI-spørring (Web.Contents) å oppdatere i det du limte inn.");
  const { url, optionsText } = parseWebContentsArgs(call.argsText);
  if (!optionsText) {
    throw new Error(
      "Fant spørringen, men ikke selve dataene (Content) i den. Denne appen støtter foreløpig bare spørringer som sender data (POST)."
    );
  }
  const query = extractContentExpression(optionsText);
  return { url, query, callStart: call.callStart, callEnd: call.callEnd };
}

function buildMWebContentsCall(mode, host, tableId, lang, v1Query) {
  if (mode === "GET") {
    const url = buildV2GetUrl(host, tableId, lang, v1Query);
    return `Web.Contents("${escapeMString(url)}")`;
  }
  const url = buildV2PostUrl(host, tableId, lang, v1Query);
  const body = JSON.stringify(buildV2PostBody(v1Query));
  return `Web.Contents("${escapeMString(url)}", [Headers=[#"Content-Type"="application/json"], Content=Text.ToBinary("${escapeMString(body)}")])`;
}

function convertMCode(text, mode, host, tableId, lang) {
  const extracted = extractV1QueryFromMCode(text);
  assertPxWebJson(extracted.query);
  const newCall = buildMWebContentsCall(mode, host, tableId, lang, extracted.query);
  return text.slice(0, extracted.callStart) + newCall + text.slice(extracted.callEnd);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    convertV1DimensionToV2,
    buildV2Selection,
    buildV2PostBody,
    buildV2GetQueryString,
    buildOutputFormatParam,
    buildV2BaseUrl,
    buildV2GetUrl,
    buildV2PostUrl,
    unescapeMString,
    escapeMString,
    parseMLiteral,
    assertPxWebJson,
    detectInputKind,
    extractV1QueryFromMCode,
    buildMWebContentsCall,
    convertMCode,
  };
}
