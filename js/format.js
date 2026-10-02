// The `.ultrasetlists` file format, shared with the Mac/iPad app
// (UltrasetlistSetlists.swift). Same rules as the app's validator, so a
// file this web app writes always passes Import Setlists in the app.
//
// {
//   "header":   { format, formatVersion, minReaderVersion, writer, writtenAt,
//                 timeZone, deviceName, counts: { songs, setlists, setlistEntries } },
//   "songs":    [ { id, title, soundCount } ],        // read-only, never changed here
//   "setlists": [ { id, title, entries: [ { songID } | { isBreak: true } ] } ]
// }

export const FORMAT = "UltrasetlistSetlists";
export const FORMAT_VERSION = 1;
export const WEB_VERSION = "1.0";
export const FILE_EXTENSION = "ultrasetlists";

/** Larger files are rejected before parsing. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_RECORDS = 10000;

export class FormatError extends Error {}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Uppercase, like Swift writes UUIDs. */
export function normalizeID(id) {
    return String(id).toUpperCase();
}

/** A new random UUID in Swift's uppercase form. */
export function newID() {
    if (globalThis.crypto?.randomUUID) {
        return crypto.randomUUID().toUpperCase();
    }
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toUpperCase();
}

/**
 * Reads and checks a Setlists file. Returns
 * `{ header, songs: [{id, title, soundCount}], setlists: [{id, title, entries}] }`
 * with IDs uppercased, or throws a FormatError with a readable message.
 */
export function parseSetlistsFile(text, byteLength = text.length) {
    if (byteLength > MAX_FILE_BYTES) {
        throw new FormatError("The file is too large to be a Setlists file.");
    }
    let json;
    try {
        json = JSON.parse(text);
    } catch {
        throw new FormatError("The file isn't a readable Setlists file. Choose the file the app saved with Export Setlists for Web.");
    }
    const header = json?.header;
    if (!header || typeof header !== "object") {
        if (json?.library || json?.manifest) {
            throw new FormatError("This is a library or backup file. In the app, use Export Setlists for Web instead.");
        }
        throw new FormatError("The file isn't a Setlists file.");
    }
    if (header.format !== FORMAT) {
        throw new FormatError(`The file isn't a Setlists file (format “${header.format}”).`);
    }
    if (!Number.isInteger(header.minReaderVersion) || header.minReaderVersion > FORMAT_VERSION) {
        throw new FormatError("This file was made by a newer version of the app. Reload this page to get the latest web app.");
    }
    if (!Array.isArray(json.songs) || !Array.isArray(json.setlists)) {
        throw new FormatError("The file is incomplete.");
    }
    if (json.songs.length > MAX_RECORDS || json.setlists.length > MAX_RECORDS) {
        throw new FormatError("The file has more Songs or Setlists than this web app supports.");
    }

    const songs = json.songs.map((song) => {
        if (!song || !UUID_PATTERN.test(song.id) || typeof song.title !== "string"
            || !Number.isInteger(song.soundCount) || song.soundCount < 0) {
            throw new FormatError("The file contains an invalid Song.");
        }
        return { id: normalizeID(song.id), title: song.title, soundCount: song.soundCount };
    });
    const songIDs = new Set(songs.map((s) => s.id));
    if (songIDs.size !== songs.length) {
        throw new FormatError("The file contains a duplicate Song ID.");
    }

    const setlists = json.setlists.map((setlist) => {
        if (!setlist || !UUID_PATTERN.test(setlist.id) || typeof setlist.title !== "string"
            || !Array.isArray(setlist.entries) || setlist.entries.length > MAX_RECORDS) {
            throw new FormatError("The file contains an invalid Setlist.");
        }
        const entries = setlist.entries.map((entry) => {
            const isBreak = entry?.isBreak === true;
            const hasSong = entry?.songID != null;
            if (isBreak && !hasSong) return { isBreak: true };
            if (!isBreak && hasSong && UUID_PATTERN.test(entry.songID)) {
                const songID = normalizeID(entry.songID);
                if (!songIDs.has(songID)) {
                    throw new FormatError("The file refers to a Song that isn't in its Songs list.");
                }
                return { songID };
            }
            throw new FormatError("The file contains a Setlist entry that is neither a Song nor a break.");
        });
        return { id: normalizeID(setlist.id), title: setlist.title, entries };
    });
    if (new Set(setlists.map((s) => s.id)).size !== setlists.length) {
        throw new FormatError("The file contains a duplicate Setlist ID.");
    }

    const counts = header.counts ?? {};
    const entryCount = setlists.reduce((sum, s) => sum + s.entries.length, 0);
    if (counts.songs !== songs.length || counts.setlists !== setlists.length || counts.setlistEntries !== entryCount) {
        throw new FormatError("The file's contents don't match its header; it may be damaged or incomplete.");
    }

    return {
        header: {
            writer: String(header.writer ?? ""),
            writtenAt: String(header.writtenAt ?? ""),
            deviceName: String(header.deviceName ?? ""),
        },
        songs,
        setlists,
    };
}

/** Keys sorted at every level, like the app's encoder. */
function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
    }
    return value;
}

/** e.g. "2026-10-02T17:05:10+02:00". */
export function localTimestamp(date = new Date()) {
    const pad = (n) => String(Math.abs(n)).padStart(2, "0");
    const offset = -date.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
        + `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/**
 * Builds the file text for `setlists`, with a Songs list of `songs` (every
 * Song any of them uses must be in it). Checks the result with the same
 * parser before returning it.
 */
export function buildSetlistsFile({ songs, setlists, deviceName, date = new Date() }) {
    const fileSetlists = setlists.map((setlist) => ({
        id: normalizeID(setlist.id),
        title: setlist.title,
        entries: setlist.entries.map((entry) => (entry.isBreak ? { isBreak: true } : { songID: normalizeID(entry.songID) })),
    }));
    const fileSongs = songs.map((song) => ({ id: normalizeID(song.id), title: song.title, soundCount: song.soundCount }));
    const file = {
        header: {
            format: FORMAT,
            formatVersion: FORMAT_VERSION,
            minReaderVersion: FORMAT_VERSION,
            writer: "web",
            webVersion: WEB_VERSION,
            writtenAt: localTimestamp(date),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
            deviceName: deviceName || "Web App",
            counts: {
                songs: fileSongs.length,
                setlists: fileSetlists.length,
                setlistEntries: fileSetlists.reduce((sum, s) => sum + s.entries.length, 0),
            },
        },
        songs: fileSongs,
        setlists: fileSetlists,
    };
    const text = JSON.stringify(sortKeys(file), null, 2);
    parseSetlistsFile(text); // never hand over a file that wouldn't read back
    return text;
}

/** "Ultrasetlist - Setlists - <name> - 2026-10-02 17-05-10.ultrasetlists". */
export function suggestedFilename(label, deviceName, date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
    const parts = ["Ultrasetlist", label, deviceName || "Web App", stamp].map(safeFilenamePart);
    return `${parts.join(" - ")}.${FILE_EXTENSION}`;
}

export function safeFilenamePart(text) {
    return String(text).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}
