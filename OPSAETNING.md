# Familiekalender – det skal du selv sætte op

Guiden udvides trin for trin. Lige nu er kun **Trin 2 (Supabase)** aktuelt.

## Afprøv kalenderen på pc'en (demo)

```bash
node tools/server.js
```

Åbn derefter http://localhost:5173 (rigtig kalender med login) eller
http://localhost:5173/?demo (demo, hvor aftalerne kun gemmes i browseren).

## Trin 2 – Supabase

**Status 17.11.2026:** punkt 1–3 og 7 er klaret. Projektet hedder "Kalender"
(`wvzjcsohknocjloysoss`), skemaet er kørt, og den offentlige nøgle ligger i `js/config.js`.
Senere samme dag: det fælles login er oprettet og knyttet til familien, ny tilmelding er
slået fra, og token-reglen er rettet. **Trin 2 er færdigt i Supabase.**

**Besluttet 17.11.2026: ét fælles familie-login** (bruges på køkken-iPad'en) i stedet for
seks. Punkt 5 er derfor kun én bruger, og punkt 6 erstattes af:

```sql
insert into public.medlemmer (bruger_id) select id from auth.users;

drop policy if exists "eget og fælles token" on public.tokens;
create policy "familien ser tokens" on public.tokens
  for select to authenticated using (public.er_familie());
```

1. **Opret konto** på https://supabase.com (gratis-planen er nok).
2. **New project**: navn `familiekalender`, region i EU (f.eks. Frankfurt eller Stockholm).
   Gem database-adgangskoden i din adgangskodeadministrator – appen skal ikke bruge den.
3. **Opret tabellerne**: SQL Editor → New query → indsæt hele indholdet af
   `supabase/schema.sql` → Run. Der skal stå "Success".
4. **Luk for fremmede**: Authentication → Sign In / Providers → slå
   "Allow new users to sign up" **fra**. Så kan kun de brugere, du selv opretter, logge ind.
5. **Opret 6 brugere**: Authentication → Users → Add user → Create new user
   (sæt flueben i "Auto Confirm User"). Én pr. person med vedkommendes e-mail og en
   adgangskode, plus én til køkken-iPad'en (f.eks. en ekstra e-mailadresse, du selv ejer).
6. **Knyt brugerne til familien**: SQL Editor → kør dette med jeres egne e-mailadresser:

   ```sql
   insert into public.medlemmer (bruger_id, person_id)
   select u.id, p.id
   from (values
     ('person1@example.com', 'Person 1'),
     ('person2@example.com', 'Person 2'),
     ('person3@example.com', 'Person 3'),
     ('person4@example.com', 'Person 4'),
     ('person5@example.com', 'Person 5'),
     ('ipad@example.com',    null)
   ) as v (email, navn)
   join auth.users u on u.email = v.email
   left join public.personer p on p.navn = v.navn;
   ```

   Resultatet skal være "6 rows". Rigtige navne kan rettes bagefter i
   Table Editor → `personer` (kolonnen `navn`) – eller sig navnene til Claude.
7. **Giv Claude to oplysninger** fra Project Settings → API (eller "Connect"-knappen):
   - Project URL (`https://xxxx.supabase.co`)
   - den offentlige nøgle (`anon` / `publishable`)

   De to må gerne ligge i frontenden – det er Row Level Security, der beskytter data.
   **Del aldrig** `service_role`/`secret`-nøglen eller database-adgangskoden.

## Trin 3 – GitHub Pages (færdigt 17.11.2026)

- Kalenderen: https://armanbjelonja.github.io/familiekalender/
- Koden: https://github.com/Armanbjelonja/familiekalender (offentligt, ingen hemmeligheder)
- Ændringer kommer på nettet ved `git push`; GitHub bruger ca. et minut på at udgive dem.

### Læg kalenderen på iPad'ens (eller iPhonens) hjemmeskærm

1. Åbn adressen ovenfor i **Safari**.
2. Tryk på Del-knappen (firkanten med pil op) → **Føj til hjemmeskærm** → **Tilføj**.
3. Åbn appen "Kalender" fra hjemmeskærmen, og log ind med familiens login.
   Det skal gøres i appen – login i Safari følger ikke med over.

## Trin 4 – Claude API-nøgle (det eneste, der mangler, for at assistenten virker)

Funktionen `assistent` er lagt op i Supabase (koden ligger i
`supabase/functions/assistent/index.ts`, "Verify JWT" er slået fra, fordi funktionen selv
tjekker login og token). Den mangler kun nøglen:

1. Gå til https://console.anthropic.com og opret en konto (eller log ind).
2. **Billing** → køb et lille forudbetalt beløb, f.eks. 5 USD. Slå gerne automatisk
   genopfyldning fra, så kan regningen aldrig løbe løbsk.
3. **API keys** → **Create key** → navn `familiekalender` → kopiér nøglen (`sk-ant-…`).
   Den vises kun denne ene gang.
4. I Supabase: **Edge Functions → Secrets** → navn `ANTHROPIC_API_KEY`, værdi = nøglen → **Save**.

Nøglen skal kun ligge i Supabase. Send den ikke i en chat, og læg den aldrig i koden.

Ændres funktionens kode senere, skal den lægges op igen: Edge Functions → `assistent` →
Code → indsæt den nye kode → Deploy updates.

## Kommer senere

- **Trin 6–7**: kalender-abonnement og Siri-genvej sættes op på hver iPhone (guide følger).
