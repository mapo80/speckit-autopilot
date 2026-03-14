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