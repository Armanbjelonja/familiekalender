// Datalag med to udgaver, der har samme funktioner (init, alle, gem, slet, lyt):
//  - Supabase: den rigtige kalender med login og realtime
//  - Demo: alt gemmes i browserens localStorage (åbn siden med ?demo i adressen)
//
// En aftale ser sådan ud:
//   { id, titel, start, slut, heldags, person_ids, sted, note }
// start/slut er ISO-tidspunkter. Ved heldagsaftaler er start midnat den første dag
// og slut midnat dagen EFTER den sidste dag. Tom person_ids = hele familien.

import { plusDage, startAfDag, mandag } from './dato.js';
import { SUPABASE_URL, SUPABASE_NOEGLE } from './config.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const brugDemo = !SUPABASE_URL || new URLSearchParams(location.search).has('demo');

const NOEGLE = 'familiekalender-demo-v1';

const PERSONER = [
  { id: 'p1', navn: 'Person 1', farve: '#2f6fde' },
  { id: 'p2', navn: 'Person 2', farve: '#d6336c' },
  { id: 'p3', navn: 'Person 3', farve: '#2b8a3e' },
  { id: 'p4', navn: 'Person 4', farve: '#e8590c' },
  { id: 'p5', navn: 'Person 5', farve: '#7048e8' },
];

let aftaler = [];
const lyttere = new Set();

const giv = () => lyttere.forEach((cb) => cb());
const gemLokalt = () => localStorage.setItem(NOEGLE, JSON.stringify(aftaler));

function eksempler() {
  const idag = startAfDag(new Date());
  const man = mandag(idag);
  const tid = (dag, t, m = 0) => new Date(dag.getFullYear(), dag.getMonth(), dag.getDate(), t, m).toISOString();
  const ny = (titel, start, slut, person_ids, ekstra = {}) => ({
    id: crypto.randomUUID(), titel, start, slut, heldags: false, person_ids, sted: '', note: '', ...ekstra,
  });
  return [
    ny('Tandlæge', tid(plusDage(man, 3), 15), tid(plusDage(man, 3), 16), ['p2'], { sted: 'Tandlægehuset' }),
    ny('Fodboldtræning', tid(plusDage(man, 1), 17), tid(plusDage(man, 1), 18, 30), ['p4']),
    ny('Svømning', tid(plusDage(man, 1), 17, 30), tid(plusDage(man, 1), 18, 30), ['p5']),
    ny('Forældremøde', tid(plusDage(man, 2), 19), tid(plusDage(man, 2), 20, 30), ['p1', 'p3'], { sted: 'Skolen' }),
    ny('Aftensmad hos farmor', tid(plusDage(man, 6), 18), tid(plusDage(man, 6), 20), []),
    ny('Weekendtur', plusDage(man, 11).toISOString(), plusDage(man, 14).toISOString(), [], { heldags: true }),
    ny('Fødselsdag', idag.toISOString(), plusDage(idag, 1).toISOString(), ['p3'], { heldags: true }),
  ];
}

const demoStore = {
  demo: true,
  personer: PERSONER,

  async init() {
    const raa = localStorage.getItem(NOEGLE);
    aftaler = raa ? JSON.parse(raa) : eksempler();
    if (!raa) gemLokalt();
    // Opdater, hvis kalenderen ændres i en anden fane
    addEventListener('storage', (e) => {
      if (e.key !== NOEGLE) return;
      aftaler = JSON.parse(e.newValue || '[]');
      giv();
    });
  },

  alle() {
    return aftaler;
  },

  async gem(aftale) {
    const a = { ...aftale, id: aftale.id || crypto.randomUUID() };
    const i = aftaler.findIndex((x) => x.id === a.id);
    if (i >= 0) aftaler[i] = a;
    else aftaler.push(a);
    gemLokalt();
    giv();
    return a;
  },

  async slet(id) {
    aftaler = aftaler.filter((x) => x.id !== id);
    gemLokalt();
    giv();
  },

  lyt(cb) {
    lyttere.add(cb);
  },
};

// ---------- Supabase ----------

const FELTER = 'id, titel, start, slut, heldags, person_ids, sted, note';
let sb = null;
let abonnerer = false;

function tjek({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const skyStore = {
  demo: false,
  personer: [],
  bruger: null,

  async init() {
    const { createClient } = await import(SUPABASE_JS);
    sb = createClient(SUPABASE_URL, SUPABASE_NOEGLE);
    const { data } = await sb.auth.getSession();
    this.bruger = data.session?.user || null;
    if (this.bruger) await this.hentAlt();
  },

  async logInd(email, adgangskode) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: adgangskode });
    if (error) throw new Error('Forkert e-mail eller adgangskode.');
    this.bruger = data.user;
    try {
      await this.hentAlt();
    } catch (fejl) {
      this.bruger = null;
      await sb.auth.signOut();
      throw fejl;
    }
  },

  async logUd() {
    await sb.auth.signOut();
    location.reload();
  },

  async hentAlt() {
    this.personer = tjek(await sb.from('personer').select('id, navn, farve').order('sortering'));
    // Adgangsreglerne giver en tom liste til logins, der ikke er knyttet til familien
    if (!this.personer.length) throw new Error('Dette login er ikke knyttet til familien endnu.');
    await this.hentAftaler();
    if (abonnerer) return;
    abonnerer = true;
    // Realtime: hent listen igen, hver gang nogen ændrer noget
    sb.channel('kalender')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'aftaler' }, () => this.genhent())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'personer' }, () => this.genhent(true))
      .subscribe();
    // iPhone/iPad sætter forbindelsen på pause i baggrunden – hent igen, når siden vises
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.genhent();
    });
    // Sikkerhedsnet for en skærm, der står tændt i dagevis: hent også hvert 5. minut
    setInterval(() => this.genhent(), 5 * 60 * 1000);
  },

  async hentAftaler() {
    aftaler = tjek(await sb.from('aftaler').select(FELTER).order('start'));
  },

  async genhent(ogsaaPersoner = false) {
    try {
      if (ogsaaPersoner) this.personer = tjek(await sb.from('personer').select('id, navn, farve').order('sortering'));
      const foer = JSON.stringify(aftaler);
      await this.hentAftaler();
      // Tegn kun om, når noget faktisk er ændret (ellers hopper rullepositionen)
      if (ogsaaPersoner || JSON.stringify(aftaler) !== foer) giv();
    } catch (fejl) {
      console.warn('Kunne ikke hente aftaler:', fejl.message);
    }
  },

  alle() {
    return aftaler;
  },

  // Sender en sætning til assistenten (edge function), som kalder Claude på serveren
  async spoerg(tekst, historik) {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('Du er ikke logget ind.');
    let svar;
    try {
      svar = await fetch(`${SUPABASE_URL}/functions/v1/assistent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_NOEGLE },
        body: JSON.stringify({ tekst, historik }),
      });
    } catch {
      throw new Error('Ingen forbindelse til assistenten.');
    }
    const krop = await svar.json().catch(() => null);
    if (!svar.ok || !krop?.svar) {
      throw new Error(krop?.fejl || (svar.status === 404 ? 'Assistenten er ikke sat op endnu.' : 'Assistenten svarede ikke.'));
    }
    if (krop.aendret) this.genhent();
    return krop.svar;
  },

  async gem(aftale) {
    const { id, ...felter } = aftale;
    const gemt = tjek(
      id
        ? await sb.from('aftaler').update(felter).eq('id', id).select(FELTER).single()
        : await sb.from('aftaler').insert(felter).select(FELTER).single(),
    );
    aftaler = [...aftaler.filter((x) => x.id !== gemt.id), gemt];
    giv();
    return gemt;
  },

  async slet(id) {
    tjek(await sb.from('aftaler').delete().eq('id', id));
    aftaler = aftaler.filter((x) => x.id !== id);
    giv();
  },

  lyt(cb) {
    lyttere.add(cb);
  },
};

export const store = brugDemo ? demoStore : skyStore;
