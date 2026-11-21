// A fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly
// csv-reader's answer {columns, rows, errors} for every input {text, header}.
//
// Written from the published behaviour of csv-reader 1.0.0 (see the kit's
// RULES.txt): a U+FEFF at the very start is dropped; a record ends at LF or
// CRLF; a line left with no characters is no record; outside quotes a CR not
// followed by LF is dropped (error stray_cr); a field opening with a quote runs
// to the next non-doubled quote ("" inside is one quote; CRLF or a lone CR
// inside is read as LF); what follows the closing quote up to the next comma
// or line break is appended as it stands (quote_junk when the field ends, only
// if anything was appended); a quote that never closes is a literal character
// and the text after it is re-read as unquoted (unterminated_quote); a quote
// inside an unquoted field is literal; fields stay strings; columns is the
// first record when header is true, else null; rows are the records after it
// (every record when header is false), each padded with "" (short_row, with
// fields: its count) or cut (long_row, with extra: the cut fields) to the
// first record's width; each error is {code, line, row} in the order met —
// line is the 1-based line the record starts on (counting every LF, CRLF and
// lone CR inside quotes), row is the record's index in rows (null for the
// header); a record's short_row/long_row error is pushed when the record ends;
// a line holding only stray CRs is left with no characters: no record (its
// stray_cr errors stay).
//
// Speed: the reference walks one character at a time and builds every field
// by concatenation. This scanner instead jumps with native indexOf searches
// and slices fields out of the text (V8 slices share the parent string, so
// this stays cheap; indexOf returns a plain number, so no result object is
// allocated per field the way a regex match would). Two paths:
//   - a whole-record fast path: when the line up to the next LF holds no
//     quote and no CR other than a trailing CRLF one, the record is split by
//     indexOf(',') alone;
//   - a general field-by-field path for records holding quotes or stray CRs:
//     an unquoted field is found with indexOf(',') and indexOf('\n') (the
//     nearer ends it) and its slice is checked once for CRs; a quoted field
//     jumps to its closing quote with indexOf('"') and only builds a value
//     character by character when the quoted span actually holds a CR or LF
//     (for the LF conversion and line counting); doubled quotes collapse with
//     a native replaceAll.
//
// No clock, no randomness, no caching across cases, no network: pure, and
// every case is answered alone from its own input.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos onto `value` up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field and how it ended; `added` counts the characters kept after value.
  function readUnquoted(value) {
    let added = 0;
    const ci = text.indexOf(',', pos);
    const ni = text.indexOf('\n', pos);
    let end;
    let ended;
    if (ci !== -1 && (ni === -1 || ci < ni)) {
      end = ci;
      ended = COMMA;
    } else if (ni !== -1) {
      end = ni;
      ended = LINE_BREAK;
    } else {
      end = len;
      ended = END;
    }
    const seg = text.slice(pos, end);
    const ri = seg.indexOf('\r');
    if (ri === -1) {
      value += seg;
      added += seg.length;
      pos = ended === END ? len : end + 1;
      if (ended === LINE_BREAK) line += 1;
      return { value, ended, added };
    }
    // The segment holds CRs: each is dropped (stray_cr), except a trailing
    // one that is half of the CRLF ending this field.
    let out = value;
    let s0 = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) !== 13) continue;
      if (!(i === seg.length - 1 && ended === LINE_BREAK)) error('stray_cr');
      out += seg.slice(s0, i);
      added += i - s0;
      s0 = i + 1;
    }
    out += seg.slice(s0);
    added += seg.length - s0;
    pos = ended === END ? len : end + 1;
    if (ended === LINE_BREAK) line += 1;
    return { value: out, ended, added };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // Find the closing quote: the first '"' not doubled by the next char.
    let scan = pos + 1;
    let close = -1;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) break;
      if (text.charCodeAt(q + 1) === 34) {
        scan = q + 2;
        continue;
      }
      close = q;
      break;
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    // The quoted span, [open + 1, close): every '"' in it is one half of a
    // doubled pair, so a plain slice is exact unless it holds a CR or LF.
    const seg = text.slice(open + 1, close);
    let value;
    if (seg.indexOf('\r') === -1 && seg.indexOf('\n') === -1) {
      value = seg.indexOf('""') === -1 ? seg : seg.replaceAll('""', '"');
    } else {
      // Slow span: CRs and LFs inside quotes each become one LF, and each
      // counts one line; doubled quotes collapse to one quote.
      let out = '';
      let i = 0;
      const n = seg.length;
      while (i < n) {
        const ch = seg.charCodeAt(i);
        if (ch === 34) {
          out += '"';
          i += 2;
        } else if (ch === 13) {
          out += '\n';
          line += 1;
          i += seg.charCodeAt(i + 1) === 10 ? 2 : 1;
        } else {
          if (ch === 10) line += 1;
          out += seg[i];
          i += 1;
        }
      }
      value = out;
    }
    pos = close + 1;
    if (pos >= len) return { value, ended: END };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === '\r' && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text[pos] === '\n') {
        pos += 1;
        line += 1;
      } else if (text[pos] === '\r' && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Whole-record fast path: the line up to the next LF holds no quote and
    // no CR other than a trailing CRLF one, so the record is just its
    // comma-separated fields.
    let fields;
    let quoted = false;
    const lineEnd = text.indexOf('\n', pos);
    const segEnd = lineEnd === -1 ? len : lineEnd;
    const lineStr = text.slice(pos, segEnd);
    if (lineStr.indexOf('"') === -1) {
      const crAt = lineStr.indexOf('\r');
      const crOk =
        crAt === -1 ||
        (lineEnd !== -1 && crAt === lineStr.length - 1 && lineStr.indexOf('\r', crAt + 1) === -1);
      if (crOk) {
        let effEnd = lineStr.length;
        if (lineEnd !== -1 && lineStr.charCodeAt(effEnd - 1) === 13) effEnd -= 1;
        fields = [];
        let s = 0;
        for (;;) {
          const c = lineStr.indexOf(',', s);
          if (c === -1 || c >= effEnd) {
            fields.push(lineStr.slice(s, effEnd));
            break;
          }
          fields.push(lineStr.slice(s, c));
          s = c + 1;
        }
        pos = lineEnd === -1 ? len : lineEnd + 1;
        if (lineEnd !== -1) line += 1;
      }
    }
    if (fields === undefined) {
      // General path: the record holds a quote or a stray CR.
      fields = [];
      let field;
      do {
        quoted = text[pos] === '"';
        field = quoted ? readQuoted() : readUnquoted('');
        fields.push(field.value);
      } while (field.ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
