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

// v1 response.format names that don't carry over to v2 as-is.
const V1_FORMAT_TO_V2 = {
  csv2: { outputFormat: "csv", outputFormatParams: "SeparatorSemicolon" },
};

function buildOutputFormatParam(v1Query) {
  const format = v1Query.response && v1Query.response.format;
  if (!format || format === "json-stat2") return "";
  const mapped = V1_FORMAT_TO_V2[format];
  if (mapped) {
    const parts = [`outputFormat=${encodeURIComponent(mapped.outputFormat)}`];
    if (mapped.outputFormatParams) {
      parts.push(`outputFormatParams=${encodeURIComponent(mapped.outputFormatParams)}`);
    }
    return parts.join("&");
  }
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

function computeStringRanges(text) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const start = i;
      const end = skipMString(text, i);
      ranges.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return ranges;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finds `name = <expr>` at the top level of the M code (skipping occurrences
// inside string literals) and returns the raw, unparsed `<expr>` text up to
// the next top-level comma. Used to resolve `let`-bound variables referenced
// elsewhere (e.g. a Web.Contents argument that's just an identifier).
function findLetVariableDefinition(fullText, name) {
  const stringRanges = computeStringRanges(fullText);
  const re = new RegExp(`\\b${escapeRegExp(name)}\\s*=(?!=)`, "g");
  let m;
  while ((m = re.exec(fullText))) {
    const idx = m.index;
    if (stringRanges.some(([s, e]) => idx >= s && idx < e)) continue;

    let i = m.index + m[0].length;
    let depth = 0;
    while (i < fullText.length) {
      const c = fullText[i];
      if (c === '"') {
        i = skipMString(fullText, i);
        continue;
      }
      if (c === "(" || c === "[" || c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        depth--;
        i++;
        continue;
      }
      if (c === "," && depth === 0) break;
      i++;
    }
    return fullText.slice(m.index + m[0].length, i).trim();
  }
  return null;
}

// Splits the raw text of Web.Contents' arguments (or any comma-separated M
// argument list) on top-level commas, ignoring commas inside strings/brackets.
function splitTopLevelArgs(argsText) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < argsText.length) {
    const c = argsText[i];
    if (c === '"') {
      i = skipMString(argsText, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]" || c === "}") {
      depth--;
      i++;
      continue;
    }
    if (c === "," && depth === 0) {
      parts.push(argsText.slice(start, i));
      start = i + 1;
      i++;
      continue;
    }
    i++;
  }
  parts.push(argsText.slice(start));
  return parts.map((s) => s.trim());
}

// Evaluates a small subset of M expressions down to a plain string: a string
// literal, an identifier resolved against the surrounding `let` block, or any
// number of those joined with `&`. Covers real-world queries where the URL or
// JSON body isn't inlined but built from `let`-bound variables.
function evalMStringExpr(fullText, exprText, seen) {
  seen = seen || new Set();
  let i = 0;

  function skipWs() {
    while (i < exprText.length && /\s/.test(exprText[i])) i++;
  }

  function parseTerm() {
    skipWs();
    if (exprText[i] === '"') {
      i++; // consume opening quote
      let out = "";
      while (i < exprText.length) {
        if (exprText[i] === '"') {
          if (exprText[i + 1] === '"') {
            out += '"';
            i += 2;
            continue;
          }
          i++;
          return out;
        }
        out += exprText[i];
        i++;
      }
      throw new Error("Uavsluttet strengliteral i M-koden.");
    }
    const start = i;
    while (i < exprText.length && /[A-Za-z0-9_.]/.test(exprText[i])) i++;
    if (i === start) {
      throw new Error(`Klarte ikke å tolke uttrykket «${exprText.trim()}» i M-koden.`);
    }
    const name = exprText.slice(start, i);
    if (seen.has(name)) {
      throw new Error(`Fant en sirkulær referanse til variabelen «${name}» i M-koden.`);
    }
    const def = findLetVariableDefinition(fullText, name);
    if (def == null) {
      throw new Error(`Fant ikke variabelen «${name}» i M-koden.`);
    }
    const nextSeen = new Set(seen);
    nextSeen.add(name);
    return evalMStringExpr(fullText, def, nextSeen);
  }

  let value = parseTerm();
  skipWs();
  while (exprText[i] === "&") {
    i++;
    value += parseTerm();
    skipWs();
  }
  return value;
}

// Finds the first balanced {...} object in arbitrary text, respecting JSON
// string quoting (so braces inside string values don't end the scan early).
// Lets us pull the real JSON out of a variable whose value is wrapped in
// leftover template comment text (a common real-world Power Query pattern).
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let i = start;
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      i++;
      if (depth === 0) return text.slice(start, i);
      continue;
    }
    i++;
  }
  return null;
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

function parseWebContentsArgs(fullText, argsText) {
  const [urlExpr, optionsText] = splitTopLevelArgs(argsText);
  if (!urlExpr) throw new Error("Fant ikke nettadressen i Web.Contents(...)-kallet.");
  const url = evalMStringExpr(fullText, urlExpr);
  return { url, optionsText: optionsText || null };
}

function extractContentExpression(fullText, optionsText) {
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
    const [contentExpr] = splitTopLevelArgs(inner);
    const resolvedText = evalMStringExpr(fullText, contentExpr);
    const jsonText = extractJsonObject(resolvedText);
    if (!jsonText) {
      throw new Error("Fant ingen JSON-spørring i teksten Text.ToBinary(...) peker på.");
    }
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
  const { url, optionsText } = parseWebContentsArgs(text, call.argsText);
  if (!optionsText) {
    throw new Error(
      "Fant spørringen, men ikke selve dataene (Content) i den. Denne appen støtter foreløpig bare spørringer som sender data (POST)."
    );
  }
  const query = extractContentExpression(text, optionsText);
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
    findLetVariableDefinition,
    evalMStringExpr,
    extractJsonObject,
  };
}
