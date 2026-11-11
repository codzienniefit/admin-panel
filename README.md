# Codziennie Fit admin panel

The web panel that replaces the Retool panel and Patryk's planner app.

## Documents

| Read                                                          | For                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                       | How the panel is built today                                                            |
| [CODE-GUIDELINES.md](docs/CODE-GUIDELINES.md)                 | Rules for writing code here, with reasons                                               |
| [DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md)           | When work may start and when it is finished: tests, lint, checks by hand                |
| [SECURITY.md](docs/SECURITY.md)                               | What was reviewed, what protects the panel, what stage 2 must add                       |
| [RISKS.md](docs/RISKS.md)                                     | What could go wrong and what is done about it                                           |
| [PLAN.md](docs/PLAN.md), [ROADMAP.md](docs/ROADMAP.md)        | What is intended, and in which order                                                    |
| [PHASE-7-RESULT.md](docs/PHASE-7-RESULT.md)                   | The latest phase; the panel now covers every Retool tab and the planner, on sample data |
| [TESTING.md](docs/TESTING.md), [e2e/README.md](e2e/README.md) | How the panel is tested, and how to write a UI test                                     |
| `docs/PHASE-N-RESULT.md`                                      | What each phase built and what it did not verify                                        |

## Commands

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # secrets scan, typecheck, lint, unit tests, production build
npm run test:ui  # 72 browser tests, Test environment only (first time: npx playwright install chromium)
npm run test:all # both
npm run format   # apply lint and formatting fixes
```

Run `npm run test:all` locally after every big set of changes: nothing runs the tests on push.

Deployment happens on push, through Cloudflare.

## Where things are

| Path                    | What                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `src/routes/`           | One file per URL                                                                                                      |
| `src/features/`         | Screens, one folder per area                                                                                          |
| `src/ui/`               | Shared components and `enums.ts`, which decides the label and colour of every status, training type and level         |
| `src/data/api/`         | The `ApiClient` interface and the in-process mock                                                                     |
| `src/data/collections/` | The single copy of each entity, and `saver.ts`, the one path every save takes                                         |
| `src/data/schemas/`     | Zod schemas; the source of entity types                                                                               |
| `src/domain/`           | Pure logic with tests: rules per entity, filters, planner operations, week rules, calendar maths, the three-way merge |
| `public/_headers`       | Security headers for the deployed site                                                                                |
| `src/styles/app.css`    | Design tokens and colour tones                                                                                        |
| `worker/`               | The Cloudflare Worker behind `/api/*`                                                                                 |

Open `/design` in the running app to see every shared component in every state. Check visual
changes there first.
