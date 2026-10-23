# VOLLEYBALL MANAGER PROJECT

**Volleyball Manager** is a sports management simulation game inspired by the
famous franchise Football Manager&trade;, built around a rally-by-rally match engine
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

To publish the game on itch.io (web, Windows and Mac), see [PUBLICAR.md](PUBLICAR.md).

## DEVELOPMENT

This is a closed-source solo project; outside contributions are not accepted.

Before committing a change:

- Run `npm run typecheck` and `npm test`
- Run `npm run vm calibrate` if you touch anything under `src/engine/match/`
  — the engine must keep passing all eleven statistical targets
- Run `npm run vm career 20` if you touch anything under `src/engine/world/`
  or `src/engine/season/` — the world must not drift over a long career

## FEATURES

### MATCH ENGINE

- [x] Rally-by-rally match engine (serve → reception → set → attack → block →
      dig → transition), calibrated against thirteen real elite-level
      statistical targets — among them how close sets are: the side that
      loses a set takes about 20 points, and one lost with 15 or fewer is
      about one in ten, as in the top flights
- [x] All six rotations simulated properly, including the reduced attacking
      options when the setter is front row, with a per-rotation performance
      report (side-out %, break-point %) so you can see exactly where a match
      was won or lost
- [x] 5-1 and 4-2 systems, with the overlap rules respected: a side receiving
      with its setter in zone 1 keeps its places all rally
- [x] Combination plays — quicks, slides, back quicks, pipes — and a plan per
      pass zone: what the setter may run off a perfect pass, a 3-6 m one or a
      deep one. Rehearsed in training, a combination beats the block clearly
      better than the fast set it replaces — a side that drills them and runs
      them often wins more; one that runs them cold is mistimed
- [x] Setters and hitters who know each other: every pair at a club has an
      understanding that grows with every match they play together, eases
      over a summer and is gone when one of them leaves — the sets arrive on
      time a little more often, the quick most of all. Each hitter's card on
      the team sheet shows his understanding with the setter, and the
      assistant tells you when a pair has clicked
- [x] Per-rotation instructions (preferred attacker, serve target, block
      assignment, defensive shape, tempo) and a defensive layout against each
      kind of attack
- [x] A serve-receive line for every rotation: the usual three — the libero
      and both outsides — or two, hiding the weaker-passing outside so he
      attacks the first ball fresher while the others cover more court, or
      four, the opposite passing too: more cover, a weaker passer to aim at,
      and an opposite who has just passed the ball he must hit. The court
      shows the line as it is set
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
      and box score — and keeps the challenge. On the line, the video
      measures where the ball really came down — the same spot the court
      showed — and shows its mark against the line, to the centimetre
- [x] Every attack comes down somewhere of its own: down the line, deep in
      the far corner, short on the 3 m line, through the seam, tipped behind
      the block — the hitters reach the whole court, and a ball hit out lands
      out
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

- [x] A career's achievements — wins piling up, every kind of trophy, a
      promotion, the jobs and countries, a name the whole sport knows —
      unlocked and dated the day they are reached; and coaching courses to go
      back to school: the Level 2, Level 1 and Pro licences in order, and
      clinics on each part of the game, each lifting the manager's own
      coaching attributes
- [x] The men's game or the women's, chosen with the career: the women's
      world has its own map of strong nations — Türkiye, the United States,
      China, Japan, the Dominican Republic and Thailand among the best — its
      players named and pictured as women, a dozen centimetres shorter with
      the reach to match, a 2.24 m net and a slower ball; the engine measures
      them against the women's game, so its matches play out as the men's
      do, and the screens speak of the players as women (coaches, staff and
      owners keep their own)
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
- [x] The FIVB's calendar (2025–2028, updated December 2025), the women's and
      the men's: the Nations League from early June to the start of August
      (May and June in an Olympic year), the World Championship in
      August/September of odd years, the continental championships in even
      ones on each confederation's real dates, Los Angeles 2028 on 15–30
      July; the clubs from October (the women a fortnight earlier) to May,
      the Champions League's Final Four in mid-May, the other confederations'
      club championships a week at one venue in their real windows, the Club
      World Championship in mid-December. The season runs to 30 June; a save
      from before keeps the old calendar for the season it is in
- [x] More for a national coach between tournaments: friendlies arranged on
      free dates in the national team's months — three a season, caps but no
      ranking points; a provisional squad of up to 25 that the fourteen come
      from first, its players told how they stand when the squad is named;
      and a club match to go and watch, to know a player better and have the
      night's report
- [x] Manage the team's finances: sponsorship, TV rights, gate receipts,
      wage budgets — and real bankruptcy risk. Set the ticket price, pick each
      summer's shirt sponsor (steady, performance or long-term), ask the board
      for better facilities, and take on up to two affiliate clubs. Gate
      receipts, prize money and travel reach the bank as each match is played
      and are settled once, with everything else, when the season closes
- [x] Manage the squad's roster: sign, release and loan players, set the
      starting six and liberos, respect a 16-player squad cap. Loans carry
      promised playing time, monthly reports, a word with the loan club's
      coach and a recall when the promise isn't kept
- [x] An owner behind every club — its members, a local businessman, a
      tycoon or an investment consortium, with their own means, ambition and
      patience. Each summer he sets a wish of his own — a trophy, a profit,
      the young players given their chance, a top-three finish — judged at the
      season's end; he can be asked for money for transfers, a rich one
      covers a season in the red, and now and then the club changes hands
- [x] What the club stands for: each season the board name two principles,
      from who owns the club — young players given their chance, a team built
      round the country's own, attacking volleyball, going after the serve,
      living within the means — followed as the season goes and weighed at
      its end. And board meetings, once every six weeks: put a case for more
      money for wages, or for a target the squad can actually reach (never
      free)
- [x] The press's predictions: before each league starts the papers tip its
      table from the squads, the manager hears where his side is tipped, the
      league table carries the tip beside each club, and at the season's end
      the papers own up — and the board weigh the manager's finish against
      the tip
- [x] A squad planner: the squad by position over this season and the next
      two — who is under contract, whose deal runs out, who may retire, the
      academy players coming through, each player's ability projected for
      that season — the gaps against the depth a side needs, and the wage
      bill each season against the budget. Mark transfer targets against
      each gap, from the scouts' list (within reach first) or from a
      player's profile
- [x] A monthly staff meeting: on the 3rd of each month the assistant, the
      scouts, the doctor, the youth coach and the psychologist bring
      concrete suggestions — a key contract to renew, a position short for
      next season, a player heading for an injury, an academy player ready,
      a youngster who needs a loan, a player to sell, one who is down. Take
      each one (it is done, or the talks open) or leave it; what is left
      unanswered lapses at the next meeting
- [x] A Director of Football: a staff role of his own, rated as a
      negotiator. Hand him a signing or a renewal with the most he may pay —
      a fee and a wage — and he bids, haggles over the terms and walks away
      past the limit, reporting to the inbox either way. A better director
      comes in under the limits more often
- [x] Delegation: choose who handles contract renewals (you or the
      director), pre-season friendlies (you, the assistant or the director),
      training (you or the assistant) and press conferences (you or the
      assistant). The director goes through the expiring contracts each
      winter, keeping whoever is worth it within the wage budget; the
      assistant fronts the press and runs the training programme
- [x] A shortlist and scout missions: shortlist anyone from his profile, and
      send the scouts out with a brief — "an opposite aged 24 or under, up to
      €200k", a level, a region, free agents only. Every week each mission
      brings new names that fit, onto the shortlist and into the inbox, rated
      as well as the scouts know where the player plays
- [x] Agents with a personality: each has a commission (on a new deal and on
      a renewal), a style, contacts at home or abroad, and how often he takes
      clients elsewhere. Hardball agents have their clients ask for release
      clauses; agents offer you their clients for the gaps in your squad
      plan; and a player whose contract is running out can sign a
      pre-contract with another club and leave in the summer unless renewed
- [x] Deadline day: a screen of its own on the last day of each window — a
      clock running down to midnight at the speed you choose, the live feed
      of the other clubs' late deals and the rumours, last-minute bids for
      your players to answer, your own talks still open and your shortlist to
      bid from (or hand to the director) before the window shuts
- [x] A preview in the inbox before each of your matches: the analysts' odds
      (the match played 400 times over in the background engine), every
      result's chance from 3-0 to 0-3, both sides' form and the fans' poll —
      and the fans' own calls, partisan as fans are. After the final whistle
      the thread carries on: whoever called the score lets everyone know
- [x] Supporters: every club's following grows with wins, derbies won,
      trophies and stars signed, shrinks a little with defeats, and drifts
      towards what its standing draws — filling the arena or leaving it half
      empty, and selling the shirts that make the merchandise takings. Ask the
      board for a new stand: paid up front, months in the building, worth it
      only if the following comes
- [x] Pre-season friendlies, arranged with any club or by the board
- [x] Travel and a crowded calendar: a side playing away travels the day
      before — across town is nothing, across a big country costs some
      condition, a flight abroad more — and every match adds to a player's
      load, which ebbs day by day: three matches in a week and he recovers
      more slowly, so a congested run wears a side down unless it rotates.
      The assistant warns of a busy run and of heavy legs
- [x] Weekly training plans, individual training, and players learning new
      positions in training and on court, driven by age, potential, coaching
      quality, facilities and the player's own professionalism
- [x] A pre-season training camp: a week at home (cheap, good for the
      group), at altitude (more in the young players' legs, everyone tired
      for a few days) or abroad (the dearest, the dressing room tight for
      months), booked for a week clear of matches
- [x] Mentoring: pair a young player (23 and under) with a veteran (28 and
      over) — two at most each — and he comes on quicker, most of all under a
      mentor of his own position; the mentor's professionalism and
      determination rub off on him, and now and then one of his traits
- [x] Youth Academy with an annual intake, including rare "golden generation"
      prospects
- [x] Injuries treated as the manager decides, on the doctor's advice: rush
      a player back — a third less time out, but short of fitness and, for
      five weeks, liable to break down again in any match, less so with good
      doctors and facilities — let the doctors do it their way, or take it
      slowly and have him back fit and without the risk
- [x] Player ageing, injuries with permanent career effects, and procedurally
      generated "regens" that keep the world populated across a fifty-season
      career
- [x] A livelier market: the papers link your best players with bigger
      clubs, and an ambitious one's head turns; a rival chasing your target
      puts in a formal bid the selling club tells you to beat within days, or
      he goes to them; and deadline day — the morning warning, every answer
      given on the day, the bids flying in, the other clubs' late business
      rounded up in the papers that night
- [x] A player has his say on every bid for him — wants the move, would
      rather stay, or could go either way — and it shows on the offer: turn
      down a move he wanted and he may hand in a transfer request; sell one
      who wanted to stay and he will most likely refuse. A request to leave
      can be taken back, once he has settled
- [x] Contracts with small print: appearance and title bonuses, paid with
      the season's wages; a release clause — a player good enough for better
      asks for one, and any club that pays it can't be refused, his or yours;
      and a club option on one more season, taken up by 1 May. Every player
      has an agent, one of a dozen in his country, who wants his fee on the
      deal: a hard bargainer asks for more, has less patience and pushes his
      clients towards a move; an easy-going one asks for less
- [x] Staff reports in the inbox: the assistant's weekly word on the squad,
      the scouts' report on every opponent two days out, a warning before an
      unhappy player asks to leave, club milestones; and for the national
      team, the squad's club form (weekly with only a country to coach),
      their injuries as they happen, and the world ranking each month — how
      often each comes, or whether it comes at all, set from the inbox
- [x] A game plan for every opponent from the scouts' report: serve their
      weakest passer, hard against a side that passes well and safe against
      one that doesn't, commit the block on a quick-heavy offence or spread
      it against one that lives on its pins, dig deep or cover the short
      court as their hitters play — each instruction beside yours, and why;
      one button puts it into every rotation, another takes it back
- [x] One-to-one talks with players, held as a conversation in your office:
      praise, criticism, encouragement, a promise of games that is called in
      later — each answered in the player's own words — and players kept
      unhappy asking to leave
- [x] Rivalries: clubs of the same city play a derby — a full house, a
      board that takes the result to heart, a dressing room that feels it for
      days, the papers and the fans making the most of it — and each
      country's two leading clubs play the classic
- [x] A dressing room with its leaders, a captain and a vice-captain who
      takes the armband if he goes, and a cohesion that grows with time
      together, suffers with new faces and a leader's departure, and is worth
      a little on court. Its groups — each country's players, the young ones,
      the veterans — pull their members' moods together: a foreign newcomer
      alone is isolated, an unhappy group drags the room down, a clique from
      abroad keeps to itself, and a few veterans steady it
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
- [x] Real players written in by hand, with their own photo: Diogo Couto, a
      Portuguese libero who can also play outside hitter, starts every men's
      career as a free agent (and joins older saves the same way)
- [x] Database of 100,000+ fictitious players, generated with realistic
      positions, anthropometrics and national distributions
- [x] Save and load a career, locally in the browser (IndexedDB) — multiple
      careers side by side, each resumable from the main menu — and export
      any of them to a file, to keep or move to another computer, and import
      it back from the main menu. The file is written and read as a stream of
      small JSON lines, never one string, so a career of any length goes out
      (a large world nine seasons in: a 77 MB file); where the browser allows,
      the player picks where it is saved

### INTERFACE

- [x] A live match viewer in 2D or 3D (three.js): a real court with a crowd,
      a referee and both benches, every player moving through each phase of
      the rally, substitutes warming up and walking on through the
      substitution zone, the libero swapping in and out, defenders diving
      full length for balls — flat out on the floor, or over sideways — and
      a medic running on to an injured player. Two line judges at opposite
      corners flag every ball near their lines: in, out, or off the block; and
      the video replay goes in close, low over the spot where it came down
- [x] Players drawn as bodies, not mannequins: smooth limbs shaped by their
      muscles, a ball in every joint so bends stay one surface, a face (jaw,
      nose, ears, eyes, brows) under hair with strands in it, hands with a
      thumb; the kit as cloth with a satin sheen — collar, short sleeves cuffed
      in the role's colour, the number outlined on the back, side panels —
      shorts cut at the thigh, knee pads with their cushion, crew socks, court
      shoes on a sole. Lit as an arena is: the hall's light from every side,
      a cool edge from the far stand, film-like tone mapping that keeps the
      kits' colours. In the women's game, women's bodies and hair (a ponytail,
      a bun or a bob)
- [x] Players move as athletes do: each move flows through its key poses on
      one smooth curve rather than stopping at each, and the body carries its
      momentum into the next when one is cut short; they speed up and brake
      instead of starting and stopping dead, leaning into a burst of pace and
      back off a hard stop, and turn with a swing. Running, the foot on the
      floor stays put while the body passes over it — the faster the run, the
      less of each stride it spends there — and the heel kicks up behind; the
      first step comes from the feet together. A jump leaves the floor and
      lands through the legs, with a give at the knees; the head follows the
      ball a moment behind it. Side-on, players shuffle — step and close,
      the feet never crossing — and a tip or a roll shot is played with its
      own soft arm, not the full swing. After every point both sides come
      together: the winners run to whoever won it — the hitter, the blocker
      who stuffed it, the server's ace, roaring — and slap hands in the
      middle; the side that lost it takes it in, then gathers for a low five
- [x] A coach's bar during the match: a timeout opens the timeout screen;
      the substitutions panel holds play while it is open; clicking one of
      your players beside the court offers who could come on for him; any
      player's profile opens over the match
- [x] A live commentary ticker alongside the match, plus flashed callouts for
      the moments that deserve one — "MONSTER SPIKE!", "HUGE BLOCK!", "ACE!"
- [x] Around the league, beside your match: the rest of the round unfolds in
      step with it, set for set, and the table as it would stand if every
      match ended now
- [x] Before the first serve, a last warm-up, the line-up and hands slapped
      through the net; at a time-out both sides go to their benches and stand
      round the coach, who makes his point
- [x] Pre-match interviews, post-match press conferences, and a world news
      feed with the fans' comments under each story
- [x] A press room that never asks the same conference twice: the journalists
      work from their notebooks — the box score (the night's top scorer, the
      aces, the blocks, the errors, the passing, a run of points, the set that
      went 32-30), the table, the last meeting, the fixtures piling up, who is
      hurt, who has just signed, a milestone, a contract running down — each
      in a voice of their own (the statistician, the straight talker, the
      local reporter, the tactician, the feature writer, the headline hunter).
      They remember: a topic asked lately rarely comes up again, a bold
      promise before a match is quoted back after it, and a bold answer draws
      a follow-up. The room reacts to every answer, the effect of each tone on
      morale is shown as it is chosen, and the conference ends on tomorrow's
      back page — its headline posted to the news with the fans' say under it.
      Over a career each journalist keeps a relationship with the manager,
      from hostile to an ally: answers that land warm it, answers that grate
      cool it, a conference declined costs a little with everyone who came —
      and an ally comes in warm while a hostile one comes in wary
- [x] The national team gets what a club gets around its matches: the press
      the day before and after (questions of the tournament, the hosts, a
      medal — answers that move the fourteen's morale, not the club's), the
      scouts' report on the other nation two days out with their plan to put
      into the national team's instructions, and the trophy when a final is won
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
- [x] Whatever makes the game wait — saving, save and exit, loading,
      exporting or importing a career file, building a new world — puts up
      a processing window: what is being done, a ball in the air, a bar
      that fills where the progress is known, and the stages ticking off.
      It keeps moving even while a big save holds the page
- [x] An inbox laid out like a mail client: folders by department (transfers,
      contracts, scouting, medical, matchday, media, board, finance), an
      "action needed" filter, starring and archiving, and every message from
      someone — the medical room on injuries and recoveries, the league office
      with a round-up after every matchday, the finance office's monthly
      statement, rival clubs and agents
- [x] A club dashboard (next fixture, table, one to watch, form, top scorer,
      the board's mood, the money) and a month-by-month calendar of results,
      fixtures and transfer deadlines
- [x] Fixtures & Results a season at a time, any past season a pick away,
      and every match already played opens its report: the box score and
      the rotations kept with the save for good, the rally log while it is
      still in memory
- [x] An analysis room for the season: where our attacks came down and
      where theirs came down against us, as heat maps of the court, with the
      balls hit long, wide and off the block counted apart; each attacker's
      kill rate lane by lane; the side-out and break-point rates of every
      rotation; and how the attack and the side-out ran match by match
- [x] Any two players side by side — at a glance and every attribute, the
      better of each marked — picked from a profile among the squad, his own
      club and the players looked at lately; and each player's development
      charted season by season, against his potential for your own
- [x] Match sounds — the whistle, the ball, the crowd, the timeout hooter —
      made in the browser, with a mute button
- [x] In-game help, a topic at a time, and a hands-on tutorial for every new
      career: 34 steps through a first week in charge — the inbox, a player's
      profile and a talk with him, the dressing room, the team sheet and the
      instructions, training, transfers and the money, then match day: the
      team talk, kick off, a timeout, the challenge — each pointing at the one
      thing to use, the rest of the screen held, until the player has done it
- [x] Every screen fits the window, Football Manager style: the page never
      scrolls, long lists scroll inside their own panels, and the layout
      follows the height that can actually be seen
- [x] Settings: a larger text size (the whole interface grows, as far as the
      window has room), colour-blind friendly colours (good and bad in blue
      and orange), and less motion
- [x] An editor and a kit designer: a club's name, arena and money; a
      player's name, position, nationality, height, potential and every
      attribute; each club's colour, shirt, shorts and libero shirt — worn in
      every match, the away side changing on a clash. An edited career earns
      no achievements

### PLANNED FEATURES

- [ ] More performance work on simulating a season (around 19 seconds a
      season on the small world from the command line, down from 31)
- [ ] Simulating off the main thread: a Web Worker was measured and set
      aside for now — copying the world to it and back costs about as much
      as the season's rollover it would take off the screen

## CALENDAR

Every season follows the FIVB's 2025–2028 calendar, the women's and the men's.
A save from before this calendar keeps the old dates for the season it is in
and switches to these from the next one. The season closes on 30 June.

### National teams

| Event | Men | Women |
|---|---|---|
| Nations League | 10 Jun – 2 Aug | 3 Jun – 26 Jul |
| Nations League, Olympic year | 24 May – 25 Jun | 10 May – 11 Jun |
| World Championship (odd years) | 10–26 Sep (12–28 Sep in 2025, 2029…) | 20 Aug – 5 Sep (22 Aug – 7 Sep in 2025, 2029…) |
| Olympic Games (Los Angeles 2028) | 15–29 Jul | 15–30 Jul |
| EuroVolley (even years) | 9–26 Sep | 21 Aug – 6 Sep |
| Asian Championship | 4–13 Sep | 21–30 Aug |
| NORCECA Championship | 11–19 Sep | 21–29 Aug |
| African Championship | 13–26 Sep | 23 Aug – 5 Sep |
| South American Championship | 15–20 Sep | 10–16 Sep |
| Continental qualifiers (odd years) | 11–22 Aug | 4–15 Aug |

Squads are named 7 days before the first match.

### Clubs

| Event | Men | Women |
|---|---|---|
| Pre-season friendlies | 11 Sep – 12 Oct | 28 Aug – 28 Sep |
| Super cup | 11 Oct | 27 Sep |
| League, regular season | 16 Oct – ~23 Mar | 2 Oct – ~9 Mar |
| League playoffs | 30 Mar – end of April | 16 Mar – ~10 Apr |
| National cup | 29 Oct, 26 Nov, 7 Jan, 28 Jan, final 25 Feb | 15 Oct, 12 Nov, 24 Dec, 14 Jan, final 11 Feb |
| Champions League | groups 9 Dec – 3 Mar, quarter-finals 17 Mar, Final Four 15–16 May | groups 25 Nov – 17 Feb, quarter-finals 3 Mar, Final Four 1–2 May |
| CEV Cup | 12 Nov – final 11 Mar | 29 Oct – final 25 Feb |
| Club World Championship (every 4 years) | 14–20 Dec | 7–13 Dec |
| South American Club Championship | 25 Feb – 1 Mar | 18–22 Feb |
| Asian Club Championship | 13–17 May | 26–30 Apr |
| African Club Championship | 25 Apr – 3 May | 9–13 Apr |
| NORCECA Club Championship | 13–17 Mar | 27 Feb – 3 Mar |

The club season ends on 17 May for the men and on 3 May for the women. In the
season before an Olympic Games it ends 9 days earlier.

These dates are estimates, because no official ones were published: the
women's South American Championship, the men's South American and women's
African club championships, and the NORCECA Club Championship (which has no
real counterpart). Years after 2028 repeat the 2025–2028 cycle.

### Sources

- [FIVB volleyball calendar 2025–2028 (PDF)](https://www.fivb.com/wp-content/uploads/2024/03/VB_CALENDAR_2025-2028_17.12.25.pdf)
- [2026 Men's Volleyball Nations League](https://en.wikipedia.org/wiki/2026_FIVB_Men%27s_Volleyball_Nations_League)
- [2026 Women's Volleyball Nations League](https://en.wikipedia.org/wiki/2026_FIVB_Women's_Volleyball_Nations_League)
- [2026 VNL finals in Macau (Macao government)](https://www.gov.mo/en/news/402976/)
- [2027 Men's World Championship](https://en.wikipedia.org/wiki/2027_FIVB_Men%27s_Volleyball_World_Championship)
- [2027 Women's World Cup](https://en.wikipedia.org/wiki/2027_FIVB_Women%27s_Volleyball_World_Cup)
- [Volleyball at the 2028 Summer Olympics](https://en.wikipedia.org/wiki/Volleyball_at_the_2028_Summer_Olympics)
- [CEV EuroVolley 2026 schedule](https://www.cev.eu/articles/volleyball/cev-eurovolley-2026-full-competition-schedule-now-released/)
- [AVC 2026 Continental Championships](https://asianvolleyball.net/new/?p=146848)
- [2026 NORCECA Men's Continental Championship](https://volleyball.ca/en/competitions/2026-norceca-men-s-continental-championship)
- [2026 NORCECA Women's Continental Championship](https://norceca.info/2026-norceca-womens-continental-championship-presented-in-santo-domingo/)
- [Africa's volleyball events in 2026](https://allafrica.com/stories/202601090060.html)
- [2026 South American Men's Championship](https://www.mixvale.com.br/2026/08/14/south-american-mens-volleyball-championship-2026-check-dates-format-en/)
- [CEV Champions League 2026/27 (Lega Volley)](https://www.legavolley.it/2026/approaching-champions-league-draw/?lang=en)
- [2026 AVC Men's Champions League](https://en.wikipedia.org/wiki/2026_AVC_Men%27s_Volleyball_Champions_League)
- [2026 South American Women's Club Championship](https://www.futbolperuano.com/liga-voley/sudamericano-de-clubes-de-voley-2026-en-peru-se-confirmaron-las-fechas-y-los-nueve-equipos-que-lucharan-por-el-titulo-continental-558372)

## LICENSE

Copyright (c) 2026 Miguel Caldas. All rights reserved.

This is proprietary software. No part of it — code, art or data — may be
copied, modified, distributed or used without the author's written
permission.

## FIVB DATA

The game ships **no FIVB data**, and this is deliberate. `src/data/fivb/`
contains a working client for the official FIVB VIS web service — the
Volleyball Information System behind the official player pages, rankings and
results — but the VIS database is the FIVB's property and most fields are
gated behind credentials the FIVB issues. If you hold VIS credentials, you can
import real players into your own local save; the procedurally generated world
exists so the game is complete and playable without them. Imported data stays
on the machine that imported it and is never committed to this repository.
