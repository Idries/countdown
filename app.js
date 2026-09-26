'use strict';

const STORAGE_KEY = 'countdowns.v1';
const SORT_KEY = 'countdowns.sort';
const COLORS = ['#7c8cff', '#ff7aa8', '#ffb454', '#4fd1a5', '#5ec8ff', '#c38bff', '#ff6b6b', '#a3b1c2'];
const DAY_MS = 86400000;

// ---------- Storage ----------

function loadItems() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveItems() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

let items = loadItems();
let sortMode = localStorage.getItem(SORT_KEY) || 'soonest';

// Ask the browser not to evict our data when storage is low.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

// ---------- Date helpers ----------

// Calendar dates are handled as {y, m, d} (m is 0-based) and compared via a
// UTC day number, which sidesteps daylight-saving surprises.

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return { y, m: m - 1, d };
}

function dayNum({ y, m, d }) {
  return Math.round(Date.UTC(y, m, d) / DAY_MS);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

// Same day-of-month N months later, clamped (Jan 31 + 1 month = Feb 28/29).
function addMonths({ y, m, d }, n) {
  const total = y * 12 + m + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) };
}

function todayDate(now) {
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

// Years / months / days between two calendar dates (a <= b).
function calendarDiff(a, b) {
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (dayNum(addMonths(a, months)) > dayNum(b)) months--;
  const days = dayNum(b) - dayNum(addMonths(a, months));
  return { years: Math.floor(months / 12), months: months % 12, days };
}

// The date this item is currently counting towards. For yearly items that is
// the next anniversary on or after today.
function targetDate(item, today) {
  const base = parseDate(item.date);
  if (!item.yearly) return base;
  const occurrenceIn = (y) => ({ y, m: base.m, d: Math.min(base.d, daysInMonth(y, base.m)) });
  let next = occurrenceIn(Math.max(today.y, base.y));
  if (dayNum(next) < dayNum(today)) next = occurrenceIn(next.y + 1);
  return next;
}

function toMoment(date, time) {
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(date.y, date.m, date.d, hh, mm, 0, 0);
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const fmtNum = new Intl.NumberFormat();
const fmtDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function pad(n) {
  return String(n).padStart(2, '0');
}

// ---------- Computing what a card shows ----------

function describe(item, now) {
  const today = todayDate(now);
  const target = targetDate(item, today);
  const moment = toMoment(target, item.time);
  const dayDelta = dayNum(target) - dayNum(today);
  const past = item.time ? moment <= now : dayDelta < 0;
  const isToday = dayDelta === 0;

  const [from, to] = dayDelta >= 0 ? [today, target] : [target, today];
  const diff = calendarDiff(from, to);

  // Progress from when the countdown was created (or the previous
  // anniversary, for yearly items) to the target.
  let start;
  if (item.yearly) {
    const prev = { y: target.y - 1, m: target.m, d: Math.min(parseDate(item.date).d, daysInMonth(target.y - 1, target.m)) };
    start = toMoment(prev, item.time);
  } else {
    start = new Date(item.created || now);
  }
  const span = moment - start;
  const progress = past ? 1 : span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 0;

  const baseYear = parseDate(item.date).y;
  const occurrence = item.yearly && target.y > baseYear ? target.y - baseYear : null;

  return { target, moment, dayDelta, past, isToday, diff, progress, occurrence };
}

function bigText(info) {
  const { dayDelta, past, isToday } = info;
  if (isToday) return { num: past ? 'Today' : 'Today!', unit: '' };
  if (dayDelta === 1) return { num: 'Tomorrow', unit: '' };
  if (dayDelta === -1) return { num: 'Yesterday', unit: '' };
  const n = Math.abs(dayDelta);
  return { num: fmtNum.format(n), unit: `${n === 1 ? 'day' : 'days'}${past ? ' ago' : ' to go'}` };
}

function liveText(info, now) {
  let ms = info.moment - now;
  const sign = ms < 0 ? -1 : 1;
  ms = Math.abs(ms);
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const clock = `${d > 0 ? fmtNum.format(d) + 'd ' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
  return sign < 0 ? `${clock} since` : `${clock} to the minute`;
}

// ---------- Rendering ----------

const listEl = document.getElementById('list');
const emptyEl = document.getElementById('empty');
let renderKey = '';

function sortedItems(now) {
  const withInfo = items.map((item) => ({ item, info: describe(item, now) }));
  if (sortMode === 'name') {
    withInfo.sort((a, b) => a.item.title.localeCompare(b.item.title));
  } else {
    // Upcoming first (soonest at top), then past events (most recent first).
    withInfo.sort((a, b) => {
      if (a.info.past !== b.info.past) return a.info.past ? 1 : -1;
      return a.info.past ? b.info.moment - a.info.moment : a.info.moment - b.info.moment;
    });
  }
  return withInfo;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function unitBox(value, label) {
  const box = el('div', 'unit-box');
  box.append(el('b', null, fmtNum.format(value)), el('span', null, label));
  return box;
}

function render() {
  const now = new Date();
  const rows = sortedItems(now);
  renderKey = computeRenderKey(now);

  listEl.replaceChildren();
  emptyEl.hidden = rows.length > 0;

  for (const { item, info } of rows) {
    const li = el('li', 'card');
    li.style.setProperty('--c', item.color || COLORS[0]);
    li.dataset.id = item.id;
    li.tabIndex = 0;
    if (info.past) li.classList.add('past');
    if (info.isToday) li.classList.add('today');

    const head = el('div', 'card-head');
    const textWrap = el('div');
    const title = el('h3', 'card-title', item.title);
    if (info.past && !item.yearly) title.append(el('span', 'badge', 'done'));
    if (item.yearly) title.append(el('span', 'badge', info.occurrence ? ordinal(info.occurrence) : 'yearly'));
    let dateLine = fmtDate.format(info.moment);
    if (item.time) dateLine += ` · ${fmtTime.format(info.moment)}`;
    textWrap.append(title, el('div', 'card-date', dateLine));
    head.append(el('div', 'card-emoji', item.emoji || '⏳'), textWrap);

    const big = el('div', 'card-big');
    const bt = bigText(info);
    big.append(el('span', 'num', bt.num), el('span', 'unit', bt.unit));

    li.append(head, big);

    const { years, months, days } = info.diff;
    if (years > 0 || months > 0) {
      const units = el('div', 'units');
      units.append(
        unitBox(years, years === 1 ? 'year' : 'years'),
        unitBox(months, months === 1 ? 'month' : 'months'),
        unitBox(days, days === 1 ? 'day' : 'days'),
        unitBox(Math.floor(Math.abs(info.dayDelta) / 7), 'weeks'),
      );
      li.append(units);
    }

    const live = el('div', 'card-extra live', liveText(info, now));
    li.append(live);

    const progress = el('div', 'progress');
    const bar = el('div');
    bar.style.width = `${(info.progress * 100).toFixed(2)}%`;
    progress.append(bar);
    progress.title = `${Math.round(info.progress * 100)}% of the way there`;
    li.append(progress);

    listEl.append(li);
  }
}

// Anything that changes the card layout (day rollover, an event passing)
// triggers a full re-render; otherwise we only update the ticking text.
function computeRenderKey(now) {
  return dayNum(todayDate(now)) + '|' + items.map((i) => describe(i, now).past).join(',');
}

function tick() {
  const now = new Date();
  if (computeRenderKey(now) !== renderKey) {
    render();
    return;
  }
  for (const li of listEl.children) {
    const item = items.find((i) => i.id === li.dataset.id);
    if (!item) continue;
    const info = describe(item, now);
    li.querySelector('.live').textContent = liveText(info, now);
    li.querySelector('.progress > div').style.width = `${(info.progress * 100).toFixed(2)}%`;
  }
}

// ---------- Editor ----------

const editor = document.getElementById('editor');
const form = document.getElementById('editorForm');
const swatchesEl = document.getElementById('swatches');
const deleteBtn = document.getElementById('deleteBtn');
let editingId = null;
let chosenColor = COLORS[0];

function renderSwatches() {
  swatchesEl.replaceChildren();
  for (const c of COLORS) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.style.background = c;
    b.setAttribute('aria-label', `Colour ${c}`);
    b.setAttribute('aria-pressed', String(c === chosenColor));
    b.addEventListener('click', () => {
      chosenColor = c;
      renderSwatches();
    });
    swatchesEl.append(b);
  }
}

function openEditor(item) {
  editingId = item ? item.id : null;
  document.getElementById('editorTitle').textContent = item ? 'Edit countdown' : 'New countdown';
  form.elements.title.value = item ? item.title : '';
  form.elements.date.value = item ? item.date : '';
  form.elements.time.value = item ? item.time || '' : '';
  form.elements.emoji.value = item ? item.emoji || '' : '';
  form.elements.yearly.checked = item ? !!item.yearly : false;
  chosenColor = item ? item.color || COLORS[0] : COLORS[items.length % COLORS.length];
  deleteBtn.hidden = !item;
  renderSwatches();
  editor.showModal();
  if (!item) form.elements.title.focus();
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: form.elements.title.value.trim(),
    date: form.elements.date.value,
    time: form.elements.time.value,
    emoji: form.elements.emoji.value.trim(),
    color: chosenColor,
    yearly: form.elements.yearly.checked,
  };
  if (!data.title || !data.date) return;

  if (editingId) {
    const idx = items.findIndex((i) => i.id === editingId);
    if (idx >= 0) items[idx] = { ...items[idx], ...data };
  } else {
    items.push({ id: newId(), created: new Date().toISOString(), ...data });
  }
  saveItems();
  editor.close();
  render();
});

document.getElementById('cancelBtn').addEventListener('click', () => editor.close());

deleteBtn.addEventListener('click', () => {
  const item = items.find((i) => i.id === editingId);
  if (!item || !confirm(`Delete "${item.title}"?`)) return;
  items = items.filter((i) => i.id !== editingId);
  saveItems();
  editor.close();
  render();
});

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

document.getElementById('addBtn').addEventListener('click', () => openEditor(null));

listEl.addEventListener('click', (e) => {
  const li = e.target.closest('.card');
  if (!li) return;
  const item = items.find((i) => i.id === li.dataset.id);
  if (item) openEditor(item);
});

listEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) e.target.click();
});

// ---------- Menu: backup & sort ----------

const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('menu');
const importFile = document.getElementById('importFile');

function updateSortLabel() {
  document.getElementById('sortLabel').textContent = sortMode === 'name' ? 'name' : 'soonest';
}

menuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', () => { menu.hidden = true; });

menu.addEventListener('click', (e) => {
  const action = e.target.closest('button')?.dataset.action;
  if (action === 'export') exportBackup();
  if (action === 'import') importFile.click();
  if (action === 'sort') {
    sortMode = sortMode === 'soonest' ? 'name' : 'soonest';
    localStorage.setItem(SORT_KEY, sortMode);
    updateSortLabel();
    render();
  }
});

function exportBackup() {
  const blob = new Blob([JSON.stringify({ version: 1, items }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `countdowns-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

importFile.addEventListener('change', async () => {
  const file = importFile.files[0];
  importFile.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = (Array.isArray(parsed) ? parsed : parsed.items || [])
      .filter((i) => i && typeof i.title === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.date));
    const known = new Set(items.map((i) => i.id));
    const added = incoming.filter((i) => !known.has(i.id)).map((i) => ({ ...i, id: i.id || newId() }));
    items.push(...added);
    saveItems();
    render();
    alert(`Imported ${added.length} countdown${added.length === 1 ? '' : 's'}.`);
  } catch {
    alert('That file is not a valid countdown backup.');
  }
});

// ---------- Start ----------

updateSortLabel();
render();
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});

// Keep in sync if the app is open in two tabs.
window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEY) {
    items = loadItems();
    render();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
