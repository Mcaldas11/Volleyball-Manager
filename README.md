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
cd volleyball-manager
npm install
npm run dev
```

Then open the printed local URL. `New career` generates a world and drops you
straight into club selection.

To run without the browser:

```bash
npm run vm demo           # play one match through the full engine and print the report
npm run vm calibrate      # check the engine against real volleyball statistics
npm run vm career 30      # simulate 30 seasons and check the world for drift
npm run vm ratings        # check the 0-10 player ratings are centred for every position
npm run vm world standard # generate a world (small, standard or large) and report its shape
npm test                  # unit tests
```

## CONTRIBUTING

This is an early-stage solo project without a formal contribution process yet.
If you'd like to help, open an issue describing what you'd like to work on
before sending a pull request — the biggest gaps are listed under Planned
Features below.

Before submitting a change:

- Run `npm run typecheck` and `npm test`
- Run `npm run vm calibrate` if you touch anything under `src/engine/match/`
  — the engine must keep passing all eleven statistical targets
- Run `npm run vm career 20` if you touch anything under `src/engine/world/`
  or `src/engine/season/` — the world must not drift over a long career

## FEATURES

### MATCH ENGINE

- [x] Rally-by-rally match engine (serve → reception → set → attack → block →
      dig → transition), calibrated against eleven real elite-level
      statistical targets
- [x] All six rotations simulated properly, including the reduced attacking
      options when the setter is front row, with a per-rotation performance
      report (side-out %, break-point %) so you can see exactly where a match
      was won or lost
- [x] 5-1 and 4-2 systems, with the overlap rules respected: a side receiving
      with its setter in zone 1 keeps its places all rally
- [x] Combination plays — quicks, slides, back quicks, pipes — and a plan per
      pass zone: what the setter may run off a perfect pass, a 3-6 m one or a
      deep one
- [x] Per-rotation instructions (preferred attacker, serve target, block
      assignment, defensive shape, tempo) and a defensive layout against each
      kind of attack
- [x] Liberos as the rules have them: one or two registered for a match, a
      reception and a defensive libero, unlimited libero changes, the libero
      never serves — a middle in zone 1 serves while his side keeps the serve
      and makes way for the libero the moment it is lost — and a registered
      libero can't play outfield
- [x] In-match substitutions up to the real six-per-set limit, two timeouts
      a set, a word from the touchline, and the video challenge: two a set,
      asked about one thing — the ball in or out, a touch off the block, the
      net — and the point played again on the court, the decisive touch in
      slow motion, before the verdict; the referee can miss one thing on a
      close call, and only the right question turns it over — point, serve
      and box score — and keeps the challenge
- [x] Team talks before the match and at every set break: what lands depends
      on the moment and on each player's personality, the dressing room's
      leaders counting most
- [x] Player traits — a big jump server, a floor general, a libero who digs
      everything — earned as the attributes behind them grow, each a few per
      cent on the skill it is about
- [x] In-match injuries: a knock can be played on, at the risk of it getting
      worse; a serious one forces a change
- [x] Full point-by-point rally log, box scores, 0-10 match ratings and
      win-probability tracking for every watched match

### THE WORLD

- [x] Choose any club to manage, from any of 60 nations' league pyramids — or
      take a national team job, alongside a club or on its own
- [x] Promotion and relegation in which two divisions trade as many clubs as
      they send, and every regional group of a division is kept the same size
- [x] Cups alongside the league: every nation's cup (a knockout for its top
      two divisions) and super cup (league champions against cup winners);
      Europe's Champions League (four groups, then a knockout with a
      neutral-venue final) and CEV Cup; a club championship for every other
      confederation; and a Club World Championship in December for the
      continental champions, open to clubs from anywhere. Places are earned
      from the season before, every match is fitted around the leagues so no
      club plays two days running, and prize money, trophies and the season
      review all count them
- [x] Multi-round championship and relegation playoffs for the top two
      divisions, in the Brazilian Superliga's format: best-of-three series —
      the better seed at home in games one and three — and a single title
      final on neutral ground
- [x] National teams with their own squad, team sheet and tactics, kept apart
      from the club's, and an international calendar: the World Championship,
      the Olympic Games, the continental championships and the Nations League,
      with caps and a world ranking
- [x] Manage the team's finances: sponsorship, TV rights, gate receipts,
      wage budgets — and real bankruptcy risk. Set the ticket price, pick each
      summer's shirt sponsor (steady, performance or long-term), ask the board
      for better facilities, and take on up to two affiliate clubs
- [x] Manage the squad's roster: sign, release and loan players, set the
      starting six and liberos, respect a 16-player squad cap. Loans carry
      promised playing time, monthly reports, a word with the loan club's
      coach and a recall when the promise isn't kept
- [x] Pre-season friendlies, arranged with any club or by the board
- [x] Weekly training plans, individual training, and players learning new
      positions in training and on court, driven by age, potential, coaching
      quality, facilities and the player's own professionalism
- [x] Youth Academy with an annual intake, including rare "golden generation"
      prospects
- [x] Player ageing, injuries with permanent career effects, and procedurally
      generated "regens" that keep the world populated across a fifty-season
      career
- [x] One-to-one talks with players, held as a conversation in your office:
      praise, criticism, encouragement, a promise of games that is called in
      later — each answered in the player's own words — and players kept
      unhappy asking to leave
- [x] A dressing room with its leaders, a captain and a cohesion that grows
      with time together, suffers with new faces and a leader's departure,
      and is worth a little on court
- [x] Retirement case by case: most players stop in their mid-thirties, many
      play past 40, the oldest usually around 43 and a rare few towards 50.
      A player's plans are known mid-season, and he can be persuaded to stay
- [x] Scouting with a genuine fog of war — attributes are shown as ranges
      that narrow with matches watched and with how well your scout knows
      that part of the world, not as exact numbers
- [x] Staff with real attributes: coaches, scouts, physios, doctors, youth
      coaches, each with their own regional knowledge and specialisms — hired,
      renewed, listed and sacked through a staff market that works like the
      players' one: compensation agreed with his club, then his terms, answers
      days later, rival clubs, and other clubs coming in for yours
- [x] Every other coach picks his own tactics, and reads yours
- [x] Awards: monthly and season awards, every player's accolades, a review of
      each competition with its best moments and team awards (best attack,
      defence, block, serve and passing, most clinical attack, comeback kings)
      with each player's part in them, and a strict Hall of Fame
- [x] Every player's club history, and every competition's team and player
      statistics
- [x] Import real players from the official FIVB VIS database, for anyone
      with their own FIVB credentials — see [FIVB Data](#fivb-data)
- [x] Database of 100,000+ fictitious players, generated with realistic
      positions, anthropometrics and national distributions
- [x] Save and load a career, locally in the browser (IndexedDB) — multiple
      careers side by side, each resumable from the main menu

### INTERFACE

- [x] A live match viewer in 2D or 3D (three.js): a real court with a crowd,
      a referee and both benches, every player moving through each phase of
      the rally, substitutes warming up and walking on through the
      substitution zone, the libero swapping in and out, defenders diving
      full length for balls — flat out on the floor, or over sideways — and
      a medic running on to an injured player
- [x] A coach's bar during the match: a timeout opens the timeout screen;
      the substitutions panel holds play while it is open; clicking one of
      your players beside the court offers who could come on for him; any
      player's profile opens over the match
- [x] A live commentary ticker alongside the match, plus flashed callouts for
      the moments that deserve one — "MONSTER SPIKE!", "HUGE BLOCK!", "ACE!"
- [x] Pre-match interviews, post-match press conferences, and a world news
      feed with the fans' comments under each story
- [x] Country flags throughout — clubs, players, staff, nations — resolved
      from FIVB confederation codes to real flag images
- [x] Player photos, deterministic per player so the same face keeps showing
      up for them across sessions
- [x] A proper main menu: continue your most recent career at a glance, or
      start a new one, without hunting through a save list first
- [x] One button moves time on: Continue runs the calendar day by day until
      something happens — news in the inbox or a match day — and becomes
      Next unread or Play match when that is what the day needs. Go on
      holiday to any date. Play a match live or take an instant result;
      either way a full-time screen shows the score, player of the match and
      box score before the rest of the matchday comes in
- [x] An inbox laid out like a mail client: folders by department (transfers,
      contracts, scouting, medical, matchday, media, board, finance), an
      "action needed" filter, starring and archiving, and every message from
      someone — the medical room on injuries and recoveries, the league office
      with a round-up after every matchday, the finance office's monthly
      statement, rival clubs and agents
- [x] A club dashboard (next fixture, table, one to watch, form, top scorer,
      the board's mood, the money) and a month-by-month calendar of results,
      fixtures and transfer deadlines
- [x] Match sounds — the whistle, the ball, the crowd, the timeout hooter —
      made in the browser, with a mute button
- [x] In-game help, a topic at a time, and a welcome tour for a first career
- [x] Every screen fits the window, Football Manager style: the page never
      scrolls, long lists scroll inside their own panels, and the layout
      follows the height that can actually be seen

### PLANNED FEATURES

- [ ] More performance work on simulating a season (around 19 seconds a
      season on the small world from the command line, down from 31)
- [ ] A women's game

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
