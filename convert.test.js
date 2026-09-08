const test = require("node:test");
const assert = require("node:assert/strict");
const {
  convertV1DimensionToV2,
  buildV2Selection,
  buildV2PostBody,
  buildV2GetQueryString,
  buildOutputFormatParam,
  buildV2GetUrl,
  buildV2PostUrl,
  escapeMString,
  unescapeMString,
  parseMLiteral,
  assertPxWebJson,
  detectInputKind,
  extractV1QueryFromMCode,
  convertMCode,
  evalMStringExpr,
  findLetVariableDefinition,
  extractJsonObject,
  computeMissingMandatoryVariables,
  parseTableVariablesFromMetadata,
} = require("./convert.js");

test("filter 'item' passes values through unchanged", () => {
  const dim = { code: "Region", selection: { filter: "item", values: ["0301", "1103"] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Region",
    valueCodes: ["0301", "1103"],
  });
});

test("missing filter defaults to item behavior", () => {
  const dim = { code: "Region", selection: { values: ["0301"] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Region",
    valueCodes: ["0301"],
  });
});

test("filter 'all' becomes wildcard", () => {
  const dim = { code: "ContentsCode", selection: { filter: "all", values: [] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "ContentsCode",
    valueCodes: ["*"],
  });
});

test("filter 'top' becomes top(n) expression", () => {
  const dim = { code: "Tid", selection: { filter: "top", values: ["3"] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Tid",
    valueCodes: ["top(3)"],
  });
});

test("filter with vs: prefix maps to codelist v2_Fylker id, keeping the vs_ family prefix", () => {
  const dim = { code: "Region", selection: { filter: "vs:Fylker", values: ["03"] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Region",
    codelist: "vs_Fylker",
    valueCodes: ["03"],
  });
});

test("filter with agg_single: prefix maps to the agg_ codelist family (verified against SSB's real API)", () => {
  const dim = {
    code: "Region",
    selection: { filter: "agg_single:KommGjeldende", values: ["3101", "3103"] },
  };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Region",
    codelist: "agg_KommGjeldende",
    valueCodes: ["3101", "3103"],
  });
});

test("filter with agg_multi: prefix also maps to the agg_ codelist family", () => {
  const dim = { code: "Region", selection: { filter: "agg_multi:X", values: ["1"] } };
  assert.deepEqual(convertV1DimensionToV2(dim), {
    variableCode: "Region",
    codelist: "agg_X",
    valueCodes: ["1"],
  });
});

const sampleV1Query = {
  query: [
    { code: "Region", selection: { filter: "agg_single:KommGjeldende", values: ["3101", "3103"] } },
    { code: "ContentsCode", selection: { filter: "item", values: ["Personer"] } },
    { code: "Tid", selection: { filter: "item", values: ["2023", "2024"] } },
  ],
  response: { format: "json-stat2" },
};

test("buildV2Selection maps every dimension in order", () => {
  assert.deepEqual(buildV2Selection(sampleV1Query), [
    { variableCode: "Region", codelist: "agg_KommGjeldende", valueCodes: ["3101", "3103"] },
    { variableCode: "ContentsCode", valueCodes: ["Personer"] },
    { variableCode: "Tid", valueCodes: ["2023", "2024"] },
  ]);
});

test("buildV2PostBody wraps the selection array", () => {
  assert.deepEqual(buildV2PostBody(sampleV1Query), {
    selection: [
      { variableCode: "Region", codelist: "agg_KommGjeldende", valueCodes: ["3101", "3103"] },
      { variableCode: "ContentsCode", valueCodes: ["Personer"] },
      { variableCode: "Tid", valueCodes: ["2023", "2024"] },
    ],
  });
});

test("buildV2GetQueryString emits codelist[...] before valueCodes[...] for a dimension with a codelist", () => {
  const qs = buildV2GetQueryString(sampleV1Query);
  assert.equal(
    qs,
    "codelist[Region]=agg_KommGjeldende&valueCodes[Region]=3101,3103&valueCodes[ContentsCode]=Personer&valueCodes[Tid]=2023,2024"
  );
});

test("buildV2GetQueryString URL-encodes individual values but not the brackets", () => {
  const q = { query: [{ code: "Region", selection: { filter: "item", values: ["a b", "c&d"] } }] };
  assert.equal(buildV2GetQueryString(q), "valueCodes[Region]=a%20b,c%26d");
});

test("buildOutputFormatParam is empty for the default json-stat2 format", () => {
  assert.equal(buildOutputFormatParam(sampleV1Query), "");
});

test("buildOutputFormatParam returns outputFormat=X for a non-default format", () => {
  assert.equal(buildOutputFormatParam({ response: { format: "csv" } }), "outputFormat=csv");
});

test("buildOutputFormatParam is empty when response is missing", () => {
  assert.equal(buildOutputFormatParam({ query: [] }), "");
});

test("buildOutputFormatParam maps the v1 'csv2' format to v2 csv + SeparatorSemicolon", () => {
  assert.equal(
    buildOutputFormatParam({ response: { format: "csv2" } }),
    "outputFormat=csv&outputFormatParams=SeparatorSemicolon"
  );
});

test("buildV2GetUrl builds the full v2 GET URL with lang and valueCodes", () => {
  const url = buildV2GetUrl("https://data.ssb.no", "07459", "no", sampleV1Query);
  assert.equal(
    url,
    "https://data.ssb.no/api/pxwebapi/v2/tables/07459/data?lang=no&codelist[Region]=agg_KommGjeldende&valueCodes[Region]=3101,3103&valueCodes[ContentsCode]=Personer&valueCodes[Tid]=2023,2024"
  );
});

test("buildV2GetUrl appends outputFormat when the v1 response format isn't json-stat2", () => {
  const q = { query: [{ code: "Tid", selection: { filter: "item", values: ["2024"] } }], response: { format: "csv" } };
  const url = buildV2GetUrl("https://data.ssb.no", "07459", "no", q);
  assert.equal(
    url,
    "https://data.ssb.no/api/pxwebapi/v2/tables/07459/data?lang=no&outputFormat=csv&valueCodes[Tid]=2024"
  );
});

test("buildV2PostUrl builds only the base URL (no valueCodes) since selection lives in the body", () => {
  const url = buildV2PostUrl("https://data.ssb.no", "07459", "no", sampleV1Query);
  assert.equal(url, "https://data.ssb.no/api/pxwebapi/v2/tables/07459/data?lang=no");
});

test("buildV2Selection appends a wildcard selection for extra (missing mandatory) variable codes", () => {
  assert.deepEqual(buildV2Selection(sampleV1Query, ["Landbakgrunn"]), [
    { variableCode: "Region", codelist: "agg_KommGjeldende", valueCodes: ["3101", "3103"] },
    { variableCode: "ContentsCode", valueCodes: ["Personer"] },
    { variableCode: "Tid", valueCodes: ["2023", "2024"] },
    { variableCode: "Landbakgrunn", valueCodes: ["*"] },
  ]);
});

test("buildV2Selection does not duplicate a variable that's already in the v1 query", () => {
  assert.deepEqual(buildV2Selection(sampleV1Query, ["Region"]), buildV2Selection(sampleV1Query));
});

test("buildV2GetUrl includes wildcard valueCodes for extra variable codes", () => {
  const q = { query: [{ code: "Tid", selection: { filter: "item", values: ["2024"] } }] };
  const url = buildV2GetUrl("https://data.ssb.no", "09817", "no", q, ["Landbakgrunn"]);
  assert.equal(
    url,
    "https://data.ssb.no/api/pxwebapi/v2/tables/09817/data?lang=no&valueCodes[Tid]=2024&valueCodes[Landbakgrunn]=*"
  );
});

test("buildV2PostBody includes wildcard selection for extra variable codes", () => {
  const q = { query: [{ code: "Tid", selection: { filter: "item", values: ["2024"] } }] };
  assert.deepEqual(buildV2PostBody(q, ["Landbakgrunn"]), {
    selection: [
      { variableCode: "Tid", valueCodes: ["2024"] },
      { variableCode: "Landbakgrunn", valueCodes: ["*"] },
    ],
  });
});

test("parseTableVariablesFromMetadata reads variable ids and their elimination flag", () => {
  const metadata = {
    id: ["Region", "Landbakgrunn"],
    dimension: {
      Region: { extension: { elimination: true } },
      Landbakgrunn: { extension: { elimination: false } },
    },
  };
  assert.deepEqual(parseTableVariablesFromMetadata(metadata), [
    { id: "Region", elimination: true },
    { id: "Landbakgrunn", elimination: false },
  ]);
});

test("parseTableVariablesFromMetadata defaults elimination to true when the metadata shape is unclear", () => {
  const metadata = { id: ["Mystery"], dimension: { Mystery: {} } };
  assert.deepEqual(parseTableVariablesFromMetadata(metadata), [{ id: "Mystery", elimination: true }]);
});

test("computeMissingMandatoryVariables finds mandatory variables absent from the v1 query", () => {
  const tableVariables = [
    { id: "Region", elimination: true },
    { id: "Landbakgrunn", elimination: false },
    { id: "Tid", elimination: false },
  ];
  const q = { query: [{ code: "Region", selection: { filter: "item", values: ["0301"] } }] };
  assert.deepEqual(computeMissingMandatoryVariables(q, tableVariables), ["Landbakgrunn", "Tid"]);
});

test("computeMissingMandatoryVariables returns an empty array when nothing is missing", () => {
  const tableVariables = [{ id: "Region", elimination: false }];
  const q = { query: [{ code: "Region", selection: { filter: "item", values: ["0301"] } }] };
  assert.deepEqual(computeMissingMandatoryVariables(q, tableVariables), []);
});

test("unescapeMString turns doubled quotes into single quotes", () => {
  assert.equal(unescapeMString('{""query"":[]}'), '{"query":[]}');
});

test("escapeMString doubles quotes for embedding in an M string literal", () => {
  assert.equal(escapeMString('{"query":[]}'), '{""query"":[]}');
});

test("escapeMString and unescapeMString round-trip arbitrary JSON text", () => {
  const json = JSON.stringify({ selection: [{ variableCode: "Tid", valueCodes: ["*"] }] });
  assert.equal(unescapeMString(escapeMString(json)), json);
});

test("parseMLiteral parses a plain string literal", () => {
  assert.equal(parseMLiteral('"hello"'), "hello");
});

test("parseMLiteral unescapes doubled quotes inside a string", () => {
  assert.equal(parseMLiteral('"say ""hi"""'), 'say "hi"');
});

test("parseMLiteral parses a list of strings", () => {
  assert.deepEqual(parseMLiteral('{"3101","3103"}'), ["3101", "3103"]);
});

test("parseMLiteral parses an empty list", () => {
  assert.deepEqual(parseMLiteral("{}"), []);
});

test("parseMLiteral parses a record with a nested record and list", () => {
  const m = '[code="Region", selection=[filter="agg_single:KommGjeldende", values={"3101","3103"}]]';
  assert.deepEqual(parseMLiteral(m), {
    code: "Region",
    selection: { filter: "agg_single:KommGjeldende", values: ["3101", "3103"] },
  });
});

test("parseMLiteral parses a full v1-style query record with a list of records", () => {
  const m = `[
    query = {
      [code="Region", selection=[filter="item", values={"0301"}]],
      [code="Tid", selection=[filter="item", values={"2024"}]]
    },
    response = [format="json-stat2"]
  ]`;
  assert.deepEqual(parseMLiteral(m), {
    query: [
      { code: "Region", selection: { filter: "item", values: ["0301"] } },
      { code: "Tid", selection: { filter: "item", values: ["2024"] } },
    ],
    response: { format: "json-stat2" },
  });
});

test("assertPxWebJson accepts a valid v1 query object", () => {
  assert.doesNotThrow(() => assertPxWebJson(sampleV1Query));
});

test("assertPxWebJson rejects an object without a 'query' array", () => {
  assert.throws(() => assertPxWebJson({}), /query/i);
});

test("assertPxWebJson rejects a query item without a string 'code'", () => {
  assert.throws(() => assertPxWebJson({ query: [{ selection: { values: [] } }] }), /code/i);
});

test("detectInputKind recognizes M-code by the 'let' keyword", () => {
  assert.equal(detectInputKind('let\n  Source = Web.Contents("https://x")\nin\n  Source'), "mcode");
});

test("detectInputKind recognizes M-code by a bare Web.Contents call", () => {
  assert.equal(detectInputKind('Web.Contents("https://data.ssb.no/api/v0/no/table/07459")'), "mcode");
});

test("detectInputKind recognizes plain JSON", () => {
  assert.equal(detectInputKind('{ "query": [] }'), "json");
});

test("detectInputKind recognizes a URL", () => {
  assert.equal(detectInputKind("https://data.ssb.no/api/v0/no/table/07459"), "url");
});

test("detectInputKind recognizes a curl command", () => {
  assert.equal(detectInputKind("curl -X POST https://data.ssb.no/... -d '{}'"), "url");
});

test("detectInputKind returns 'empty' for blank input", () => {
  assert.equal(detectInputKind("   "), "empty");
});

const mCodeTextLiteral = `let
    Source = Json.Document(Web.Contents("https://data.ssb.no/api/v0/no/table/07459/", [Headers=[#"Content-Type"="application/json"], Content=Text.ToBinary("{""query"":[{""code"":""Region"",""selection"":{""filter"":""item"",""values"":[""0301""]}}],""response"":{""format"":""json-stat2""}}")]))
in
    Source`;

test("extractV1QueryFromMCode reads the URL and JSON from a Text.ToBinary content pattern", () => {
  const result = extractV1QueryFromMCode(mCodeTextLiteral);
  assert.equal(result.url, "https://data.ssb.no/api/v0/no/table/07459/");
  assert.deepEqual(result.query, {
    query: [{ code: "Region", selection: { filter: "item", values: ["0301"] } }],
    response: { format: "json-stat2" },
  });
});

const mCodeRecordLiteral = `let
    Source = Json.Document(Web.Contents("https://data.ssb.no/api/v0/no/table/07459/", [Headers=[#"Content-Type"="application/json"], Content=Json.FromValue([query={[code="Region", selection=[filter="item", values={"0301"}]]}, response=[format="json-stat2"]])]))
in
    Source`;

test("extractV1QueryFromMCode reads the URL and JSON from a Json.FromValue record pattern", () => {
  const result = extractV1QueryFromMCode(mCodeRecordLiteral);
  assert.equal(result.url, "https://data.ssb.no/api/v0/no/table/07459/");
  assert.deepEqual(result.query, {
    query: [{ code: "Region", selection: { filter: "item", values: ["0301"] } }],
    response: { format: "json-stat2" },
  });
});

test("extractV1QueryFromMCode throws a clear error when there is no Web.Contents call", () => {
  assert.throws(() => extractV1QueryFromMCode("let Source = 1 in Source"), /Web\.Contents/);
});

test("extractV1QueryFromMCode throws a clear error when Web.Contents has no Content option", () => {
  assert.throws(
    () => extractV1QueryFromMCode('Web.Contents("https://data.ssb.no/api/v0/no/table/07459")'),
    /Content/
  );
});

test("convertMCode (GET mode) replaces only the Web.Contents call, keeping the rest of the M code intact", () => {
  const result = convertMCode(mCodeTextLiteral, "GET", "https://data.ssb.no", "07459", "no");
  assert.equal(
    result,
    `let
    Source = Json.Document(Web.Contents("https://data.ssb.no/api/pxwebapi/v2/tables/07459/data?lang=no&valueCodes[Region]=0301"))
in
    Source`
  );
});

test("extractJsonObject finds the JSON object even with comment text wrapped around it", () => {
  const text = '\n\n//ERSTATT EKSEMPELKODEN//\n\n{"query":[],"response":{"format":"csv2"}}\n\n//SLUTT//\n';
  assert.equal(extractJsonObject(text), '{"query":[],"response":{"format":"csv2"}}');
});

test("extractJsonObject returns null when there is no JSON object", () => {
  assert.equal(extractJsonObject("no json here"), null);
});

test("findLetVariableDefinition finds a simple string assignment", () => {
  const m = 'let\n    tableId = "09817",\n    Kilde = 1\nin\n    Kilde';
  assert.equal(findLetVariableDefinition(m, "tableId"), '"09817"');
});

test("findLetVariableDefinition returns null for an undefined name", () => {
  const m = 'let\n    tableId = "09817"\nin\n    tableId';
  assert.equal(findLetVariableDefinition(m, "missingVar"), null);
});

test("findLetVariableDefinition captures a multi-line string literal up to the next top-level comma", () => {
  const m = 'let\n    PostContents ="\n{""a"":1}\n"\n,\nKilde = 1\nin\n    Kilde';
  assert.equal(findLetVariableDefinition(m, "PostContents"), '"\n{""a"":1}\n"');
});

test("evalMStringExpr resolves a plain string literal", () => {
  assert.equal(evalMStringExpr("let x = 1 in x", '"hello"'), "hello");
});

test("evalMStringExpr resolves an identifier by looking it up in the surrounding let-block", () => {
  const m = 'let\n    tableId = "09817"\nin\n    tableId';
  assert.equal(evalMStringExpr(m, "tableId"), "09817");
});

test("evalMStringExpr resolves a string concatenated with a variable (&)", () => {
  const m = 'let\n    tableId = "09817"\nin\n    tableId';
  assert.equal(
    evalMStringExpr(m, '"https://data.ssb.no/api/v0/no/table/" & tableId'),
    "https://data.ssb.no/api/v0/no/table/09817"
  );
});

// A trimmed-down version of the real-world SSB "Advanced Editor" template: the JSON
// body lives in its own `PostContents` variable (wrapped in template comment text),
// and the URL is built from a literal prefix concatenated with a `tableId` variable.
const realWorldTemplate = `let
tableId = "09817",
PostContents ="


//ERSTATT EKSEMPELKODEN NEDENFOR MED KODEN FRA SSB//

{
  ""query"": [
    {
      ""code"": ""Region"",
      ""selection"": {
        ""filter"": ""vs:Kommune"",
        ""values"": [
          ""3001"",
          ""3002""
        ]
      }
    },
    {
      ""code"": ""Tid"",
      ""selection"": {
        ""filter"": ""items"",
        ""values"": [
          ""2023"",""2022""
        ]
      }
    }
  ],
  ""response"": {
    ""format"": ""csv2""
  }
}


//ERSTATT EKSEMPELKODEN OVENFOR MED KODEN FRA SSB //

"

,
Kilde = Csv.Document(Web.Contents("https://data.ssb.no/api/v0/no/table/" & tableId, [Content=Text.ToBinary(PostContents)]),[Delimiter=",", Encoding=1252, QuoteStyle=QuoteStyle.None])
in
    Kilde`;

test("extractV1QueryFromMCode follows a Text.ToBinary(variable) reference and strips comment noise around the JSON", () => {
  const result = extractV1QueryFromMCode(realWorldTemplate);
  assert.equal(result.url, "https://data.ssb.no/api/v0/no/table/09817");
  assert.deepEqual(result.query, {
    query: [
      { code: "Region", selection: { filter: "vs:Kommune", values: ["3001", "3002"] } },
      { code: "Tid", selection: { filter: "items", values: ["2023", "2022"] } },
    ],
    response: { format: "csv2" },
  });
});

test("convertMCode handles the real-world template end to end (GET mode)", () => {
  const result = convertMCode(realWorldTemplate, "GET", "https://data.ssb.no", "09817", "no");
  assert.match(
    result,
    /Kilde = Csv\.Document\(Web\.Contents\("https:\/\/data\.ssb\.no\/api\/pxwebapi\/v2\/tables\/09817\/data\?lang=no&outputFormat=csv&outputFormatParams=SeparatorSemicolon&codelist\[Region\]=vs_Kommune&valueCodes\[Region\]=3001,3002&valueCodes\[Tid\]=2023,2022"\)/
  );
  assert.match(result, /^let\ntableId = "09817",\nPostContents ="/);
  assert.match(result, /in\n {4}Kilde$/);
});

test("convertMCode (POST mode) rebuilds a Text.ToBinary content call with the v2 body", () => {
  const result = convertMCode(mCodeTextLiteral, "POST", "https://data.ssb.no", "07459", "no");
  assert.match(result, /Web\.Contents\("https:\/\/data\.ssb\.no\/api\/pxwebapi\/v2\/tables\/07459\/data\?lang=no", \[Headers=\[#"Content-Type"="application\/json"\], Content=Text\.ToBinary\("/);
  assert.match(result, /^let\n {4}Source = Json\.Document\(/);
  assert.match(result, /\)\)\nin\n {4}Source$/);
});
