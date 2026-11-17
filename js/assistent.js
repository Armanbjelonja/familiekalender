// Assistenten nederst på skærmen: mikrofon, tekstfelt, svar og oplæsning.
// Selve Claude-kaldet sker på serveren (store.spoerg → edge function).

import { store } from './store.js';

const $ = (s) => document.querySelector(s);
const GLEM_EFTER_MS = 3 * 60 * 1000; // en samtale glemmes efter 3 minutters stilhed

let historik = [];
let sidstAktiv = 0;
let optager = null;
let travl = false;

// ---------- Oplæsning (dansk stemme) ----------

function danskStemme() {
  const stemmer = speechSynthesis.getVoices().filter((s) => s.lang.toLowerCase().startsWith('da'));
  return stemmer.find((s) => s.localService) || stemmer[0] || null;
}

function laesHoejt(tekst) {
  if (!('speechSynthesis' in window) || !tekst) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(tekst);
  u.lang = 'da-DK';
  const stemme = danskStemme();
  if (stemme) u.voice = stemme;
  speechSynthesis.speak(u);
}

// iPhone/iPad tillader kun oplæsning, der er sat i gang af et tryk.
// Et tomt "ord" ved trykket låser op, så svaret må læses højt lidt senere.
function laasOplaesningOp() {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  speechSynthesis.speak(new SpeechSynthesisUtterance(''));
}

// ---------- Svarboks ----------

function visSvar(tekst, { fejl = false, venter = false } = {}) {
  $('#assvartekst').textContent = tekst;
  $('#assvar').hidden = false;
  $('#assvar').classList.toggle('fejl', fejl);
  $('#assvar').classList.toggle('venter', venter);
  $('#aslaes').hidden = fejl || venter;
}

async function send(tekst) {
  tekst = tekst.trim();
  if (!tekst || travl) return;
  travl = true;
  $('#astekst').value = '';
  if (Date.now() - sidstAktiv > GLEM_EFTER_MS) historik = [];
  visSvar(`“${tekst}” …`, { venter: true });
  try {
    const svar = await store.spoerg(tekst, historik);
    historik.push({ role: 'user', content: tekst }, { role: 'assistant', content: svar });
    historik = historik.slice(-8);
    sidstAktiv = Date.now();
    visSvar(svar);
    laesHoejt(svar);
  } catch (f) {
    visSvar(f.message, { fejl: true });
  } finally {
    travl = false;
  }
}

// ---------- Mikrofon (browserens talegenkendelse) ----------

function startMikrofon() {
  const Genkendelse = window.SpeechRecognition || window.webkitSpeechRecognition;
  const knap = $('#mikrofon');
  if (optager) {
    optager.stop();
    return;
  }
  const g = new Genkendelse();
  g.lang = 'da-DK';
  g.interimResults = true;
  g.continuous = false;
  let endelig = '';
  g.onresult = (e) => {
    let tekst = '';
    for (const r of e.results) tekst += r[0].transcript;
    $('#astekst').value = tekst;
    if (e.results[e.results.length - 1].isFinal) endelig = tekst;
  };
  g.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      visSvar('Mikrofonen er ikke tilladt. Brug mikrofonen på tastaturet i stedet, eller giv siden adgang i indstillingerne.', { fejl: true });
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      visSvar('Jeg kunne ikke høre dig. Prøv igen, eller skriv i feltet.', { fejl: true });
    }
  };
  g.onend = () => {
    optager = null;
    knap.classList.remove('lytter');
    const tekst = endelig || $('#astekst').value;
    if (tekst.trim()) send(tekst);
  };
  optager = g;
  knap.classList.add('lytter');
  try {
    g.start();
  } catch {
    optager = null;
    knap.classList.remove('lytter');
  }
}

// ---------- Start ----------

export function startAssistent() {
  if (store.demo) return;
  $('#assistent').hidden = false;
  if (window.SpeechRecognition || window.webkitSpeechRecognition) $('#mikrofon').hidden = false;
  // Stemmelisten hentes først, når nogen spørger efter den
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  $('#asform').addEventListener('submit', (e) => {
    e.preventDefault();
    laasOplaesningOp();
    send($('#astekst').value);
  });
  $('#mikrofon').addEventListener('click', () => {
    laasOplaesningOp();
    startMikrofon();
  });
  $('#aslaes').addEventListener('click', () => laesHoejt($('#assvartekst').textContent));
  $('#asluk').addEventListener('click', () => {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('#assvar').hidden = true;
  });
}
