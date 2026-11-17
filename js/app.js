import { store } from './store.js';
import * as D from './dato.js';
import { startAssistent } from './assistent.js';

const FAMILIE_FARVE = '#5c677d';
const TIME_PX = 52; // højden af én time i dagsvisningen

const $ = (s) => document.querySelector(s);

// Lille hjælper til at bygge DOM uden innerHTML (så tekst aldrig tolkes som HTML)
function h(tag, attrs = {}, ...boern) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...boern.flat().filter((b) => b != null && b !== false));
  return e;
}

const tilstand = {
  visning: localStorage.getItem('visning') || (innerWidth < 700 ? 'dag' : 'uge'),
  dato: new Date(),
  skjulte: new Set(),
};

let aftaler = []; // med start/slut som Date

function genindlaes() {
  aftaler = store.alle().map((a) => ({ ...a, start: new Date(a.start), slut: new Date(a.slut) }));
  tegn();
}

// ---------- Hjælpere til aftaler ----------

const person = (id) => store.personer.find((p) => p.id === id);

function farver(a) {
  const f = a.person_ids.map((id) => person(id)?.farve).filter(Boolean);
  return f.length ? f : [FAMILIE_FARVE];
}

function stribe(f) {
  if (f.length === 1) return f[0];
  const trin = 100 / f.length;
  return `linear-gradient(${f.map((c, i) => `${c} ${i * trin}% ${(i + 1) * trin}%`).join(', ')})`;
}

function hvem(a) {
  const navne = a.person_ids.map((id) => person(id)?.navn).filter(Boolean);
  return navne.length ? navne.join(', ') : 'Hele familien';
}

function erSynlig(a) {
  return a.person_ids.length === 0 || a.person_ids.some((id) => !tilstand.skjulte.has(id));
}

function aftalerPaaDag(dag) {
  const fra = D.startAfDag(dag);
  const til = D.plusDage(fra, 1);
  return aftaler
    .filter((a) => erSynlig(a) && a.start < til && a.slut > fra)
    .sort((a, b) => b.heldags - a.heldags || a.start - b.start || a.titel.localeCompare(b.titel, 'da'));
}

function tidTekst(a, dag) {
  if (a.heldags) return '';
  const fra = D.startAfDag(dag);
  const til = D.plusDage(fra, 1);
  const start = a.start >= fra ? D.kl(a.start) : '…';
  const slut = a.slut <= til ? D.kl(a.slut) : '…';
  return `${start}–${slut}`;
}

function aftaleStil(a) {
  const f = farver(a);
  return `--farve:${f[0]};--stribe:${stribe(f)}`;
}

function chip(a, dag, { kort = false } = {}) {
  const starterIdag = a.start >= D.startAfDag(dag);
  const tid = a.heldags ? '' : kort ? (starterIdag ? D.kl(a.start) : '…') : tidTekst(a, dag);
  return h(
    'button',
    {
      class: 'aftale' + (a.heldags ? ' heldags' : ''),
      style: aftaleStil(a),
      title: `${a.titel} · ${hvem(a)}`,
      onclick: (e) => {
        e.stopPropagation();
        aabnDialog(a);
      },
    },
    tid && h('span', { class: 'tid' }, tid),
    h('span', { class: 'tekst' }, a.titel),
    !kort && h('span', { class: 'hvem-tekst' }, hvem(a) + (a.sted ? ` · ${a.sted}` : '')),
  );
}

// ---------- Visninger ----------

function tegnMaaned(rod) {
  const idag = new Date();
  const foerste = new Date(tilstand.dato.getFullYear(), tilstand.dato.getMonth(), 1);
  const start = D.mandag(foerste);
  const gitter = h('div', { class: 'maaned' });

  gitter.append(h('div', { class: 'hoved uge-nr' }, 'Uge'));
  for (let i = 0; i < 7; i++) gitter.append(h('div', { class: 'hoved' }, D.ugedagKort(D.plusDage(start, i))));

  for (let u = 0; u < 6; u++) {
    const ugestart = D.plusDage(start, u * 7);
    if (u > 3 && ugestart.getMonth() !== foerste.getMonth()) break;
    gitter.append(h('div', { class: 'uge-nr' }, String(D.ugenummer(ugestart))));
    for (let i = 0; i < 7; i++) {
      const dag = D.plusDage(ugestart, i);
      const liste = aftalerPaaDag(dag);
      const maks = 3;
      gitter.append(
        h(
          'div',
          {
            class:
              'celle' +
              (dag.getMonth() !== foerste.getMonth() ? ' anden' : '') +
              (D.sammeDag(dag, idag) ? ' idag' : ''),
            onclick: () => skift('dag', dag),
          },
          h('span', { class: 'dagnr' }, String(dag.getDate())),
          liste.slice(0, maks).map((a) => chip(a, dag, { kort: true })),
          liste.length > maks && h('span', { class: 'mere' }, `+${liste.length - maks} mere`),
        ),
      );
    }
  }
  rod.append(gitter);
}

function tegnUge(rod) {
  const idag = new Date();
  const start = D.mandag(tilstand.dato);
  const gitter = h('div', { class: 'uge' });
  for (let i = 0; i < 7; i++) {
    const dag = D.plusDage(start, i);
    const liste = aftalerPaaDag(dag);
    gitter.append(
      h(
        'section',
        { class: 'ugedag' + (D.sammeDag(dag, idag) ? ' idag' : '') },
        h(
          'button',
          { class: 'ugedag-hoved', onclick: () => skift('dag', dag), title: 'Vis dagen' },
          h('span', { class: 'navn' }, D.ugedagLang(dag)),
          h('span', { class: 'dagnr' }, D.dagMaaned(dag)),
        ),
        h(
          'div',
          { class: 'ugedag-liste', onclick: () => aabnDialog(null, dag) },
          liste.length ? liste.map((a) => chip(a, dag)) : h('span', { class: 'tom' }, 'Ingen aftaler'),
        ),
      ),
    );
  }
  rod.append(gitter);
}

// Fordeler overlappende aftaler i kolonner ved siden af hinanden
function fordel(blokke) {
  blokke.sort((a, b) => a.fra - b.fra || b.til - a.til);
  let klynge = [];
  let klyngeSlut = -1;
  const afslut = () => {
    const antal = Math.max(...klynge.map((b) => b.kol)) + 1;
    klynge.forEach((b) => (b.kols = antal));
    klynge = [];
    klyngeSlut = -1;
  };
  for (const b of blokke) {
    if (klynge.length && b.fra >= klyngeSlut) afslut();
    const optaget = new Set(klynge.filter((k) => k.til > b.fra).map((k) => k.kol));
    let kol = 0;
    while (optaget.has(kol)) kol++;
    b.kol = kol;
    klynge.push(b);
    klyngeSlut = Math.max(klyngeSlut, b.til);
  }
  if (klynge.length) afslut();
  return blokke;
}

function tegnDag(rod) {
  const dag = D.startAfDag(tilstand.dato);
  const naeste = D.plusDage(dag, 1);
  const liste = aftalerPaaDag(dag);
  const heldags = liste.filter((a) => a.heldags);
  const medTid = liste.filter((a) => !a.heldags);

  const blokke = fordel(
    medTid.map((a) => {
      const fra = Math.max(0, (a.start - dag) / 60000);
      const til = Math.min(1440, (a.slut - dag) / 60000);
      return { a, fra, til: Math.max(til, fra + 30) };
    }),
  );

  const linje = h(
    'div',
    {
      class: 'tidslinje',
      style: `height:${24 * TIME_PX}px`,
      onclick: (e) => {
        if (e.target.closest('.aftale')) return;
        const y = e.clientY - linje.getBoundingClientRect().top;
        const time = Math.min(23, Math.max(0, Math.floor(y / TIME_PX)));
        aabnDialog(null, new Date(dag.getFullYear(), dag.getMonth(), dag.getDate(), time));
      },
    },
    Array.from({ length: 24 }, (_, t) =>
      h('div', { class: 'time', style: `top:${t * TIME_PX}px` }, h('span', {}, `${String(t).padStart(2, '0')}:00`)),
    ),
    h(
      'div',
      { class: 'blokke' },
      blokke.map(({ a, fra, til, kol, kols }) => {
        const c = chip(a, dag);
        c.classList.add('blok');
        c.style.top = `${(fra / 60) * TIME_PX}px`;
        c.style.height = `${((til - fra) / 60) * TIME_PX - 2}px`;
        c.style.left = `${(kol / kols) * 100}%`;
        c.style.width = `calc(${100 / kols}% - 4px)`;
        return c;
      }),
    ),
  );

  const nu = new Date();
  if (nu >= dag && nu < naeste) {
    linje.append(h('div', { class: 'nu', style: `top:${((nu - dag) / 36e5) * TIME_PX}px` }));
  }

  const rulle = h('div', { class: 'dag-rulle' }, linje);
  rod.append(
    h(
      'div',
      { class: 'dagvisning' },
      heldags.length > 0 && h('div', { class: 'heldagsraekke' }, heldags.map((a) => chip(a, dag))),
      rulle,
    ),
  );
  // Start ved kl. 7 – eller en time før dagens første aftale, hvis den ligger tidligere
  const foerste = blokke.length ? Math.min(...blokke.map((b) => b.fra)) / 60 : 7;
  rulle.scrollTop = Math.max(0, Math.min(7, foerste - 1)) * TIME_PX;
}

function tegnPersoner() {
  const rod = $('#personer');
  rod.replaceChildren(
    ...store.personer.map((p) =>
      h(
        'button',
        {
          class: 'person' + (tilstand.skjulte.has(p.id) ? ' skjult' : ''),
          style: `--farve:${p.farve}`,
          'aria-pressed': String(!tilstand.skjulte.has(p.id)),
          onclick: () => {
            tilstand.skjulte.has(p.id) ? tilstand.skjulte.delete(p.id) : tilstand.skjulte.add(p.id);
            tegn();
          },
        },
        h('span', { class: 'prik' }),
        p.navn,
      ),
    ),
    h('span', { class: 'person fast', style: `--farve:${FAMILIE_FARVE}` }, h('span', { class: 'prik' }), 'Hele familien'),
  );
}

function tegn() {
  const { visning, dato } = tilstand;
  $('#titel').textContent =
    visning === 'dag' ? D.langDato(dato) : visning === 'uge' ? D.ugeTitel(dato) : D.maanedAar(dato);
  document.querySelectorAll('#visninger button').forEach((b) => {
    b.classList.toggle('aktiv', b.dataset.visning === visning);
  });
  tegnPersoner();
  const rod = $('#kalender');
  rod.replaceChildren();
  rod.className = 'vis-' + visning;
  ({ dag: tegnDag, uge: tegnUge, maaned: tegnMaaned })[visning](rod);
}

function skift(visning, dato) {
  tilstand.visning = visning;
  if (dato) tilstand.dato = dato;
  localStorage.setItem('visning', visning);
  tegn();
}

function flyt(retning) {
  const { visning, dato } = tilstand;
  tilstand.dato =
    visning === 'dag' ? D.plusDage(dato, retning) : visning === 'uge' ? D.plusDage(dato, 7 * retning) : D.plusMaaneder(dato, retning);
  tegn();
}

// ---------- Dialog: opret / ret / slet ----------

const dialog = $('#dialog');
const formular = $('#formular');
const felt = formular.elements;
let redigerer = null; // aftalen der rettes, eller null ved ny
let varighed = 36e5; // bruges til at flytte sluttid med, når starttid ændres

function visFejl(tekst) {
  $('#fejl').textContent = tekst || '';
  $('#fejl').hidden = !tekst;
}

function laesTider() {
  if (!felt.startdato.value) return null;
  const slutdato = felt.slutdato.value || felt.startdato.value;
  if (felt.heldags.checked) {
    return { start: D.fraFelter(felt.startdato.value), slut: D.plusDage(D.fraFelter(slutdato), 1) };
  }
  return {
    start: D.fraFelter(felt.startdato.value, felt.starttid.value || '12:00'),
    slut: D.fraFelter(slutdato, felt.sluttid.value || felt.starttid.value || '13:00'),
  };
}

function saetTider(start, slut, heldags) {
  felt.heldags.checked = heldags;
  felt.startdato.value = D.isoDato(start);
  // Heldags gemmes med slut = midnat dagen efter; i formularen vises den sidste dag
  felt.slutdato.value = D.isoDato(heldags ? D.plusDage(slut, -1) : slut);
  felt.starttid.value = heldags ? '12:00' : D.kl(start);
  felt.sluttid.value = heldags ? '13:00' : D.kl(slut);
  varighed = heldags ? 36e5 : slut - start;
  visTidsfelter();
}

function visTidsfelter() {
  formular.classList.toggle('er-heldags', felt.heldags.checked);
}

function aabnDialog(aftale, dag) {
  redigerer = aftale;
  visFejl('');
  $('#dialogtitel').textContent = aftale ? 'Ret aftale' : 'Ny aftale';
  $('#slet').hidden = !aftale;

  $('#hvem').replaceChildren(
    ...store.personer.map((p) =>
      h(
        'label',
        { class: 'tjek', style: `--farve:${p.farve}` },
        h('input', {
          type: 'checkbox',
          name: 'person',
          value: p.id,
          checked: aftale ? aftale.person_ids.includes(p.id) : false,
        }),
        h('span', { class: 'prik' }),
        p.navn,
      ),
    ),
  );

  if (aftale) {
    felt.titel.value = aftale.titel;
    felt.sted.value = aftale.sted || '';
    felt.note.value = aftale.note || '';
    saetTider(aftale.start, aftale.slut, aftale.heldags);
  } else {
    formular.reset();
    // Standard: den valgte dag, næste hele time (eller den time, man klikkede på)
    const basis = dag || tilstand.dato;
    const harTid = dag && (dag.getHours() || dag.getMinutes());
    const nu = new Date();
    const time = harTid ? dag.getHours() : D.sammeDag(basis, nu) ? Math.min(23, nu.getHours() + 1) : 12;
    const start = new Date(basis.getFullYear(), basis.getMonth(), basis.getDate(), time);
    saetTider(start, new Date(+start + 36e5), false);
  }

  dialog.showModal();
  if (!aftale) felt.titel.focus();
}

function startAendret() {
  if (felt.heldags.checked) {
    if (felt.slutdato.value < felt.startdato.value) felt.slutdato.value = felt.startdato.value;
    return;
  }
  if (!felt.startdato.value || !felt.starttid.value) return;
  const slut = new Date(+D.fraFelter(felt.startdato.value, felt.starttid.value) + varighed);
  felt.slutdato.value = D.isoDato(slut);
  felt.sluttid.value = D.kl(slut);
}

function slutAendret() {
  const t = laesTider();
  if (t && !felt.heldags.checked && t.slut > t.start) varighed = t.slut - t.start;
}

async function gem(e) {
  e.preventDefault();
  const titel = felt.titel.value.trim();
  if (!titel) return visFejl('Skriv en titel.');
  const t = laesTider();
  if (!t || isNaN(t.start) || isNaN(t.slut)) return visFejl('Vælg dato og tid.');
  if (t.slut <= t.start) return visFejl('Sluttidspunktet skal ligge efter starttidspunktet.');

  const aftale = {
    id: redigerer?.id,
    titel,
    start: t.start.toISOString(),
    slut: t.slut.toISOString(),
    heldags: felt.heldags.checked,
    person_ids: [...formular.querySelectorAll('input[name=person]:checked')].map((c) => c.value),
    sted: felt.sted.value.trim(),
    note: felt.note.value.trim(),
  };
  try {
    await store.gem(aftale);
    dialog.close();
  } catch (fejl) {
    visFejl('Aftalen kunne ikke gemmes: ' + fejl.message);
  }
}

async function slet() {
  if (!redigerer || !confirm(`Slet aftalen "${redigerer.titel}"?`)) return;
  try {
    await store.slet(redigerer.id);
    dialog.close();
  } catch (fejl) {
    visFejl('Aftalen kunne ikke slettes: ' + fejl.message);
  }
}

// ---------- Start ----------

$('#forrige').addEventListener('click', () => flyt(-1));
$('#naeste').addEventListener('click', () => flyt(1));
$('#idag').addEventListener('click', () => skift(tilstand.visning, new Date()));
$('#visninger').addEventListener('click', (e) => {
  const v = e.target.closest('button')?.dataset.visning;
  if (v) skift(v);
});
$('#ny').addEventListener('click', () => aabnDialog(null));
$('#annuller').addEventListener('click', () => dialog.close());
$('#slet').addEventListener('click', slet);
formular.addEventListener('submit', gem);
felt.heldags.addEventListener('change', visTidsfelter);
felt.startdato.addEventListener('change', startAendret);
felt.starttid.addEventListener('change', startAendret);
felt.slutdato.addEventListener('change', slutAendret);
felt.sluttid.addEventListener('change', slutAendret);
// Luk dialogen ved klik uden for den
dialog.addEventListener('click', (e) => {
  if (e.target === dialog) dialog.close();
});

// Viser loginskærmen og venter, til man er logget ind
function visLogin(fejltekst) {
  const login = $('#login');
  const form = $('#loginform');
  const fejl = $('#loginfejl');
  const saetFejl = (t) => {
    fejl.textContent = t || '';
    fejl.hidden = !t;
  };
  saetFejl(fejltekst);
  login.hidden = false;
  document.body.classList.add('laast');
  return new Promise((faerdig) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const knap = form.querySelector('button');
      knap.disabled = true;
      saetFejl('');
      try {
        await store.logInd(form.elements.email.value.trim(), form.elements.adgangskode.value);
        form.reset();
        login.hidden = true;
        document.body.classList.remove('laast');
        faerdig();
      } catch (f) {
        saetFejl(f.message);
      } finally {
        knap.disabled = false;
      }
    });
  });
}

let startfejl = '';
try {
  await store.init();
} catch (f) {
  startfejl = f.message;
}
if (!store.demo && !store.bruger) await visLogin(startfejl);
$('#demo').hidden = !store.demo;
$('#logud').hidden = store.demo;
$('#logud').addEventListener('click', () => store.logUd());
startAssistent();
store.lyt(genindlaes);
genindlaes();

// ---------- Vægskærm (iPad i køkkenet) ----------
// Stor skrift, mørkt tema om aftenen, skærmen holdes tændt, og kalenderen
// hopper selv tilbage til "i dag", når ingen har rørt den et stykke tid.

const MOERK_FRA = 20; // klokken 20 om aftenen …
const MOERK_TIL = 7; // … til klokken 7 om morgenen
const TILBAGE_EFTER_MS = 3 * 60 * 1000;

const rod = document.documentElement;
let vaeg = localStorage.getItem('vaeg') === '1';
let sidstRoert = Date.now();
let skaermlaas = null;

function saetTema() {
  const t = new Date().getHours();
  const moerk = vaeg ? t >= MOERK_FRA || t < MOERK_TIL : matchMedia('(prefers-color-scheme: dark)').matches;
  rod.dataset.tema = moerk ? 'moerk' : 'lys';
}

async function holdSkaermTaendt() {
  if (!vaeg) {
    skaermlaas?.release().catch(() => {});
    skaermlaas = null;
    return;
  }
  if (!('wakeLock' in navigator) || document.hidden) return;
  try {
    skaermlaas = await navigator.wakeLock.request('screen');
  } catch {
    // Ikke understøttet eller afvist – så styrer iPad'ens egen indstilling "Automatisk lås"
  }
}

function visUr() {
  $('#ur').hidden = !vaeg;
  if (vaeg) $('#ur').textContent = D.kl(new Date());
}

function saetVaeg(til) {
  vaeg = til;
  localStorage.setItem('vaeg', til ? '1' : '0');
  rod.classList.toggle('vaeg', til);
  $('#vaegknap').setAttribute('aria-pressed', String(til));
  saetTema();
  visUr();
  holdSkaermTaendt();
}

$('#vaegknap').addEventListener('click', () => {
  saetVaeg(!vaeg);
  tegn();
});
for (const h of ['pointerdown', 'keydown']) addEventListener(h, () => (sidstRoert = Date.now()), true);
document.addEventListener('visibilitychange', holdSkaermTaendt);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', saetTema);
saetVaeg(vaeg);

// Én gang i minuttet: ur, tema, "i dag"-markering og nu-linje
setInterval(() => {
  saetTema();
  visUr();
  const rolig = Date.now() - sidstRoert;
  if (dialog.open || rolig < 60 * 1000) return;
  if (vaeg && rolig > TILBAGE_EFTER_MS && !D.sammeDag(tilstand.dato, new Date())) tilstand.dato = new Date();
  // Hent en ny udgave af siden én gang i døgnet ved 4-tiden, så rettelser slår igennem af sig selv
  const idag = D.isoDato(new Date());
  if (vaeg && new Date().getHours() === 4 && localStorage.getItem('genindlaest') !== idag) {
    localStorage.setItem('genindlaest', idag);
    location.reload();
    return;
  }
  tegn();
}, 60 * 1000);
