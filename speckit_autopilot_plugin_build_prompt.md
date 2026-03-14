# Speckit Autopilot Plugin — Prompt completo per Claude Code

## Obiettivo

Realizzare integralmente un plugin **Claude Code** chiamato **`speckit-autopilot`** che:

- usi **Spec Kit** come motore interno spec-driven
- lavori in modo **greenfield** e **brownfield**
- possa costruire una **roadmap globale** a partire da un `product.md`
- possa implementare una **singola feature** su progetto esistente
- sia **resistente all’auto-compact del contesto**
- abbia **test unitari/integrati con coverage >= 90%**
- sia usabile da **Claude Code in VS Code/IDE**
- preveda una modalità opzionale **headless/SDK** per loop autonomi

---

## Come usare questo documento

1. Crea un nuovo repository per il plugin.
2. Apri il repository con Claude Code.
3. Incolla il prompt completo riportato nella sezione **Prompt operativo per Claude Code**.
4. Lascia che Claude Code realizzi il plugin integralmente.
5. Usa la sezione **Smoke test** per verificare il funzionamento.

---

## Nome del plugin

**`speckit-autopilot`**

---

## Obiettivo funzionale del plugin

Il plugin deve esporre un layer di orchestrazione sopra Spec Kit.

Deve supportare due modalità principali:

### Modalità A — `ship-product`
Parte da `docs/product.md`, estrae epic/feature, crea roadmap/backlog e itera feature per feature fino a completamento o blocco.

### Modalità B — `ship-feature`
Parte da un progetto esistente e implementa una singola feature in modo spec-driven.

---

## Requisiti architetturali

- Linguaggio: **TypeScript**
- Runtime: **Node.js**
- Test runner: **Vitest**
- Coverage minimo obbligatorio: **>= 90%** su:
  - lines
  - branches
  - functions
  - statements
- Strict typing abilitato
- Nessuna dipendenza inutile
- Il plugin deve essere nativo per Claude Code
- Spec Kit deve essere usato **as-is**, non modificato
- Lo stato operativo deve stare su filesystem
- Il plugin non deve dipendere dalla cronologia chat

---

## Struttura attesa del progetto

```text
speckit-autopilot/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── bootstrap-product/
│   │   └── SKILL.md
│   ├── ship-product/
│   │   └── SKILL.md
│   ├── ship-feature/
│   │   └── SKILL.md
│   ├── resume-loop/
│   │   └── SKILL.md
│   └── status/
│       └── SKILL.md
├── agents/
│   ├── product-planner.md
│   ├── brownfield-analyst.md
│   ├── spec-auditor.md
│   └── qa-gatekeeper.md
├── hooks/
│   └── hooks.json
├── scripts/
│   ├── session-start-compact.mjs
│   ├── precompact-snapshot.mjs
│   ├── postcompact-log.mjs
│   ├── task-completed-gate.mjs
│   └── render-active-state.mjs
├── src/
│   ├── core/
│   │   ├── backlog-schema.ts
│   │   ├── state-store.ts
│   │   ├── roadmap-generator.ts
│   │   ├── feature-picker.ts
│   │   ├── brownfield-snapshot.ts
│   │   ├── compact-state.ts
│   │   └── acceptance-gate.ts
│   ├── cli/
│   │   ├── bootstrap-product.ts
│   │   ├── ship-product.ts
│   │   ├── ship-feature.ts
│   │   └── resume-loop.ts
│   └── utils/
│       ├── fs.ts
│       ├── yaml.ts
│       └── git.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── examples/
│   └── simple-demo/
│       ├── product.md
│       ├── expected-roadmap.md
│       └── expected-backlog.yaml
├── CLAUDE.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── CHANGELOG.md
```

---

## Comandi che il plugin deve esporre

Il plugin deve esporre almeno questi comandi/skills namespaced:

- `/speckit-autopilot:bootstrap-product`
- `/speckit-autopilot:ship-product`
- `/speckit-autopilot:ship-feature`
- `/speckit-autopilot:resume-loop`
- `/speckit-autopilot:status`

---

## Comportamento atteso dei comandi

### `/speckit-autopilot:bootstrap-product`
- legge `docs/product.md`
- estrae epic, feature, dipendenze, priorità
- crea:
  - `docs/roadmap.md`
  - `docs/product-backlog.yaml`
  - `docs/autopilot-state.json`
- non implementa ancora nulla

### `/speckit-autopilot:ship-product`
- se backlog/roadmap mancano, esegue prima il bootstrap
- prende la prossima feature aperta
- crea o usa il branch corretto
- lancia il ciclo Spec Kit della feature
- aggiorna stato e log
- continua in loop fino a:
  - backlog completato
  - blocco non recuperabile
  - fallimenti ripetuti oltre soglia
- deve essere riprendibile e idempotente

### `/speckit-autopilot:ship-feature`
- lavora su una sola feature
- supporta greenfield e brownfield
- se brownfield, crea/aggiorna `docs/brownfield-snapshot.md`
- lancia il ciclo Spec Kit solo per la feature richiesta

### `/speckit-autopilot:resume-loop`
- legge:
  - `docs/autopilot-state.json`
  - `docs/product-backlog.yaml`
  - `docs/iteration-log.md`
- riprende dal punto corretto
- deve funzionare anche dopo `/compact`, riavvio sessione o resume

### `/speckit-autopilot:status`
- mostra:
  - feature attiva
  - fase attuale
  - prossima feature
  - ultimi test
  - ultimo errore
  - coverage
  - stato backlog

---

## Stato persistente richiesto nel repo target

Il plugin deve creare e mantenere questi file nel progetto su cui lavora:

```text
docs/
├── product.md
├── roadmap.md
├── product-backlog.yaml
├── brownfield-snapshot.md
├── iteration-log.md
└── autopilot-state.json
```

---

## Regole fondamentali di resilienza al compact

Il plugin deve essere progettato per continuare a funzionare anche quando Claude Code compatta automaticamente il contesto.

### Regole obbligatorie
- Le regole permanenti devono stare in `CLAUDE.md`
- Lo stato operativo deve stare nei file `docs/*.md`, `yaml`, `json`
- Non si deve usare la chat come source of truth
- Dopo compact, il plugin deve sapere:
  - cosa stava facendo
  - su quale feature era
  - in quale fase era
  - cosa resta da fare

### Hook obbligatori
Il file `hooks/hooks.json` deve includere:

1. `SessionStart` con matcher `compact`
   - esegue `scripts/session-start-compact.mjs`
   - stampa uno stato sintetico aggiornato

2. `PreCompact` con matcher `auto|manual`
   - esegue `scripts/precompact-snapshot.mjs`
   - salva snapshot sintetico su iteration log o state

3. `PostCompact` con matcher `auto|manual`
   - esegue `scripts/postcompact-log.mjs`
   - registra il compact summary e riallinea lo stato

4. `TaskCompleted`
   - esegue `scripts/task-completed-gate.mjs`
   - blocca la chiusura del task se non passano gate di qualità

---

## Flusso Spec Kit da orchestrare

Per ogni feature il plugin deve usare questo ciclo:

1. `/speckit.constitution` solo se manca
2. `/speckit.specify`
3. `/speckit.clarify`
4. `/speckit.plan`
5. `/speckit.tasks`
6. `/speckit.analyze`
7. `/speckit.implement`

Il plugin non deve cercare di creare una mega-spec per tutto il prodotto in un colpo solo. Deve lavorare **per feature/iterazioni**.

---

## Modalità greenfield e brownfield

### Greenfield
- usa `docs/product.md`
- crea roadmap e backlog
- implementa una feature alla volta

### Brownfield
- analizza il repo esistente
- crea `docs/brownfield-snapshot.md`
- accetta una feature target
- esegue il loop solo su quella feature

---

## Subagent richiesti

Creare almeno questi subagent:

### `product-planner`
Responsabile di:
- estrazione epic/feature
- roadmap globale
- dipendenze e priorità

### `brownfield-analyst`
Responsabile di:
- snapshot del repo esistente
- moduli chiave
- entry point
- vincoli e impatti della feature

### `spec-auditor`
Responsabile di:
- verifica qualità della spec
- ambiguità
- coerenza tra spec/plan/tasks

### `qa-gatekeeper`
Responsabile di:
- quality gates
- verifica test/lint/coverage
- blocco task non conformi

---

## Moduli TypeScript richiesti

Implementare almeno questi file:

- `src/core/backlog-schema.ts`
- `src/core/state-store.ts`
- `src/core/roadmap-generator.ts`
- `src/core/feature-picker.ts`
- `src/core/brownfield-snapshot.ts`
- `src/core/compact-state.ts`
- `src/core/acceptance-gate.ts`
- `src/cli/bootstrap-product.ts`
- `src/cli/ship-product.ts`
- `src/cli/ship-feature.ts`
- `src/cli/resume-loop.ts`
- `scripts/session-start-compact.mjs`
- `scripts/precompact-snapshot.mjs`
- `scripts/postcompact-log.mjs`
- `scripts/task-completed-gate.mjs`
- `scripts/render-active-state.mjs`

---

## Requisiti di test

### Coverage obbligatoria
Coverage globale **>= 90%** su:
- lines
- branches
- functions
- statements

### Test da scrivere

#### Unit test
- validazione backlog schema
- lettura/scrittura state store
- generazione roadmap
- selezione next feature
- merge/ripresa stato compact
- acceptance gate

#### Integration test
- bootstrap completo da `product.md`
- resume-loop dopo stato interrotto
- generazione brownfield snapshot
- task completion gate
- rendering stato attivo per compact

#### Smoke test
- caricamento plugin via `--plugin-dir`
- verifica presenza dei comandi
- esecuzione bootstrap
- esecuzione status
- esecuzione ship-product
- test resume dopo `/compact`

---

## Criteri di accettazione

Il plugin è accettato solo se:

- si carica correttamente in Claude Code
- i comandi namespaced sono disponibili
- il bootstrap produce roadmap e backlog
- `ship-product` itera feature per feature
- `ship-feature` funziona anche su progetto esistente
- `resume-loop` funziona dopo compact o restart
- il plugin non perde lo stato dopo compact
- coverage >= 90%
- README e documentazione sono completi

---

## Prompt operativo per Claude Code

Incolla il testo seguente in Claude Code nella root del repo del plugin.

```text
Sei Claude Code e devi realizzare integralmente un plugin Claude Code production-ready chiamato `speckit-autopilot`.

Obiettivo del plugin
- Orchestrare Spec Kit per lavorare in modo autonomo e iterativo su:
  1. greenfield: partire da `docs/product.md`, creare roadmap/backlog di tutto il prodotto e poi realizzare le feature una per volta
  2. brownfield: partire da un repo esistente e implementare una singola feature in modo spec-driven
- Il plugin deve funzionare dentro Claude Code in VS Code/IDE e deve includere anche una modalità opzionale headless/SDK per loop non presidiati.
- Non devi modificare Spec Kit. Devi usarlo come motore interno.
- Il plugin deve essere resiliente all’auto-compact del contesto: non deve dipendere dalla cronologia chat per sapere cosa stava facendo.

Vincoli architetturali obbligatori
- Linguaggio: TypeScript
- Runtime: Node.js
- Plugin Claude Code nativo con questa struttura minima:
  - `.claude-plugin/plugin.json`
  - `skills/`
  - `agents/`
  - `hooks/hooks.json`
  - `scripts/`
  - `src/`
  - `tests/`
  - `examples/simple-demo/product.md`
  - `CLAUDE.md`
  - `README.md`
- Usa `skills/` e non `commands/` per le nuove capability.
- I comandi del plugin devono essere:
  - `/speckit-autopilot:bootstrap-product`
  - `/speckit-autopilot:ship-product`
  - `/speckit-autopilot:ship-feature`
  - `/speckit-autopilot:resume-loop`
  - `/speckit-autopilot:status`
- Aggiungi almeno questi subagent:
  - `product-planner`
  - `brownfield-analyst`
  - `spec-auditor`
  - `qa-gatekeeper`
- Il plugin deve usare filesystem state persistente e NON affidarsi alla chat come source of truth.

Stato persistente richiesto
Nel repo target il plugin deve creare/aggiornare:
- `docs/product.md`
- `docs/roadmap.md`
- `docs/product-backlog.yaml`
- `docs/brownfield-snapshot.md`
- `docs/iteration-log.md`
- `docs/autopilot-state.json`

Regole compaction-safe obbligatorie
- Metti in `CLAUDE.md` solo regole permanenti, concise e operative.
- Implementa in `hooks/hooks.json`:
  1. `SessionStart` matcher `compact` -> esegue uno script che stampa un riepilogo dinamico dello stato attuale e della feature attiva
  2. `PreCompact` matcher `auto|manual` -> salva uno snapshot sintetico in `docs/iteration-log.md`
  3. `PostCompact` matcher `auto|manual` -> registra il compact summary e riallinea `docs/autopilot-state.json`
  4. `TaskCompleted` -> blocca la chiusura del task se lint/test/coverage o criteri di accettazione non passano
- Non affidarti a auto memory per la logica del plugin.
- Tutto ciò che serve per riprendere il lavoro dopo compact o resume deve stare nei file di stato.

Integrazione con Spec Kit
- Il plugin deve rilevare se Spec Kit è disponibile.
- Se non è inizializzato nel repo target, deve preparare o proporre il bootstrap con `specify init . --ai claude --ai-skills`.
- Il workflow standard da usare per ogni feature è:
  1. `/speckit.constitution` solo se manca
  2. `/speckit.specify`
  3. `/speckit.clarify`
  4. `/speckit.plan`
  5. `/speckit.tasks`
  6. `/speckit.analyze`
  7. `/speckit.implement`
- Per progetti grandi, il plugin deve lavorare per fasi/feature, non creare una mega-spec unica.

Comportamento richiesto dei comandi
1. `/speckit-autopilot:bootstrap-product`
- Legge `docs/product.md`
- Estrae epic, feature, dipendenze, priorità e ordine di realizzazione
- Produce `docs/roadmap.md`, `docs/product-backlog.yaml`, `docs/autopilot-state.json`
- Non implementa ancora nulla

2. `/speckit-autopilot:ship-product`
- Se il backlog non esiste, richiama prima il bootstrap
- Prende la prossima feature aperta
- Crea o usa il branch della feature
- Esegue il ciclo Spec Kit completo
- Aggiorna stato, roadmap, backlog e iteration log
- Continua fino a:
  - backlog completato
  - blocco non risolvibile
  - failure ripetute oltre soglia
- Deve essere idempotente e riprendibile

3. `/speckit-autopilot:ship-feature`
- Supporta repo brownfield o greenfield
- Accetta una feature target o la deduce dal backlog
- Se il repo è brownfield, crea/aggiorna `docs/brownfield-snapshot.md`
- Esegue solo il loop della feature scelta

4. `/speckit-autopilot:resume-loop`
- Rilegge `docs/autopilot-state.json`, `docs/product-backlog.yaml` e `docs/iteration-log.md`
- Riprende dalla feature e dalla fase corrette
- Funziona anche dopo `/compact`, restart o resume session

5. `/speckit-autopilot:status`
- Mostra stato sintetico:
  - feature attiva
  - fase attuale
  - prossima feature
  - ultimo errore
  - coverage
  - ultimi test
  - backlog summary

Struttura del codice richiesta
Crea almeno questi moduli TypeScript:
- `src/core/backlog-schema.ts`
- `src/core/state-store.ts`
- `src/core/roadmap-generator.ts`
- `src/core/feature-picker.ts`
- `src/core/brownfield-snapshot.ts`
- `src/core/compact-state.ts`
- `src/core/acceptance-gate.ts`
- `src/cli/bootstrap-product.ts`
- `src/cli/ship-product.ts`
- `src/cli/ship-feature.ts`
- `src/cli/resume-loop.ts`
- `scripts/session-start-compact.mjs`
- `scripts/precompact-snapshot.mjs`
- `scripts/postcompact-log.mjs`
- `scripts/task-completed-gate.mjs`
- `scripts/render-active-state.mjs`

Qualità e test
- Obbligatorio test coverage globale >= 90% su:
  - lines
  - functions
  - branches
  - statements
- Scrivi test unitari e di integrazione
- Testa:
  - parsing e validazione backlog/state
  - roadmap generation
  - next-feature selection
  - resume logic
  - compaction reinjection
  - task completion gate
  - brownfield snapshot generation
- Aggiungi uno smoke test locale con il plugin caricato via `--plugin-dir`
- Il codice deve essere typed, con strict mode e lint pulito

Deliverable obbligatori
- plugin funzionante
- `README.md` con:
  - installazione
  - sviluppo locale
  - test locale con `--plugin-dir`
  - flussi greenfield e brownfield
  - come usare i 5 comandi principali
- `examples/simple-demo/product.md`
- `examples/simple-demo/expected-roadmap.md`
- `examples/simple-demo/expected-backlog.yaml`
- `CHANGELOG.md`
- `CLAUDE.md` del plugin con regole concise
- configurazione test/lint/coverage

Criteri di accettazione
- Il plugin viene caricato correttamente da Claude Code
- I comandi namespaced del plugin compaiono
- Il bootstrap crea roadmap e backlog da `product.md`
- `ship-product` itera feature per feature
- `ship-feature` funziona su feature singola e brownfield
- Dopo una compaction o resume, `resume-loop` riprende correttamente
- Coverage >= 90%
- README completo e verificato

Modo di esecuzione
- Lavora in autonomia fino a completamento
- Non fermarti dopo il design
- Implementa davvero file, codice, test e documentazione
- Esegui test e correggi finché la coverage non passa
- Se una decisione è ambigua ma non bloccante, scegli l’opzione più semplice e robusta
- Se mancano strumenti esterni, crea fallback locali ragionevoli
- Non introdurre dipendenze inutili

Ordine operativo desiderato
1. Crea manifest e skeleton plugin
2. Crea skills, agents e hooks
3. Implementa core state/backlog modules
4. Implementa CLI/runner moduli
5. Scrivi test
6. Aggiungi example product
7. Esegui lint/test/coverage
8. Rifinisci README e CLAUDE.md
9. Verifica finale end-to-end

Inizia ora.
```

---

## `product.md` di esempio per test

Salva questo file in `examples/simple-demo/product.md` e anche in `docs/product.md` del progetto demo.

```md
# Product: TaskBoard Lite

## Vision
TaskBoard Lite è una piccola web app single-user per organizzare attività personali in modo visuale e locale, senza backend e senza login.

## Product Goals
- Permettere a un utente di creare e gestire task personali
- Offrire una vista semplice con stati chiari
- Salvare tutto localmente nel browser
- Restare piccola, veloce e facile da usare

## Users
### Primary user
- Persona singola che gestisce attività personali o di studio

## In Scope
### Feature 1 - Task CRUD
L’utente può:
- creare un task
- modificare titolo e descrizione
- eliminare un task
- vedere l’elenco dei task

### Feature 2 - Workflow a stati
Ogni task ha uno stato:
- Todo
- Doing
- Done

L’utente può cambiare stato rapidamente.

### Feature 3 - Filtri e ricerca
L’utente può:
- filtrare per stato
- cercare task per testo nel titolo

### Feature 4 - Persistenza locale
I task devono restare disponibili dopo refresh del browser.

### Feature 5 - Dashboard minima
L’utente vede:
- numero totale task
- numero task Todo
- numero task Doing
- numero task Done

## Out of Scope
- Login
- Multiutente
- Collaborazione real-time
- Backend remoto
- Notifiche email
- Allegati file

## Non-Functional Requirements
- Avvio rapido in locale
- UI semplice e responsive
- Nessun caricamento di dati su server esterni
- Errori gestiti con messaggi chiari
- Codice testabile e manutenibile

## Suggested Technical Constraints
- Frontend web
- TypeScript
- Persistenza locale nel browser
- Soluzione semplice, evitare over-engineering

## Acceptance Criteria
- Posso creare, modificare ed eliminare task
- Posso cambiare stato di un task
- Posso filtrare e cercare task
- Dopo refresh i task restano salvati
- Vedo contatori coerenti per stato
- I test automatici passano

## Delivery Preference
Implementare per fasi:
1. base CRUD
2. stati
3. persistenza
4. filtri e ricerca
5. dashboard
```

---

## Smoke test del plugin

### 1. Crea un progetto demo

```bash
mkdir demo-taskboard
cd demo-taskboard
git init
mkdir -p docs
```

### 2. Aggiungi `docs/product.md`

Incolla il contenuto del `product.md` di esempio.

### 3. Inizializza Spec Kit nel progetto demo

```bash
uvx --from git+https://github.com/github/spec-kit.git specify init . --ai claude --ai-skills
```

### 4. Avvia Claude Code con il plugin locale

```bash
claude --plugin-dir /percorso/assoluto/speckit-autopilot
```

### 5. Esegui i comandi in Claude Code

```text
/speckit-autopilot:bootstrap-product
/speckit-autopilot:status
/speckit-autopilot:ship-product
```

### 6. Test del resume dopo compact

```text
/compact
/speckit-autopilot:resume-loop
```

### 7. Verifiche attese

- esiste `docs/roadmap.md`
- esiste `docs/product-backlog.yaml`
- esiste `docs/autopilot-state.json`
- lo stato mostra la feature attiva e la prossima feature
- dopo compact il plugin riprende correttamente

---

## Verifiche finali obbligatorie

Claude Code deve verificare automaticamente:

- lint pulito
- test unitari/integrati passati
- coverage >= 90%
- struttura plugin valida
- comandi del plugin presenti
- README completo
- example demo coerente

---

## Nota finale

La regola operativa principale è questa:

- **Spec Kit** gestisce il ciclo di una feature
- **speckit-autopilot** decide quale feature fare, mantiene lo stato e garantisce la ripresa del lavoro anche dopo compact

Questo documento è pensato per essere sufficiente, da solo, a far realizzare il plugin integralmente da Claude Code.

