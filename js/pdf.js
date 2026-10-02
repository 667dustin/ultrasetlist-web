// Setlist PDF, matching the app's SetlistPDFExport: A4 portrait, 0.75 in
// margins, black on white, no header, one line per Song ("001  SONG NAME",
// or just "SONG NAME"), a thin rule where the Setlist has a break, one font
// size for every line (never below 12 pt; more pages instead).
//
// The app uses the system font, which a browser can't embed; this uses the
// PDF's built-in Helvetica (names) and Helvetica-Bold (numbers), so the
// file needs no font download and every PDF viewer shows it the same.

// Advance widths (1/1000 em) for WinAnsi bytes 32–255, measured from
// Helvetica on macOS (they match the standard PDF font metrics).
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,744,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,549,333,333,333,576,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500];

const PAGE_WIDTH = 595.2756;
const PAGE_HEIGHT = 841.8898;
const MARGIN = 54;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 1000;
const LINE_SPACING = 1.15;
const BREAK_SPACING = 0.4;
const GAP_EMS = 0.6;
const OUTLIER_SHRINK_LIMIT = 0.85;
/** Helvetica ascent, line height and cap heights, per point of font size. */
const ASCENT = 0.77002;
const LINE_HEIGHT = 1.0;
const CAP_HEIGHT = 0.71973;
/** Helvetica-Bold digits are all this wide, so numbers line up. */
const DIGIT_WIDTH = 0.556;
const ELLIPSIS_BYTE = 0x85;

const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;
const CONTENT_HEIGHT = PAGE_HEIGHT - 2 * MARGIN;

// MARK: - Text encoding

/** Unicode → WinAnsi (Windows-1252) for 0x80–0x9F. */
const CP1252_HIGH = {
    0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
    0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
    0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

function byteFor(char) {
    const code = char.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code;
    if (CP1252_HIGH[code]) return CP1252_HIGH[code];
    if (/\s/.test(char)) return 0x20;
    // Try without accents (e.g. "Ő" → "O"); otherwise a question mark.
    const base = char.normalize("NFD")[0];
    if (base !== char) return byteFor(base);
    return 0x3f;
}

/** The name as WinAnsi bytes, uppercased like the app. */
function encode(text) {
    return [...text.toUpperCase()].map(byteFor);
}

function widthOf(bytes) {
    return bytes.reduce((sum, b) => sum + (HELVETICA[b - 32] ?? 556), 0) / 1000;
}

// MARK: - Lines

/**
 * The Setlist's Songs that have Sounds, each numbered by its first Sound's
 * position in the Setlist (the number the app's Live Mode shows). Breaks
 * only appear between two printed Songs; touching breaks give one line.
 * Same rules as SetlistPDFExport.lines(for:).
 */
export function pdfLines(setlist, songsByID) {
    let soundsBefore = 0;
    let pendingBreak = false;
    const lines = [];
    for (const entry of setlist.entries) {
        if (entry.isBreak) {
            pendingBreak = lines.length > 0;
            continue;
        }
        const song = songsByID.get(entry.songID);
        if (!song || song.missing || song.soundCount <= 0) continue;
        lines.push({ number: soundsBefore + 1, title: song.title, breakBefore: pendingBreak });
        pendingBreak = false;
        soundsBefore += song.soundCount;
    }
    return lines;
}

/** "001", "042", "1000". */
export function numberText(number) {
    return String(number).padStart(3, "0");
}

// MARK: - Layout

function numberDigits(lines) {
    return Math.max(3, ...lines.map((l) => String(l.number).length));
}

const pitch = (size) => size * LINE_HEIGHT * LINE_SPACING;
const breakSpace = (size) => pitch(size) * BREAK_SPACING;
const nameX = (size, digits) => (digits > 0 ? digits * DIGIT_WIDTH * size + size * GAP_EMS : 0);
const clampSize = (size) => Math.min(MAX_FONT_SIZE, Math.max(1, size));

/** One font size for every line, and the lines split into pages. */
function layout(lines, showsNumbers) {
    const digits = showsNumbers ? numberDigits(lines) : 0;
    const breakCount = lines.filter((l) => l.breakBefore).length;
    const heightSize = clampSize(CONTENT_HEIGHT / (LINE_HEIGHT * LINE_SPACING * (lines.length + BREAK_SPACING * breakCount)));
    // Width is linear in the size: name start plus name width per point.
    const perPoint = (digits > 0 ? digits * DIGIT_WIDTH + GAP_EMS : 0);
    const widthSizes = lines
        .map((line) => clampSize(CONTENT_WIDTH / (perPoint + widthOf(encode(line.title)))))
        .sort((a, b) => a - b);

    // widthSizes[k] sets the size, truncating the k longest names (see the app).
    const maxOutliers = Math.min(Math.max(1, Math.floor(lines.length / 10)), widthSizes.length - 1);
    let limiting = 0;
    for (let k = 1; k <= maxOutliers; k++) {
        if (widthSizes[k - 1] < OUTLIER_SHRINK_LIMIT * Math.min(heightSize, widthSizes[k])) limiting = k;
    }

    const fontSize = Math.max(MIN_FONT_SIZE, Math.min(heightSize, widthSizes[limiting]));
    const pages = [];
    let page = [];
    let used = 0;
    for (const line of lines) {
        const height = pitch(fontSize) + (line.breakBefore ? breakSpace(fontSize) : 0);
        if (page.length > 0 && used + height > CONTENT_HEIGHT + 0.01) {
            pages.push(page);
            page = [];
            used = 0;
        }
        page.push(line);
        used += height;
    }
    pages.push(page);
    return { fontSize, digits, pages };
}

// MARK: - PDF writing

const num = (n) => (Math.round(n * 1000) / 1000).toString();

function pdfString(bytes) {
    let out = "(";
    for (const b of bytes) {
        if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
        else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
        else out += String.fromCharCode(b);
    }
    return out + ")";
}

function pageContent(page, { fontSize: size, digits }, showsNumbers) {
    const numberColumnWidth = digits * DIGIT_WIDTH * size;
    const nameStart = MARGIN + nameX(size, digits);
    const maxNameWidth = PAGE_WIDTH - MARGIN - nameStart;
    const contentTop = PAGE_HEIGHT - MARGIN;
    const ops = ["0 g", "0 G"];

    let baseline = contentTop - ASCENT * size;
    let previousBaseline = null;
    for (const line of page) {
        if (line.breakBefore) {
            baseline -= breakSpace(size);
            const ruleY = ((previousBaseline ?? contentTop) + baseline + CAP_HEIGHT * size) / 2;
            ops.push(`${num(Math.max(0.75, size * 0.05))} w`, `${num(MARGIN)} ${num(ruleY)} m ${num(PAGE_WIDTH - MARGIN)} ${num(ruleY)} l S`);
        }
        if (showsNumbers) {
            const digitsText = numberText(line.number);
            const x = MARGIN + numberColumnWidth - digitsText.length * DIGIT_WIDTH * size;
            ops.push(`BT /F2 ${num(size)} Tf ${num(x)} ${num(baseline)} Td ${pdfString(encode(digitsText))} Tj ET`);
        }
        let name = encode(line.title);
        if (widthOf(name) * size > maxNameWidth) {
            const ellipsis = HELVETICA[ELLIPSIS_BYTE - 32] / 1000;
            while (name.length > 0 && (widthOf(name) + ellipsis) * size > maxNameWidth) name = name.slice(0, -1);
            while (name.length > 0 && name[name.length - 1] === 0x20) name = name.slice(0, -1);
            name = [...name, ELLIPSIS_BYTE];
        }
        ops.push(`BT /F1 ${num(size)} Tf ${num(nameStart)} ${num(baseline)} Td ${pdfString(name)} Tj ET`);
        previousBaseline = baseline;
        baseline -= pitch(size);
    }
    return ops.join("\n");
}

/** The PDF as a Blob, or null if the Setlist has nothing to print. */
export function renderSetlistPDF(lines, { showsNumbers = true, title = "Setlist" } = {}) {
    if (lines.length === 0) return null;
    const result = layout(lines, showsNumbers);

    // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, 5 info,
    // then a page and its content stream per page. All ASCII, so string
    // length is byte length for the cross-reference offsets.
    const objects = [];
    const pageIDs = result.pages.map((_, i) => 6 + i * 2);
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIDs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIDs.length} >>`;
    objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objects[5] = `<< /Title ${pdfString([...title].map(byteFor))} /Producer (Ultrasetlist Web) >>`;
    result.pages.forEach((page, i) => {
        const content = pageContent(page, result, showsNumbers);
        objects[pageIDs[i]] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_WIDTH)} ${num(PAGE_HEIGHT)}] `
            + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIDs[i] + 1} 0 R >>`;
        objects[pageIDs[i] + 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });

    let out = "%PDF-1.4\n";
    const offsets = [];
    for (let id = 1; id < objects.length; id++) {
        offsets[id] = out.length;
        out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xref = out.length;
    out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Blob([out], { type: "application/pdf" });
}
