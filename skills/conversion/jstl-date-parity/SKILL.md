---
name: jstl-date-parity
description: Reproduce JSTL <fmt:formatDate> / Java SimpleDateFormat output exactly in JavaScript so dates and numbers render byte-identically to the legacy app.
triggers: [date, fmt:formatDate, SimpleDateFormat, formatNumber, locale, timezone, dd.MM.yyyy]
---

# JSTL date/number formatting parity

The legacy app formats dates with `<fmt:formatDate pattern="…">` (Java `SimpleDateFormat`) and numbers with `<fmt:formatNumber>`. JavaScript's `Intl`/`toLocale*` do **not** match these by default — reproduce the pattern exactly.

## Procedure

1. **Extract the exact pattern** from the JSP (`pattern="dd.MM.yyyy HH:mm"`), the `timeZone`, and the page/request locale (`<fmt:setLocale>` or the Accept-Language default).
2. **Translate the pattern token-for-token** — don't approximate:
   - `dd`=2-digit day · `MM`=2-digit month · `yyyy`=4-digit year · `HH`=24h 2-digit · `hh`=12h · `mm`/`ss`=2-digit · `a`=AM/PM · `EEE`=short weekday · `MMM`=short month name (locale!).
   - Java months print 1-based but `Date.getMonth()` is 0-based — add 1.
3. **Pin the time zone.** Java formats in the server/`timeZone` zone; a JS `Date` is the browser zone. Format with an explicit zone (a small `formatInZone(date, pattern, zone)` helper) so a user elsewhere still sees the legacy value.
4. **Match locale names.** `MMM`/`EEE` come from the legacy locale's `DateFormatSymbols`, not the browser's.
5. **Build a tiny token formatter, not `Intl`.** A replacer over `{ dd, MM, yyyy, … }` is the only reliable way to hit byte-parity; `Intl.DateTimeFormat` inserts locale punctuation you can't fully control.

## Parity gotchas

- `SimpleDateFormat` copies literal chars (`.` `/` `-`) verbatim — keep them.
- Two-digit years (`yy`) and week-of-year (`w`) show up in old apps — handle them explicitly.
- `<fmt:formatNumber>` grouping/decimal separators are locale-specific (`1.234,56` vs `1,234.56`).
