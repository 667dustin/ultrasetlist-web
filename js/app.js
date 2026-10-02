// Ultrasetlist Web: arrange Setlists from a `.ultrasetlists` file, print
// them as PDFs, and send a `.ultrasetlists` file back to the app.
//
// Rules (agreed with the app owner):
// - Songs are read-only: never created, renamed or deleted here.
// - Setlists can be created, renamed and rearranged (Songs and breaks).
// - Only Setlists made here and never sent can be deleted.
// - Everything stays in this browser (localStorage); there is no server.

import {
    FormatError, WEB_VERSION, buildSetlistsFile, newID, parseSetlistsFile, suggestedFilename,
} from "./format.js";
import { numberText, pdfLines, renderSetlistPDF } from "./pdf.js";

const STORAGE_KEY = "ultrasetlist-web/v1";
const app = document.getElementById("app");
const fileInput = document.getElementById("file-input");

// MARK: - State

/**
 * {
 *   source: { deviceName, writtenAt, fileName, loadedAt } | null,
 *   songs: [{ id, title, soundCount, missing? }],   // missing: kept only because a local Setlist uses it
 *   setlists: [{ id, title, entries, origin: "app"|"web", original: {title, entries}|null, sentKey: string|null }],
 *   senderName: string,
 * }
 */
let state = load();
/** What's on screen: { name: "home" } | { name: "edit", id } | { name: "send" }. */
let view = { name: "home" };
/** Undo snapshots for the Setlist being edited. */
let undoStack = [];

function emptyState() {
    return { source: null, songs: [], setlists: [], senderName: "" };
}

function load() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        if (saved && Array.isArray(saved.songs) && Array.isArray(saved.setlists)) return { ...emptyState(), ...saved };
    } catch { /* start fresh */ }
    return emptyState();
}

function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        toast("Couldn't save on this phone; storage may be full.");
    }
}

const songsByID = () => new Map(state.songs.map((s) => [s.id, s]));
const findSetlist = (id) => state.setlists.find((s) => s.id === id);
const contentKey = (s) => JSON.stringify([s.title, s.entries]);
const clone = (value) => JSON.parse(JSON.stringify(value));

function isChanged(setlist) {
    return setlist.origin === "app" && setlist.original != null && contentKey(setlist) !== contentKey(setlist.original);
}

/** New here, or changed from the app's version: worth sending back. */
function hasLocalWork(setlist) {
    return setlist.origin === "web" || isChanged(setlist);
}

function needsSending(setlist) {
    return hasLocalWork(setlist) && setlist.sentKey !== contentKey(setlist);
}

const canDelete = (setlist) => setlist.origin === "web" && setlist.sentKey == null;
const displayTitle = (setlist) => setlist.title.trim() || "Untitled Setlist";

function statusText(setlist) {
    const parts = [];
    if (setlist.origin === "web") parts.push("New");
    else if (isChanged(setlist)) parts.push("Changed");
    if (hasLocalWork(setlist)) parts.push(needsSending(setlist) ? "not sent" : "sent");
    return parts.join(" · ");
}

// MARK: - DOM helpers

/** h("div", { class: "x", onclick }, child, …) */
function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;
        if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
        else if (key === "class") el.className = value;
        else if (key === "dataset") Object.assign(el.dataset, value);
        else if (value === true) el.setAttribute(key, "");
        else el.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
}

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function formatDate(text) {
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

let toastTimer;
function toast(message) {
    let el = document.getElementById("toast");
    if (!el) {
        el = h("div", { id: "toast", role: "status", "aria-live": "polite" });
        document.body.append(el);
    }
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 2600);
}

/**
 * A modal with a message and buttons. Resolves with the chosen button's
 * `value`, or null if dismissed.
 */
function choose(title, message, buttons) {
    return new Promise((resolve) => {
        const dialog = h("dialog", { class: "dialog" },
            h("h2", {}, title),
            message ? h("p", {}, message) : null,
            h("div", { class: "dialog-buttons" },
                buttons.map((b) => h("button", {
                    class: b.style ?? "",
                    onclick: () => { dialog.close(); resolve(b.value); },
                }, b.label))));
        dialog.addEventListener("cancel", () => resolve(null));
        dialog.addEventListener("close", () => dialog.remove());
        document.body.append(dialog);
        dialog.showModal();
    });
}

// MARK: - Rendering

function render() {
    if (view.name === "edit" && !findSetlist(view.id)) view = { name: "home" };
    if (!state.source && state.setlists.length === 0) {
        app.replaceChildren(renderStart());
    } else if (view.name === "edit") {
        app.replaceChildren(renderEditor(findSetlist(view.id)));
    } else if (view.name === "send") {
        app.replaceChildren(renderSend());
    } else {
        app.replaceChildren(renderHome());
    }
}

function show(next) {
    view = next;
    if (next.name === "edit") undoStack = [];
    render();
    window.scrollTo(0, 0);
}

function renderStart() {
    return h("main", { class: "start" },
        h("h1", {}, "Ultrasetlist Setlists"),
        h("p", {}, "Arrange Setlists for the band and print them as PDFs."),
        h("ol", { class: "steps" },
            h("li", {}, "Get a Setlists file from the app (Export Setlists for Web)."),
            h("li", {}, "Open it here, then arrange Setlists and print them."),
            h("li", {}, "Send the file back so the changes can be imported in the app.")),
        h("button", { class: "primary large", onclick: () => fileInput.click() }, "Open Setlists File…"),
        h("p", { class: "fine" }, "Your Setlists stay on this phone. Nothing is uploaded."),
        footer());
}

function footer() {
    return h("footer", { class: "footer" }, `Ultrasetlist Web ${WEB_VERSION}`);
}

function renderHome() {
    const setlists = [...state.setlists].sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
    const unsent = state.setlists.filter(needsSending).length;
    const source = state.source;
    return h("main", {},
        h("header", { class: "bar" },
            h("h1", {}, "Setlists"),
            h("button", { class: "plain", onclick: openFileChosen }, "Open File…")),
        source ? h("p", { class: "source" },
            `From ${source.deviceName || "the app"}${source.writtenAt ? ` · ${formatDate(source.writtenAt)}` : ""} · `
            + `${plural(state.songs.filter((s) => !s.missing).length, "Song")}`) : null,
        h("div", { class: "actions" },
            h("button", { class: "primary", onclick: newSetlist }, "+ New Setlist"),
            h("button", { onclick: () => show({ name: "send" }), disabled: state.setlists.length === 0 },
                unsent > 0 ? `Send File Back (${unsent})…` : "Send File Back…")),
        setlists.length === 0 ? h("p", { class: "empty" }, "No Setlists yet.") : null,
        h("ul", { class: "list" },
            setlists.map((setlist) => {
                const songCount = setlist.entries.filter((e) => !e.isBreak).length;
                const status = statusText(setlist);
                return h("li", {},
                    h("button", { class: "row", onclick: () => show({ name: "edit", id: setlist.id }) },
                        h("span", { class: "row-title" }, displayTitle(setlist)),
                        h("span", { class: "row-detail" }, plural(songCount, "Song"),
                            status ? h("span", { class: `badge ${needsSending(setlist) ? "badge-unsent" : ""}` }, status) : null),
                        h("span", { class: "chevron", "aria-hidden": "true" }, "›")));
            })),
        footer());
}

function newSetlist() {
    const taken = new Set(state.setlists.map((s) => s.title));
    let title = "Untitled Setlist";
    for (let n = 2; taken.has(title); n++) title = `Untitled Setlist ${n}`;
    const setlist = { id: newID(), title, entries: [], origin: "web", original: null, sentKey: null };
    state.setlists.push(setlist);
    save();
    show({ name: "edit", id: setlist.id });
    const input = app.querySelector(".title-input");
    input?.focus();
    input?.select();
}

// MARK: - Editor

function renderEditor(setlist) {
    const songs = songsByID();
    // The number each printed Song gets in the PDF, by entry index.
    const numbers = new Map();
    let soundsBefore = 0;
    setlist.entries.forEach((entry, index) => {
        const song = songs.get(entry.songID);
        if (entry.isBreak || !song || song.missing || song.soundCount <= 0) return;
        numbers.set(index, soundsBefore + 1);
        soundsBefore += song.soundCount;
    });
    const songCount = setlist.entries.filter((e) => !e.isBreak).length;
    const notPrinted = songCount - numbers.size;
    const hasLines = numbers.size > 0;

    const list = h("ol", { class: "entries" },
        setlist.entries.map((entry, index) => entryRow(setlist, entry, index, songs, numbers)));

    return h("main", { class: "editor" },
        h("header", { class: "bar" },
            h("button", { class: "plain back", onclick: () => show({ name: "home" }) }, "‹ Setlists"),
            h("div", { class: "bar-buttons" },
                h("button", { onclick: () => printPDF(setlist), disabled: !hasLines,
                    title: hasLines ? "Save this Setlist as a PDF" : "Add Songs with Sounds first" }, "PDF…"),
                h("button", { class: "plain", onclick: () => setlistMenu(setlist), "aria-label": "More" }, "•••"))),
        h("label", { class: "title-label" }, "Setlist title",
            h("input", {
                class: "title-input", type: "text", value: setlist.title, autocomplete: "off",
                onfocus: () => pushUndo(setlist),
                oninput: (e) => { setlist.title = e.target.value; save(); updateEditorStatus(setlist); },
            })),
        h("p", { class: "editor-status" }, editorStatusText(setlist, songCount, notPrinted)),
        setlist.entries.length === 0 ? h("p", { class: "empty" }, "No Songs yet. Tap “Add Songs”.") : null,
        list,
        h("div", { class: "editor-tools" },
            h("button", { class: "primary", onclick: () => openSongPicker(setlist) }, "+ Add Songs"),
            h("button", { onclick: () => edit(setlist, () => setlist.entries.push({ isBreak: true })) }, "+ Break"),
            h("button", { onclick: () => undo(setlist), disabled: undoStack.length === 0 }, "Undo")));
}

function editorStatusText(setlist, songCount, notPrinted) {
    const parts = [plural(songCount, "Song")];
    if (notPrinted > 0) parts.push(`${notPrinted} not printed (no Sounds)`);
    const status = statusText(setlist);
    if (status) parts.push(status);
    return parts.join(" · ");
}

/** Refreshes the status line while typing the title, without a full re-render. */
function updateEditorStatus(setlist) {
    const el = app.querySelector(".editor-status");
    if (!el) return;
    const songs = songsByID();
    const songEntries = setlist.entries.filter((e) => !e.isBreak);
    const notPrinted = songEntries.filter((e) => { const s = songs.get(e.songID); return !s || s.missing || s.soundCount <= 0; }).length;
    el.textContent = editorStatusText(setlist, songEntries.length, notPrinted);
}

function entryRow(setlist, entry, index, songs, numbers) {
    const last = setlist.entries.length - 1;
    const controls = h("span", { class: "entry-controls" },
        h("button", { class: "icon", "aria-label": "Move up", disabled: index === 0,
            onclick: () => edit(setlist, () => move(setlist.entries, index, index - 1)) }, "↑"),
        h("button", { class: "icon", "aria-label": "Move down", disabled: index === last,
            onclick: () => edit(setlist, () => move(setlist.entries, index, index + 1)) }, "↓"),
        h("button", { class: "icon remove", "aria-label": "Remove",
            onclick: () => edit(setlist, () => setlist.entries.splice(index, 1)) }, "✕"));
    const handle = h("span", { class: "handle", "aria-hidden": "true",
        onpointerdown: (e) => startDrag(e, setlist) }, "≡");

    if (entry.isBreak) {
        return h("li", { class: "entry entry-break", dataset: { index } },
            handle, h("span", { class: "break-line" }, h("span", {}, "Break")), controls);
    }
    const song = songs.get(entry.songID);
    const number = numbers.get(index);
    let note = null;
    if (!song || song.missing) note = "not in the latest file";
    else if (song.soundCount <= 0) note = "no Sounds · not printed";
    return h("li", { class: `entry ${number ? "" : "entry-unprinted"}`, dataset: { index } },
        handle,
        h("span", { class: "entry-number" }, number ? numberText(number) : "–"),
        h("span", { class: "entry-title" }, song?.title ?? "Unknown Song", note ? h("small", {}, note) : null),
        controls);
}

function move(array, from, to) {
    const [item] = array.splice(from, 1);
    array.splice(to, 0, item);
}

function pushUndo(setlist) {
    undoStack.push(clone({ title: setlist.title, entries: setlist.entries }));
    if (undoStack.length > 100) undoStack.shift();
}

/** Applies a change to the Setlist being edited, with undo. */
function edit(setlist, change) {
    pushUndo(setlist);
    change();
    save();
    render();
}

function undo(setlist) {
    const snapshot = undoStack.pop();
    if (!snapshot) return;
    setlist.title = snapshot.title;
    setlist.entries = snapshot.entries;
    save();
    render();
}

/**
 * Drag to reorder by the ≡ handle (touch or mouse). The row moves live
 * between its neighbours; the new order is applied on release.
 */
function startDrag(event, setlist) {
    const row = event.target.closest(".entry");
    const list = row?.parentElement;
    if (!row || !list) return;
    event.preventDefault();
    const handle = event.target;
    handle.setPointerCapture(event.pointerId);
    row.classList.add("dragging");
    const startOrder = [...list.children].map((el) => Number(el.dataset.index));
    let scrollTimer = null;
    let lastY = event.clientY;

    const reposition = (y) => {
        const prev = row.previousElementSibling;
        const next = row.nextElementSibling;
        if (prev) {
            const r = prev.getBoundingClientRect();
            if (y < r.top + r.height / 2) { list.insertBefore(row, prev); return; }
        }
        if (next) {
            const r = next.getBoundingClientRect();
            if (y > r.top + r.height / 2) list.insertBefore(row, next.nextElementSibling);
        }
    };
    const onMove = (e) => {
        lastY = e.clientY;
        reposition(lastY);
        // Scroll when dragging near the top or bottom of the screen.
        const edge = 70;
        const speed = lastY < edge ? -12 : lastY > window.innerHeight - edge ? 12 : 0;
        clearInterval(scrollTimer);
        scrollTimer = speed ? setInterval(() => { window.scrollBy(0, speed); reposition(lastY); }, 16) : null;
    };
    const onUp = () => {
        clearInterval(scrollTimer);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        row.classList.remove("dragging");
        const order = [...list.children].map((el) => Number(el.dataset.index));
        if (order.join() !== startOrder.join()) {
            edit(setlist, () => { setlist.entries = order.map((i) => setlist.entries[i]); });
        }
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
}

async function setlistMenu(setlist) {
    const buttons = [];
    if (isChanged(setlist)) buttons.push({ label: "Undo All My Changes", value: "revert" });
    buttons.push({ label: "Duplicate", value: "duplicate" });
    if (canDelete(setlist)) buttons.push({ label: "Delete Setlist…", value: "delete", style: "danger" });
    buttons.push({ label: "Cancel", value: null });
    const message = setlist.origin === "app"
        ? "This Setlist came from the app, so it can't be deleted here."
        : setlist.sentKey != null ? "This Setlist was already sent, so it can't be deleted here." : null;
    const choice = await choose(displayTitle(setlist), message, buttons);
    if (choice === "revert") {
        const ok = await choose("Undo All Changes?", "This Setlist goes back to the version from the app's file.",
            [{ label: "Undo Changes", value: true, style: "danger" }, { label: "Cancel", value: false }]);
        if (ok) edit(setlist, () => { setlist.title = setlist.original.title; setlist.entries = clone(setlist.original.entries); });
    } else if (choice === "duplicate") {
        const copy = { id: newID(), title: `${displayTitle(setlist)} Copy`, entries: clone(setlist.entries), origin: "web", original: null, sentKey: null };
        state.setlists.push(copy);
        save();
        show({ name: "edit", id: copy.id });
        toast("Duplicated");
    } else if (choice === "delete") {
        const ok = await choose(`Delete “${displayTitle(setlist)}”?`, "It was never sent, so this can't be undone.",
            [{ label: "Delete", value: true, style: "danger" }, { label: "Cancel", value: false }]);
        if (ok) {
            state.setlists = state.setlists.filter((s) => s.id !== setlist.id);
            save();
            show({ name: "home" });
        }
    }
}

// MARK: - Song picker

function openSongPicker(setlist) {
    const songs = state.songs.filter((s) => !s.missing).sort((a, b) => a.title.localeCompare(b.title));
    const added = new Map();
    let changed = false;

    const listEl = h("ul", { class: "picker-list" });
    const search = h("input", { type: "search", class: "picker-search", placeholder: "Search Songs", autocomplete: "off",
        oninput: () => fill() });
    const close = () => {
        dialog.close();
        if (changed) render();
    };
    const dialog = h("dialog", { class: "picker" },
        h("header", { class: "bar" },
            h("h2", {}, "Add Songs"),
            h("button", { class: "primary", onclick: close }, "Done")),
        search,
        h("p", { class: "fine" }, "Tap a Song to add it at the end. Songs can't be changed here."),
        listEl);

    function fill() {
        const query = search.value.trim().toLocaleLowerCase();
        const inSetlist = new Set(setlist.entries.map((e) => e.songID));
        const matches = songs.filter((s) => s.title.toLocaleLowerCase().includes(query));
        listEl.replaceChildren(...(matches.length === 0
            ? [h("li", { class: "empty" }, "No matching Songs.")]
            : matches.map((song) => {
                const count = added.get(song.id) ?? 0;
                const details = [];
                if (song.soundCount <= 0) details.push("no Sounds · won't print");
                if (inSetlist.has(song.id)) details.push(count > 0 ? `added ${count}×` : "already in this Setlist");
                return h("li", {},
                    h("button", { class: `row ${song.soundCount <= 0 ? "row-dim" : ""}`, onclick: () => {
                        if (!changed) pushUndo(setlist);
                        changed = true;
                        setlist.entries.push({ songID: song.id });
                        added.set(song.id, count + 1);
                        save();
                        fill();
                        toast(`Added “${song.title}”`);
                    } },
                    h("span", { class: "row-title" }, song.title),
                    details.length ? h("span", { class: "row-detail" }, details.join(" · ")) : null,
                    h("span", { class: "plus", "aria-hidden": "true" }, "+")));
            })));
    }

    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    fill();
    dialog.showModal();
}

// MARK: - PDF

async function printPDF(setlist) {
    const choice = await choose("PDF", "Numbers are each Song's first Sound in the Setlist, as in the app's Live Mode.", [
        { label: "With Numbers", value: "numbers", style: "primary" },
        { label: "Names Only", value: "names" },
        { label: "Cancel", value: null },
    ]);
    if (!choice) return;
    const blob = renderSetlistPDF(pdfLines(setlist, songsByID()), { showsNumbers: choice === "numbers", title: displayTitle(setlist) });
    if (!blob) return;
    await deliver(blob, `${safeName(displayTitle(setlist))}.pdf`, "application/pdf");
}

const safeName = (text) => text.replace(/[\/\\:*?"<>|]/g, " ").trim() || "Setlist";

/**
 * Hands a file to the phone: the share sheet where the browser supports
 * sharing that file (WhatsApp, email, Drive…), otherwise a download.
 */
async function deliver(blob, filename, type, { preferShare = true } = {}) {
    const file = new File([blob], filename, { type });
    if (preferShare && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: filename });
            return "shared";
        } catch (error) {
            if (error?.name === "AbortError") return "cancelled";
            // Fall through to a download.
        }
    }
    const url = URL.createObjectURL(blob);
    const link = h("a", { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return "downloaded";
}

// MARK: - Send back

function renderSend() {
    const setlists = [...state.setlists].sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
    const selected = new Set(setlists.filter(needsSending).map((s) => s.id));
    const nameInput = h("input", { type: "text", value: state.senderName, placeholder: "e.g. Alex's phone", autocomplete: "name",
        oninput: (e) => { state.senderName = e.target.value; save(); } });

    const sendButtons = h("div", { class: "actions" });
    const updateButtons = () => {
        const canShareFiles = !!navigator.canShare;
        sendButtons.replaceChildren(
            canShareFiles ? h("button", { class: "primary", disabled: selected.size === 0, onclick: () => send(selected, true) }, "Share File…") : null,
            h("button", { class: canShareFiles ? "" : "primary", disabled: selected.size === 0, onclick: () => send(selected, false) }, "Download File"));
    };
    updateButtons();

    return h("main", {},
        h("header", { class: "bar" },
            h("button", { class: "plain back", onclick: () => show({ name: "home" }) }, "‹ Setlists"),
            h("h1", {}, "Send File Back")),
        h("p", {}, "Choose the Setlists to send. Send the file to whoever runs the app; they choose what to import. Songs are never changed."),
        h("ul", { class: "list checklist" },
            setlists.map((setlist) => {
                const box = h("input", { type: "checkbox", checked: selected.has(setlist.id),
                    onchange: (e) => { e.target.checked ? selected.add(setlist.id) : selected.delete(setlist.id); updateButtons(); } });
                const status = statusText(setlist);
                return h("li", {}, h("label", { class: "row" }, box,
                    h("span", { class: "row-title" }, displayTitle(setlist)),
                    h("span", { class: "row-detail" }, status || "unchanged")));
            })),
        h("label", { class: "field" }, "Your name (shown in the app)", nameInput),
        sendButtons,
        footer());
}

async function send(selectedIDs, share) {
    const chosen = state.setlists.filter((s) => selectedIDs.has(s.id));
    const used = new Set(chosen.flatMap((s) => s.entries.map((e) => e.songID)).filter(Boolean));
    // The Songs list goes back as it came, plus any kept-but-missing Songs the chosen Setlists still use.
    const songs = state.songs.filter((s) => !s.missing || used.has(s.id));
    const name = state.senderName.trim();
    let text;
    try {
        text = buildSetlistsFile({ songs, setlists: chosen, deviceName: name });
    } catch (error) {
        await choose("Couldn't Make the File", error.message, [{ label: "OK", value: null }]);
        return;
    }
    const label = chosen.length === 1 ? `Setlist - ${displayTitle(chosen[0])}` : "Setlists";
    const result = await deliver(new Blob([text], { type: "application/json" }), suggestedFilename(label, name), "application/json", { preferShare: share });
    if (result === "cancelled") return;
    for (const setlist of chosen) setlist.sentKey = contentKey(setlist);
    save();
    show({ name: "home" });
    toast(result === "shared" ? `Shared ${plural(chosen.length, "Setlist")}` : `Downloaded ${plural(chosen.length, "Setlist")} — send the file from your Downloads`);
}

// MARK: - Opening a file

function openFileChosen() {
    fileInput.click();
}

fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    let parsed;
    try {
        parsed = parseSetlistsFile(await file.text(), file.size);
    } catch (error) {
        const message = error instanceof FormatError ? error.message : "The file couldn't be read.";
        await choose("Can't Open This File", message, [{ label: "OK", value: null }]);
        return;
    }
    if (parsed.header.writer === "web") {
        const ok = await choose("Open a Web App File?",
            "This file was made by the web app, not the app. Open it anyway? Its Setlists will be treated as the app's versions.",
            [{ label: "Open", value: true }, { label: "Cancel", value: false }]);
        if (!ok) return;
    }

    const localWork = state.setlists.filter(hasLocalWork);
    let keep = false;
    if (localWork.length > 0) {
        const choice = await choose(
            `Keep Your ${plural(localWork.length, "Setlist")}?`,
            `You have ${plural(localWork.length, "new or changed Setlist")} here (${localWork.map(displayTitle).join(", ")}). `
            + "Keep them, or replace everything with the file's Setlists?",
            [
                { label: "Keep Mine", value: "keep", style: "primary" },
                { label: "Replace With File", value: "replace", style: "danger" },
                { label: "Cancel", value: null },
            ]);
        if (!choice) return;
        keep = choice === "keep";
    }
    applyFile(parsed, file.name, keep ? localWork : []);
    show({ name: "home" });
    toast(`Opened ${plural(parsed.setlists.length, "Setlist")} and ${plural(parsed.songs.length, "Song")}`);
});

/**
 * Takes the file's Songs and Setlists. `kept` local Setlists stay as they
 * are; a kept changed Setlist that's also in the file is now compared with
 * the file's version. Songs a kept Setlist uses that the file no longer has
 * are kept as "missing" so their names still show.
 */
function applyFile(parsed, fileName, kept) {
    const fileSongs = new Map(parsed.songs.map((s) => [s.id, s]));
    const oldSongs = songsByID();
    const keptIDs = new Set(kept.map((s) => s.id));

    const setlists = parsed.setlists
        .filter((s) => !keptIDs.has(s.id))
        .map((s) => ({ id: s.id, title: s.title, entries: clone(s.entries), origin: "app", original: clone({ title: s.title, entries: s.entries }), sentKey: null }));
    for (const local of kept) {
        const fromFile = parsed.setlists.find((s) => s.id === local.id);
        if (fromFile) {
            local.origin = "app";
            local.original = clone({ title: fromFile.title, entries: fromFile.entries });
        }
        setlists.push(local);
    }

    const songs = [...parsed.songs];
    const needed = new Set(kept.flatMap((s) => s.entries.map((e) => e.songID)).filter(Boolean));
    for (const id of needed) {
        if (!fileSongs.has(id)) {
            const old = oldSongs.get(id);
            songs.push({ id, title: old?.title ?? "Unknown Song", soundCount: old?.soundCount ?? 0, missing: true });
        }
    }

    state = {
        ...state,
        source: { ...parsed.header, fileName, loadedAt: new Date().toISOString() },
        songs,
        setlists,
    };
    save();
}

// Keep tabs in sync if the app is open twice.
window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY) {
        state = load();
        render();
    }
});

render();
