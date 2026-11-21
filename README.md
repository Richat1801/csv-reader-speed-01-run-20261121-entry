# csv-reader-speed-01-run-20261121-entry

A faster drop-in for make.fun's own csv-reader 1.0.0: `solve.js` answers every CSV case exactly as csv-reader does, but scans with native `indexOf` jumps and slices fields out instead of walking one character at a time.

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Richat1801/csv-reader-speed-01-run-20261121-entry/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Richat1801/csv-reader-speed-01-run-20261121-entry/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Competition: [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Referral code: `dss38k9p`

## How it works

`main.ts` reads every case from `/input/cases.json`, answers each one alone with `run()` from `solve.js`, and writes `/output/answers.json`.

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly csv-reader 1.0.0's answer `{columns, rows, errors}` for every input `{text, header}` — including its broken-row policy (BOM drop, stray CRs, quoted fields with doubled quotes and CR/LF inside, junk after a closing quote, unterminated quotes re-read as unquoted, short/long row padding and cutting, and the `{code, line, row}` error records).

Speed comes from two paths: a whole-record fast path that splits a quote-free, CR-free line with `indexOf(',')` alone, and a general field-by-field path that finds each unquoted field with `indexOf(',')` / `indexOf('\n')` and each quoted field's close with `indexOf('"')`, slicing values out of the text instead of building them character by character. Quoted spans are only walked character by character when they actually hold a CR or LF.

On the kit's practice set (6 cases, ~10 MB of CSV) this runs about 4× faster than the house baseline's `solve.js` (best of 3 warmed runs on this machine: ~253 ms vs ~1026 ms), with all 6 cases identical to the reference answers.
