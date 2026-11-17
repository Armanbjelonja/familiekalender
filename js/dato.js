// Datohjælpere. Frontenden regner i enhedens lokale tid (familien er i Danmark);
// serverfunktionerne regner eksplicit i Europe/Copenhagen.

export const DAG_MS = 864e5;

const to = (n) => String(n).padStart(2, '0');
const fmt = (valg) => new Intl.DateTimeFormat('da-DK', valg);

export const startAfDag = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const plusDage = (d, n) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

export const plusMaaneder = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

// Ugen starter mandag
export const mandag = (d) => plusDage(startAfDag(d), -((d.getDay() + 6) % 7));

export const sammeDag = (a, b) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

// ISO 8601-ugenummer
export function ugenummer(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const ugedag = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - ugedag);
  const aarStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - aarStart) / DAG_MS + 1) / 7);
}

export const kl = (d) => `${to(d.getHours())}:${to(d.getMinutes())}`;
export const isoDato = (d) => `${d.getFullYear()}-${to(d.getMonth() + 1)}-${to(d.getDate())}`;
export const fraFelter = (dato, tid) => new Date(`${dato}T${tid || '00:00'}`);

const stort = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const langDato = (d) =>
  stort(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d));
export const maanedAar = (d) => stort(fmt({ month: 'long', year: 'numeric' }).format(d));
export const ugedagKort = (d) => stort(fmt({ weekday: 'short' }).format(d).replace('.', ''));
export const ugedagLang = (d) => stort(fmt({ weekday: 'long' }).format(d));
export const dagMaaned = (d) => fmt({ day: 'numeric', month: 'short' }).format(d);

export function ugeTitel(d) {
  const fra = mandag(d);
  const til = plusDage(fra, 6);
  const sammeMaaned = fra.getMonth() === til.getMonth();
  const start = sammeMaaned ? `${fra.getDate()}.` : fmt({ day: 'numeric', month: 'long' }).format(fra);
  const slut = fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(til);
  return `Uge ${ugenummer(fra)} · ${start}–${slut}`;
}
