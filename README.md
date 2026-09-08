# PXWeb v1 → v2

Statisk app for å migrere gamle SSB PXWeb **v1** spørringer til det nye **v2**-APIet, som enten
**GET**-URL eller **POST**-body — med samme variabelvalg og oppsett som originalen.

Tar imot tre typer input, autodetektert:
1. **v1 POST-JSON** — den rå spørrings-JSON-en (`{ "query": [...] }`).
2. **Power BI M-kode** — hele `let ... Web.Contents(...) ... in ...`-spørringen fra en rapport.
   Kun selve `Web.Contents(...)`-kallet byttes ut; resten av M-koden (variabler, senere steg) er uendret.
3. **v1-URL eller cURL** — kun til autofyll av domene/tabell/språk (bærer ikke selve variabelvalgene).

## Eksakt v2-format
```
GET:  https://<domene>/api/pxwebapi/v2/tables/<TABLE>/data?lang=<LANG>&valueCodes[Dim]=v1,v2,...
POST: https://<domene>/api/pxwebapi/v2/tables/<TABLE>/data?lang=<LANG>
      body: { "selection": [ { "variableCode": "Dim", "valueCodes": ["v1","v2"] } ] }
```

## Bruk
1. (Valgfritt) Lim inn en **v1-URL eller cURL** øverst og klikk **Autofyll** — eller la appen
   plukke domene/tabell/språk automatisk fra M-koden/JSON-en du limer inn under.
2. Lim inn **v1 POST-JSON** eller **hele Power BI M-koden** i hovedfeltet.
3. Velg **GET** eller **POST**.
4. Klikk **Konverter** → kopier resultatet (URL, JSON-body, eller oppdatert M-kode).

### Hva oppdages fra URL/cURL/M-kode?
- **Domene** (kun protokoll + hostname + ev. port)
- **Språk** (`?lang=` eller et språksegment i path, f.eks. `/no/`, `/en/`)
- **Tabell-ID**: finner `tables/<id>`/`table/<id>` eller nærmeste token som ligner en tabell-id
  (`07459`, `09429`, osv.). Faller tilbake til query-parametere `table`, `tableId` eller `id`.

### Hva garanteres i konvertering?
- Base-URL bygges **alltid** som v2: `.../api/pxwebapi/v2/tables/<TABLE>/data?lang=<LANG>`
- Rekkefølgen fra `query[]` bevares. Braketter i parameternavn encodes ikke; verdier encodes individuelt.
- `selection.filter`-mapping: `"item"`/mangler → verdiene som de er, `"all"` → `*` (wildcard),
  `"top"` → `top(n)`, alt med et kolon (`"agg_single:X"`, `"vs:X"`, osv.) → `codelist=X` + verdiene.
- `response.format` (hvis satt og ikke `json-stat2`) legges til som `outputFormat=...`.
- **Power BI M-kode**: gjenkjenner `Content=Text.ToBinary("...")` (JSON som tekstlitteral) og
  `Content=Json.FromValue([...])` (JSON som M-record). Uvanlige mønstre gir en tydelig feilmelding
  i stedet for et feil resultat.

## Utvikling
Kjernelogikken (all parsing/konvertering) ligger i `convert.js` som rene, testbare funksjoner —
UI-koblingen i `main.js` kaller bare disse. Ingen build-steg eller avhengigheter.

Kjør testene (Node 18+, ingen `npm install` nødvendig):
```
node --test convert.test.js
```

## Hosting
Helt statisk – kan hostes på GitHub Pages eller DreamHost.

## Lisens
MIT
