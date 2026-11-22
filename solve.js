// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for an input {text, header}, but reads the text with
// slices and indexOf jumps instead of one character at a time.
//
// The policy is csv-reader's own, restated from the competition rules:
// - a U+FEFF at the very start of the text is dropped;
// - a record ends at LF or CRLF, and a line left with no characters is no
//   record;
// - outside a quoted field a CR not followed by LF is dropped (stray_cr);
// - a field that opens with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote, and each CRLF or lone CR inside it
//   reads as LF; what follows its closing quote, up to the next comma or
//   line break, is appended as it stands (quote_junk, when the field ends);
// - a quote that never closes is a literal character, and the text after it
//   is read again as unquoted (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - fields stay strings, never trimmed or converted;
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with "" (short_row, with fields: its field count) or cut (long_row,
//   with extra: the cut fields) to the first record's width;
// - each error is {code, line, row}, in the order met; line is the 1-based
//   line its record starts on, counting every LF, CRLF and lone CR inside
//   quotes, and row is its record's index in rows, null for the header;
//   a record's short_row or long_row is recorded when the record ends.
//
// Speed notes: a record on one clean line — no quote, no stray CR — is one
// slice split on commas; other records are read field by field, unquoted
// fields found with one tight charCodeAt scan and cut out with a single
// slice, quoted fields jumping to the closing quote with indexOf and
// converting "" and CRs with the engine's own replaceAll; the slow walks
// run only on the rare broken rows. No object is built per field: how a
// field ended is a small integer, and the only arrays grown are the
// answer's own.

const COMMA = 0; // the field ended at a comma: the record goes on
const BREAK = 1; // the field ended at a line break: the record ends
const END = 2; // the field ended at the end of the text: the record ends

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  while (true) {
    // Lines with no characters are no records: skip LF and CRLF line breaks.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    let fields = null;
    let ended = END;
    let lastQuoted = false;

    // Fast path: a record on one clean line — no quote, no stray CR — is
    // one slice split on commas. The line end is the next LF (or the end
    // of the text); a CR right before a LF is the CRLF half, stripped.
    // A quote anywhere before the line end, or a CR in the slice, sends
    // the record to the field-by-field path below.
    let eol = text.indexOf('\n', pos);
    if (eol < 0) eol = n;
    let eff = eol;
    if (eol < n && eol > pos && text.charCodeAt(eol - 1) === 13) eff = eol - 1;
    const q = text.indexOf('"', pos);
    if ((q < 0 || q >= eff) && eff > pos) {
      const lineText = text.slice(pos, eff);
      if (lineText.indexOf('\r') < 0) {
        fields = lineText.split(',');
        pos = eol < n ? eol + 1 : n;
        if (eol < n) line += 1;
      }
    }

    if (fields === null) {
      fields = [];
      do {
        let value;
        if (text.charCodeAt(pos) === 34) {
          // A quoted field: find its closing quote, the first quote that is
          // not doubled, jumping from quote to quote.
          lastQuoted = true;
          const open = pos;
          let scan = open + 1;
          let doubled = false;
          let close = -1;
          for (;;) {
            const nx = text.indexOf('"', scan);
            if (nx < 0) break;
            if (nx + 1 < n && text.charCodeAt(nx + 1) === 34) {
              doubled = true;
              scan = nx + 2;
              continue;
            }
            close = nx;
            break;
          }
          if (close < 0) {
            // The quote never closes: it is a literal character, and the
            // text after it is read again as unquoted. The line is still
            // the opening line: the scan above never moved it.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            let i = pos;
            let c = 0;
            while (i < n) {
              c = text.charCodeAt(i);
              if (c === 44 || c === 10 || c === 13) break;
              i += 1;
            }
            if (i >= n) {
              value = '"' + text.slice(pos, n);
              pos = n;
              ended = END;
            } else if (c === 44) {
              value = '"' + text.slice(pos, i);
              pos = i + 1;
              ended = COMMA;
            } else if (c === 10) {
              value = '"' + text.slice(pos, i);
              pos = i + 1;
              line += 1;
              ended = BREAK;
            } else if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
              value = '"' + text.slice(pos, i);
              pos = i + 2;
              line += 1;
              ended = BREAK;
            } else {
              value = '"' + text.slice(pos, i);
              let s = i;
              for (;;) {
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                s += 1;
                let k = s;
                while (k < n) {
                  const cc = text.charCodeAt(k);
                  if (cc === 44 || cc === 10 || cc === 13) break;
                  k += 1;
                }
                if (k > s) value += text.slice(s, k);
                if (k >= n) {
                  pos = n;
                  ended = END;
                  break;
                }
                const cc = text.charCodeAt(k);
                if (cc === 44) {
                  pos = k + 1;
                  ended = COMMA;
                  break;
                }
                if (cc === 10) {
                  pos = k + 1;
                  line += 1;
                  ended = BREAK;
                  break;
                }
                if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                  pos = k + 2;
                  line += 1;
                  ended = BREAK;
                  break;
                }
                s = k;
              }
            }
            fields.push(value);
            continue;
          }
          // The field's text, with "" collapsed to one quote and every CRLF
          // or lone CR read as LF. Each line break inside it is one LF in
          // the converted value, so counting those counts the lines.
          value = text.slice(open + 1, close);
          if (doubled) value = value.replaceAll('""', '"');
          if (value.indexOf('\r') >= 0) value = value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
          let nl = value.indexOf('\n');
          while (nl >= 0) {
            line += 1;
            nl = value.indexOf('\n', nl + 1);
          }
          pos = close + 1;
          if (pos >= n) {
            ended = END;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = COMMA;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = BREAK;
            } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = BREAK;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break; stray CRs in it are dropped
              // and do not count toward the junk.
              let added = 0;
              let i = pos;
              let cc = 0;
              while (i < n) {
                cc = text.charCodeAt(i);
                if (cc === 44 || cc === 10 || cc === 13) break;
                i += 1;
              }
              if (i > pos) {
                value += text.slice(pos, i);
                added += i - pos;
              }
              if (i >= n) {
                pos = n;
                ended = END;
              } else if (cc === 44) {
                pos = i + 1;
                ended = COMMA;
              } else if (cc === 10) {
                pos = i + 1;
                line += 1;
                ended = BREAK;
              } else if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
                pos = i + 2;
                line += 1;
                ended = BREAK;
              } else {
                let s = i;
                for (;;) {
                  errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                  s += 1;
                  let k = s;
                  while (k < n) {
                    const d = text.charCodeAt(k);
                    if (d === 44 || d === 10 || d === 13) break;
                    k += 1;
                  }
                  if (k > s) {
                    value += text.slice(s, k);
                    added += k - s;
                  }
                  if (k >= n) {
                    pos = n;
                    ended = END;
                    break;
                  }
                  const d = text.charCodeAt(k);
                  if (d === 44) {
                    pos = k + 1;
                    ended = COMMA;
                    break;
                  }
                  if (d === 10) {
                    pos = k + 1;
                    line += 1;
                    ended = BREAK;
                    break;
                  }
                  if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                    pos = k + 2;
                    line += 1;
                    ended = BREAK;
                    break;
                  }
                  s = k;
                }
              }
              if (added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
            }
          }
        } else {
          // An unquoted field: scan to the next comma, line break or CR and
          // cut the field out with one slice. A CR only slows the rare field
          // that actually holds a stray one.
          lastQuoted = false;
          let i = pos;
          let c = 0;
          while (i < n) {
            c = text.charCodeAt(i);
            if (c === 44 || c === 10 || c === 13) break;
            i += 1;
          }
          if (i >= n) {
            value = text.slice(pos, n);
            pos = n;
            ended = END;
          } else if (c === 44) {
            value = text.slice(pos, i);
            pos = i + 1;
            ended = COMMA;
          } else if (c === 10) {
            value = text.slice(pos, i);
            pos = i + 1;
            line += 1;
            ended = BREAK;
          } else if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
            value = text.slice(pos, i);
            pos = i + 2;
            line += 1;
            ended = BREAK;
          } else {
            value = text.slice(pos, i);
            let s = i;
            for (;;) {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              s += 1;
              let k = s;
              while (k < n) {
                const cc = text.charCodeAt(k);
                if (cc === 44 || cc === 10 || cc === 13) break;
                k += 1;
              }
              if (k > s) value += text.slice(s, k);
              if (k >= n) {
                pos = n;
                ended = END;
                break;
              }
              const cc = text.charCodeAt(k);
              if (cc === 44) {
                pos = k + 1;
                ended = COMMA;
                break;
              }
              if (cc === 10) {
                pos = k + 1;
                line += 1;
                ended = BREAK;
                break;
              }
              if (k + 1 < n && text.charCodeAt(k + 1) === 10) {
                pos = k + 2;
                line += 1;
                ended = BREAK;
                break;
              }
              s = k;
            }
          }
        }
        fields.push(value);
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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
  return { columns: header ? (columns === null ? [] : columns) : null, rows, errors };
}
