// Familiekalenderens assistent (Supabase Edge Function).
//
// Modtager en sætning på dansk og lader Claude oprette, rette, slette eller slå aftaler op.
// Claude API-nøglen ligger KUN her på serveren som hemmeligheden ANTHROPIC_API_KEY.
//
// To måder at kalde på:
//   1) Fra appen:        Authorization: Bearer <login-token>,  krop: { tekst, historik? }
//   2) Fra Siri-genvej:  krop: { tekst, token }   (personligt token fra tabellen "tokens")
// Svar: { svar: "…", aendret: true|false }   – eller { fejl: "…" } ved fejl.
//
// Funktionen tjekker selv adgangen, så "Verify JWT" skal være slået FRA i Supabase.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-opus-5-5";
const TIDSZONE = "Europe/Copenhagen";
const MAKS_TEKST = 1000;
const MAKS_RUNDER = 8;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(krop: unknown, status = 200): Response {
  return new Response(JSON.stringify(krop), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------- Tid: Claude regner i dansk tid, databasen gemmer UTC ----------

const DATO = /^\d{4}-\d{2}-\d{2}$/;
const TID = /^\d{1,2}:\d{2}$/;

function danskeDele(utcMs: number): Record<string, number> {
  const dele = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIDSZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const ud: Record<string, number> = {};
  for (const d of dele) if (d.type !== "literal") ud[d.type] = Number(d.value);
  return ud;
}

// Hvor mange ms dansk tid er foran UTC på tidspunktet (sommer-/vintertid)
function forskydning(utcMs: number): number {
  const d = danskeDele(utcMs);
  return Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute, d.second) - Math.floor(utcMs / 1000) * 1000;
}

function danskTilUtc(dato: string, tid = "00:00"): Date {
  const [aar, md, dag] = dato.split("-").map(Number);
  const [t, m] = tid.split(":").map(Number);
  const lokal = Date.UTC(aar, md - 1, dag, t, m);
  const gaet = lokal - forskydning(lokal);
  return new Date(lokal - forskydning(gaet));
}

function utcTilDansk(iso: string): { dato: string; tid: string } {
  const d = danskeDele(new Date(iso).getTime());
  const to = (n: number) => String(n).padStart(2, "0");
  return { dato: `${d.year}-${to(d.month)}-${to(d.day)}`, tid: `${to(d.hour)}:${to(d.minute)}` };
}

function plusDage(dato: string, n: number): string {
  const [aar, md, dag] = dato.split("-").map(Number);
  return new Date(Date.UTC(aar, md - 1, dag + n)).toISOString().slice(0, 10);
}

function nuTekst(): string {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: TIDSZONE, weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date());
}

// ---------- Værktøjer, som Claude kan bruge ----------

const TIDSFELTER = {
  dato: { type: "string", description: "Startdato i dansk tid, ÅÅÅÅ-MM-DD." },
  start_tid: { type: "string", description: "Starttid TT:MM i dansk tid. Udelades ved heldagsaftaler." },
  slut_dato: { type: "string", description: "Slutdato ÅÅÅÅ-MM-DD (sidste dag, inklusive). Udelades, hvis den er samme dag som start." },
  slut_tid: { type: "string", description: "Sluttid TT:MM. Udelades den, varer aftalen en time." },
};
const OEVRIGE_FELTER = {
  personer: {
    type: "array", items: { type: "string" },
    description: "Navne på de personer, aftalen gælder, præcis som i listen over familien. Tom liste = hele familien.",
  },
  sted: { type: "string", description: "Sted, hvis det er nævnt." },
  note: { type: "string", description: "Ekstra oplysninger, hvis der er nogen." },
};

const VAERKTOEJER = [
  {
    name: "hent_aftaler",
    description:
      "Henter alle aftaler i et datointerval (begge dage inklusive). Brug den, før du svarer på spørgsmål om kalenderen, og for at finde id på en aftale, der skal rettes eller slettes.",
    input_schema: {
      type: "object" as const,
      properties: {
        fra_dato: { type: "string", description: "Første dag, ÅÅÅÅ-MM-DD." },
        til_dato: { type: "string", description: "Sidste dag, ÅÅÅÅ-MM-DD." },
      },
      required: ["fra_dato", "til_dato"],
    },
  },
  {
    name: "opret_aftale",
    description: "Opretter en ny aftale i kalenderen. Uden start_tid bliver det en heldagsaftale.",
    input_schema: {
      type: "object" as const,
      properties: { titel: { type: "string", description: "Kort titel, fx 'Tandlæge'." }, ...TIDSFELTER, ...OEVRIGE_FELTER },
      required: ["titel", "dato", "personer"],
    },
  },
  {
    name: "ret_aftale",
    description:
      "Retter en eksisterende aftale. Send kun de felter, der skal ændres. Skal tidspunktet ændres, så send dato og de tidsfelter, der gælder bagefter (uden start_tid bliver det en heldagsaftale).",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Aftalens id fra hent_aftaler." },
        titel: { type: "string" },
        ...TIDSFELTER,
        ...OEVRIGE_FELTER,
      },
      required: ["id"],
    },
  },
  {
    name: "slet_aftale",
    description: "Sletter en aftale. Brug kun, når brugeren tydeligt har bedt om det, og det er entydigt hvilken aftale.",
    input_schema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Aftalens id fra hent_aftaler." } },
      required: ["id"],
    },
  },
];

type Person = { id: string; navn: string };
// deno-lint-ignore no-explicit-any
type Kontekst = { db: any; personer: Person[]; aendret: boolean };
// deno-lint-ignore no-explicit-any
type Ind = Record<string, any>;

function tiderFra(ind: Ind) {
  if (!DATO.test(ind.dato ?? "")) throw new Error("dato skal have formen ÅÅÅÅ-MM-DD");
  const slutDato = ind.slut_dato ?? ind.dato;
  if (!DATO.test(slutDato)) throw new Error("slut_dato skal have formen ÅÅÅÅ-MM-DD");
  for (const felt of ["start_tid", "slut_tid"]) {
    if (ind[felt] != null && !TID.test(ind[felt])) throw new Error(`${felt} skal have formen TT:MM`);
  }
  if (!ind.start_tid) {
    const start = danskTilUtc(ind.dato);
    const slut = danskTilUtc(plusDage(slutDato, 1));
    if (slut <= start) throw new Error("slut_dato må ikke ligge før dato");
    return { start, slut, heldags: true };
  }
  const start = danskTilUtc(ind.dato, ind.start_tid);
  const slut = ind.slut_tid ? danskTilUtc(slutDato, ind.slut_tid) : new Date(start.getTime() + 3600_000);
  if (slut <= start) throw new Error("sluttidspunktet skal ligge efter starttidspunktet");
  return { start, slut, heldags: false };
}

function personIds(navne: unknown, k: Kontekst): string[] {
  if (!Array.isArray(navne)) throw new Error("personer skal være en liste af navne");
  return navne.map((navn) => {
    const fundet = k.personer.find((p) => p.navn.toLowerCase() === String(navn).trim().toLowerCase());
    if (!fundet) {
      throw new Error(`Ukendt person: "${navn}". Familien består af: ${k.personer.map((p) => p.navn).join(", ")}`);
    }
    return fundet.id;
  });
}

function tekstfelt(v: unknown, maks: number): string {
  return String(v ?? "").trim().slice(0, maks);
}

async function udfoer(navn: string, ind: Ind, k: Kontekst): Promise<string> {
  if (navn === "hent_aftaler") {
    if (!DATO.test(ind.fra_dato ?? "") || !DATO.test(ind.til_dato ?? "")) throw new Error("Datoer skal have formen ÅÅÅÅ-MM-DD");
    const fra = danskTilUtc(ind.fra_dato);
    const til = danskTilUtc(plusDage(ind.til_dato, 1));
    const { data, error } = await k.db.from("aftaler")
      .select("id, titel, start, slut, heldags, person_ids, sted, note")
      .lt("start", til.toISOString()).gt("slut", fra.toISOString())
      .order("start").limit(100);
    if (error) throw new Error(error.message);
    // deno-lint-ignore no-explicit-any
    const liste = data.map((a: any) => {
      const s = utcTilDansk(a.start);
      // Heldags gemmes med slut = midnat dagen efter; vis den sidste dag
      const e = utcTilDansk(a.heldags ? new Date(new Date(a.slut).getTime() - 1000).toISOString() : a.slut);
      return {
        id: a.id,
        titel: a.titel,
        start: a.heldags ? s.dato : `${s.dato} ${s.tid}`,
        slut: a.heldags ? e.dato : `${e.dato} ${e.tid}`,
        heldags: a.heldags,
        personer: a.person_ids.length
          ? a.person_ids.map((id: string) => k.personer.find((p) => p.id === id)?.navn ?? "ukendt")
          : "hele familien",
        ...(a.sted ? { sted: a.sted } : {}),
        ...(a.note ? { note: a.note } : {}),
      };
    });
    return JSON.stringify(liste);
  }

  if (navn === "opret_aftale") {
    const titel = tekstfelt(ind.titel, 200);
    if (!titel) throw new Error("titel mangler");
    const t = tiderFra(ind);
    const { data, error } = await k.db.from("aftaler").insert({
      titel,
      start: t.start.toISOString(),
      slut: t.slut.toISOString(),
      heldags: t.heldags,
      person_ids: personIds(ind.personer ?? [], k),
      sted: tekstfelt(ind.sted, 200),
      note: tekstfelt(ind.note, 2000),
    }).select("id").single();
    if (error) throw new Error(error.message);
    k.aendret = true;
    return JSON.stringify({ ok: true, id: data.id });
  }

  if (navn === "ret_aftale") {
    // deno-lint-ignore no-explicit-any
    const felter: Record<string, any> = {};
    if (ind.titel != null) {
      felter.titel = tekstfelt(ind.titel, 200);
      if (!felter.titel) throw new Error("titel må ikke være tom");
    }
    if (ind.dato != null) {
      const t = tiderFra(ind);
      felter.start = t.start.toISOString();
      felter.slut = t.slut.toISOString();
      felter.heldags = t.heldags;
    } else if (ind.start_tid != null || ind.slut_tid != null || ind.slut_dato != null) {
      throw new Error("Send også dato, når tidspunktet skal ændres");
    }
    if (ind.personer != null) felter.person_ids = personIds(ind.personer, k);
    if (ind.sted != null) felter.sted = tekstfelt(ind.sted, 200);
    if (ind.note != null) felter.note = tekstfelt(ind.note, 2000);
    if (!Object.keys(felter).length) throw new Error("Ingen felter at rette");
    const { data, error } = await k.db.from("aftaler").update(felter).eq("id", String(ind.id)).select("id");
    if (error) throw new Error(error.message);
    if (!data.length) throw new Error("Der findes ingen aftale med det id");
    k.aendret = true;
    return JSON.stringify({ ok: true });
  }

  if (navn === "slet_aftale") {
    const { data, error } = await k.db.from("aftaler").delete().eq("id", String(ind.id)).select("id");
    if (error) throw new Error(error.message);
    if (!data.length) throw new Error("Der findes ingen aftale med det id");
    k.aendret = true;
    return JSON.stringify({ ok: true });
  }

  throw new Error(`Ukendt værktøj: ${navn}`);
}

// ---------- Samtalen med Claude ----------

function systemprompt(personer: Person[], taler: string | null): string {
  return `Du er familiens kalenderassistent. Du passer en fælles kalender for en husstand ved hjælp af værktøjerne.

Lige nu er det ${nuTekst()} (dansk tid). Ugen starter mandag, og weekend er lørdag og søndag.
Familien består af: ${personer.map((p) => p.navn).join(", ")}.
${taler ? `Den, der taler, er ${taler}.` : "Du ved ikke, hvem der taler – kalenderen bruges fra en fælles skærm i køkkenet."}

Sådan arbejder du:
- Opret aftalen med det samme, når dag, tidspunkt og person fremgår. "Torsdag" betyder den førstkommende torsdag.
- Mangler der noget, du ikke kan gætte fornuftigt – hvilken dag, hvem aftalen gælder, eller klokkeslæt for noget, der tydeligt har et – så stil ét kort spørgsmål i stedet for at oprette noget.
- "Vi", "alle" og "familien" betyder hele familien, altså en tom personliste. Nævnes ingen person, og ved du hvem der taler, gælder aftalen den person. Ved du det ikke, så spørg, hvem aftalen er for.
- Uden sluttidspunkt varer en aftale en time. Ting uden naturligt klokkeslæt, som fødselsdage og ferier, er heldagsaftaler.
- Slå altid op med hent_aftaler, før du svarer på spørgsmål om kalenderen, og før du retter eller sletter. Er det uklart, hvilken aftale der menes, så spørg.
- Tidligere svar i samtalen vises uden de værktøjskald, der lå bag dem. De byggede på rigtige opslag, så dem skal du hverken undskylde for, rette eller kommentere. Kalenderen kan være ændret siden, så slå bare op igen, når du skal bruge den.
- Svar kun på det, der bliver spurgt om eller bedt om lige nu. Nævn ikke andre aftaler, end spørgsmålet handler om.
- Dit svar bliver læst højt. Svar derfor kort, på dansk og i almindeligt talesprog: ingen lister, ingen markdown, ingen id'er. Sig klokkeslæt som "klokken 15" og datoer som "torsdag den 19."
- Bekræft kort, hvad du har gjort, for eksempel: "Tandlæge for Person 2 er sat ind torsdag klokken 15."
- Du hjælper kun med kalenderen.`;
}

// deno-lint-ignore no-explicit-any
function rensHistorik(raa: unknown): any[] {
  if (!Array.isArray(raa)) return [];
  return raa.slice(-10)
    .filter((b) => b && (b.role === "user" || b.role === "assistant") && typeof b.content === "string" && b.content.trim())
    .map((b) => ({ role: b.role, content: b.content.slice(0, MAKS_TEKST) }));
}

async function samtale(tekst: string, historik: unknown, taler: string | null, k: Kontekst): Promise<string> {
  const claude = new Anthropic(); // læser ANTHROPIC_API_KEY fra funktionens hemmeligheder
  const messages: Anthropic.Beta.BetaMessageParam[] = [...rensHistorik(historik), { role: "user", content: tekst }];
  const system = systemprompt(k.personer, taler);

  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    const r = await claude.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: "low" }, // korte, enkle opgaver – hurtigt og billigt
      // Afviser modellen en forespørgsel, prøver API'et selv en anden model
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      tools: VAERKTOEJER,
      messages,
    });

    if (r.stop_reason === "refusal") return "Det kan jeg desværre ikke hjælpe med.";

    if (r.stop_reason !== "tool_use") {
      const svar = r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return svar || "Jeg fik ikke noget svar. Prøv at sige det på en anden måde.";
    }

    messages.push({ role: "assistant", content: r.content });
    const resultater: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const blok of r.content) {
      if (blok.type !== "tool_use") continue;
      try {
        resultater.push({ type: "tool_result", tool_use_id: blok.id, content: await udfoer(blok.name, blok.input as Ind, k) });
      } catch (fejl) {
        resultater.push({ type: "tool_result", tool_use_id: blok.id, content: (fejl as Error).message, is_error: true });
      }
    }
    messages.push({ role: "user", content: resultater });
  }
  return "Det blev for indviklet for mig. Prøv at dele det op i mindre bidder.";
}

// ---------- Indgang ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ fejl: "Brug POST." }, 405);

  // deno-lint-ignore no-explicit-any
  let krop: any;
  try {
    krop = await req.json();
  } catch {
    return json({ fejl: "Kroppen skal være JSON." }, 400);
  }
  const tekst = typeof krop?.tekst === "string" ? krop.tekst.trim() : "";
  if (!tekst) return json({ fejl: "Feltet 'tekst' mangler." }, 400);
  if (tekst.length > MAKS_TEKST) return json({ fejl: "Teksten er for lang." }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const noegle = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !noegle) return json({ fejl: "Funktionen mangler adgang til databasen." }, 500);
  const db = createClient(url, noegle, { auth: { persistSession: false, autoRefreshToken: false } });

  // Hvem kalder? Enten et personligt token (Siri) eller familiens login (appen).
  let talerId: string | null = null;
  if (typeof krop.token === "string" && krop.token) {
    const { data } = await db.from("tokens").select("person_id").eq("token", krop.token).maybeSingle();
    if (!data) return json({ fejl: "Ugyldigt token." }, 401);
    talerId = data.person_id;
  } else {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: bruger } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
    if (!bruger?.user) return json({ fejl: "Du er ikke logget ind." }, 401);
    const { data: medlem } = await db.from("medlemmer").select("person_id").eq("bruger_id", bruger.user.id).maybeSingle();
    if (!medlem) return json({ fejl: "Dette login er ikke knyttet til familien." }, 403);
    talerId = medlem.person_id;
  }

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    return json({ fejl: "Claude API-nøglen mangler i Supabase (hemmeligheden ANTHROPIC_API_KEY)." }, 500);
  }

  const { data: personer, error } = await db.from("personer").select("id, navn").order("sortering");
  if (error) return json({ fejl: "Kunne ikke læse familien fra databasen." }, 500);

  const k: Kontekst = { db, personer, aendret: false };
  const taler = personer.find((p: Person) => p.id === talerId)?.navn ?? null;

  try {
    const svar = await samtale(tekst, krop.historik, taler, k);
    return json({ svar, aendret: k.aendret });
  } catch (fejl) {
    console.error("Claude-fejl:", fejl);
    if (fejl instanceof Anthropic.AuthenticationError) {
      return json({ fejl: "Claude API-nøglen er ugyldig. Tjek ANTHROPIC_API_KEY i Supabase." }, 500);
    }
    if (fejl instanceof Anthropic.PermissionDeniedError) {
      return json({ fejl: "Claude API-nøglen har ikke adgang til modellen." }, 500);
    }
    if (fejl instanceof Anthropic.RateLimitError) {
      return json({ fejl: "Der er for travlt lige nu. Prøv igen om lidt." }, 503);
    }
    if (fejl instanceof Anthropic.BadRequestError) {
      return json({ fejl: "Claude afviste forespørgslen: " + fejl.message }, 500);
    }
    if (fejl instanceof Anthropic.APIError) {
      return json({ fejl: `Claude svarede med en fejl (${fejl.status ?? "ukendt"}). Prøv igen.` }, 502);
    }
    return json({ fejl: "Noget gik galt hos assistenten. Prøv igen." }, 500);
  }
});
