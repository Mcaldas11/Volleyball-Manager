# VOLLEYBALL MANAGER PROJECT

**Volleyball Manager** is a free and open source sports management simulation
game, licensed under the [MIT License](#license), inspired by the famous
franchise Football Manager&trade;, built around a rally-by-rally match engine
for professional indoor volleyball that is calibrated against real elite-level
statistics rather than tuned to look plausible.

The purpose of this project is to provide an interesting and fun game for
simulating a volleyball coach's career: managing a squad, dealing with
players, finances, staff and scouting, across careers that can run fifty
seasons and outlive every player who started them. Unlike most management
games, nothing here samples a final score directly — every set score is what
is left over after simulating each rally's serve, reception, set, attack,
block and dig individually.

## INSTALLATION

The game is playable today, both in the browser and headlessly from the
command line.

**Prerequisites:** [Node.js](https://nodejs.org) 18 or later.

```bash
git clone <this repository>
cd beachvolleyboll
npm install
npm run dev
```

Then open the printed local URL. `New career` generates a world and drops you
straight into club selection.

To run without the browser:

```bash
npm run vm demo      # play one match through the full engine and print the report
npm run vm calibrate # check the engine against real volleyball statistics
npm run vm career 30 # simulate 30 seasons and check the world for drift
npm test              # unit tests
```

## CONTRIBUTING

This is an early-stage solo project without a formal contribution process yet.
If you'd like to help, open an issue describing what you'd like to work on
before sending a pull request — the biggest gaps are listed under Planned
Features below, and save/load is the most valuable one.

Before submitting a change:

- Run `npm run typecheck` and `npm test`
- Run `npm run vm calibrate` if you touch anything under `src/engine/match/`
  — the engine must keep passing all eleven statistical targets
- Run `npm run vm career 20` if you touch anything under `src/engine/world/`
  or `src/engine/season/` — the world must not drift over a long career

## FEATURES

### CORE FEATURES

- [x] Rally-by-rally match engine (serve → reception → set → attack → block →
      dig → transition), calibrated against eleven real elite-level
      statistical targets, at ~134,000 rallies/second
- [x] All six rotations simulated properly, including the reduced attacking
      options when the setter is front row, with a per-rotation performance
      report (side-out %, break-point %) so you can see exactly where a match
      was won or lost
- [x] Full point-by-point rally log, box scores and win-probability tracking
      for every watched match
- [x] Per-rotation tactical instructions: preferred attacker, serve target,
      block assignment, defensive shape, tempo
- [x] Team-level offensive, defensive, serve-risk and tempo systems
- [x] Choose any club to manage, from any of 58 nations' league pyramids
- [x] Manage the team's finances: sponsorship, TV rights, gate receipts,
      wage budgets — and real bankruptcy risk
- [x] Manage the squad's roster: sign and release players, set the starting
      six and libero, respect a 16-player squad cap
- [x] Weekly training, with development driven by age, potential, coaching
      quality, facilities and the player's own professionalism
- [x] Youth Academy with an annual intake, including rare "golden generation"
      prospects
- [x] Player ageing, injuries with permanent career effects, retirement, and
      procedurally generated "regens" that keep the world populated across a
      fifty-season career
- [x] Scouting with a genuine fog of war — attributes are shown as ranges
      that narrow with matches watched and with how well your scout knows
      that part of the world, not as exact numbers
- [x] Staff with real attributes: coaches, scouts, physios, doctors, youth
      coaches, each with their own regional knowledge and specialisms
- [x] League tables, promotion and relegation, season-long statistics leaders,
      world rankings, and a strict Hall of Fame
- [x] Import real players from the official FIVB VIS database, for anyone
      with their own FIVB credentials — see [FIVB Data](#fivb-data)
- [x] Database of 100,000+ fictitious players, generated with realistic
      positions, anthropometrics and national distributions

### PLANNED FEATURES

- [ ] Save and load a career (the world is fully serializable by design;
      the format just isn't written yet — this is the top priority)
- [ ] National team management: squad selection already exists, but the VNL,
      World Championship and Olympic tournaments are not yet scheduled, and
      you cannot be offered a national job
- [ ] Cup and continental club competitions (the structures are generated;
      their fixtures are not yet scheduled)
- [ ] Press conferences and a media system
- [ ] In-match tactical substitutions and timeouts
- [ ] Full multi-round playoffs (currently only the first round is scheduled)
- [ ] Performance work on the season rollover at world scale (~25s/season,
      dominated by weekly training iterating every player alive)

## LICENSE

    MIT License

    Copyright (c) 2026 Miguel Caldas

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

## FIVB DATA

The game ships **no FIVB data**, and this is deliberate. `src/data/fivb/`
contains a working client for the official FIVB VIS web service — the
Volleyball Information System behind the official player pages, rankings and
results — but the VIS database is the FIVB's property and most fields are
gated behind credentials the FIVB issues. If you hold VIS credentials, you can
import real players into your own local save; the procedurally generated world
exists so the game is complete and playable without them. Imported data stays
on the machine that imported it and is never committed to this repository.
