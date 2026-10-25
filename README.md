# AHEP Games - Cadalozlar ⚽🧠

Multiplayer games for friends: **Guess the Footballer**, **Team Trivia**, **Academic Quiz**,
**Team & Nation Guess** and **Transfer Auction**.
Users only pick a username (no password); points are stored per user per game.

- Hosting: GitHub Pages (free)
- Database: Firebase Realtime Database + Anonymous Auth (free Spark plan)
- No build step: plain HTML/JS modules

| Guess the Footballer (guesser) | Guess the Footballer (picker) |
|---|---|
| ![Guesser view](docs/fb-guesser.png) | ![Picker view](docs/fb-picker.png) |
| **Team Trivia (answering team)** | **Team Trivia (steal chance)** |
| ![Trivia answer](docs/tr-answer.png) | ![Trivia steal](docs/tr-steal.png) |

Add `?demo` to the site URL to try it in local demo mode without touching the real database.

## Try it locally (no setup)

```bash
py -m http.server 8123
```

Open http://localhost:8123. Without a Firebase config the site runs in **local demo mode**:
everything is stored in this browser, and each tab can log in as a different player.

## Put it online

### 1. Firebase (database)
1. Go to https://console.firebase.google.com → **Add project** (Analytics not needed).
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Realtime Database → Create database** (pick a location, start in *locked mode*).
4. In the database's **Rules** tab, paste the contents of `database.rules.json` and **Publish**.
5. **Project settings (⚙️) → Your apps → Web (</>)** → register an app → copy the `firebaseConfig` object
   into `js/firebase-config.js` (replace the `PASTE_ME` values). Make sure `databaseURL` is filled in.
   These values are public by design; the rules above protect the data.

### 2. GitHub Pages (website)
1. Create a new GitHub repository and push this folder to it.
2. Repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / root**.
3. After a minute the site is at `https://<your-username>.github.io/<repo-name>/`.
4. In Firebase **Authentication → Settings → Authorized domains**, add `<your-username>.github.io`.

Share the link with your friends. 🎉

## Tournaments (Turnuvalar)
For Team Trivia and Academic Quiz (`#/tournaments`).
- Anyone can organize one: name, game, date and start time, max. teams (4/8/16), subjects (Team Trivia).
- Teams register with a name and 2–4 players (Academic Quiz: at least 3 departments); added players
  confirm their spot; the organizer approves or rejects teams. Registration is open until the start.
- At the start time the knockout bracket is drawn (byes if the number of teams is not a power of 2)
  and match rooms open by themselves; players get an invite pop-up. Matches have 10 questions, the
  final 20. A match starts when everyone is in, or after 3 minutes with 2+ players per team; a team with
  fewer than 2 players after 10 minutes loses by walkover.
- Medals for every team member: 🥇 champions, 🥈 finalists, 🥉 both losing semi-finalists, shown in a
  separate medal table (home page and tournaments page). Normal match points still count.
- There is no server: every open browser moves tournaments along, so at least one participant should
  have the site open at the start time.
- In normal Team Trivia and Academic Quiz rooms, team members can also rename their team.

## Online players & invites
The home page lists who is online right now and where they are. Inside a room the host has an
**Invite players / Oyuncu davet et** panel: online players get a pop-up and join with one tap
(or watch, if the game already started). There is also a button to copy the room link.

## Watching games
Anyone can watch a room with the **Watch / İzle** button, also while a game is running. Spectators
never see secret information: the secret footballer (until the end), teams' suggestions and votes,
the Team & Nation Guess picks (until the round's result), the game admin's answer list, or the
hidden auction player.
A spectator can switch to playing with **Join the game** while the room is still waiting.

## Closing rooms
The host can close a room at any time (**Close room / Odayı kapat**); everyone inside goes back to the
room list. Rooms are also deleted automatically: when the last player leaves, 3 minutes after a game
ends, after 45 minutes without any action, or after 6 hours at most.

## Game rules

**Guess the Footballer** (2–6 players)
- One player (the *picker*) secretly picks one of 675 footballers: the 450 most famous worldwide, the
  150 most famous Turkish players and 75 famous foreign players from the Süper Lig (Alex, Muslera, Hagi…).
- The others ask yes/no questions from the built-in pool (nationality, leagues, clubs, position,
  appearance, achievements). Answers are automatic. The grid of possible players shrinks after each answer.
- 10 questions and 2 guesses in total, split evenly between guessers. Leftovers are *shared*:
  a guesser proposes one, and all other guessers must agree.
- 10 minutes per round. If nobody finds the player (time up or guesses used up), the picker gets 500 pts.
- Pot = 1000 − 50 × questions − 50 × wrong guesses − 30 × minutes (min 100).
  The finder gets 70%, the other guessers share 30%.

**Team Trivia** (2 teams, at least 2 players each)
- The host picks subjects. Questions come from Open Trivia DB (in English) and are machine-translated
  into Turkish when a game starts; Turkish players also see the original answer when the translation
  differs. Answers in name-heavy subjects (music, film, TV, games, books, celebrities…) stay as they are.
  Pool: 4,444 multiple-choice
  questions across 22 subjects (counts per subject are in `js/trivia/questions.js`).
- Each question shows its 4 options from Open Trivia DB (1 right and 3 wrong answers).
- Coin flip decides who starts; the starting team alternates every question.
- 20 questions, 2 minutes each. Only the team captain submits; teammates can suggest.
- Wrong answer or time up → the other team gets 30 seconds to steal the point.
- A tie after 20 questions goes to sudden-death questions.
- Each question shows its difficulty. A right answer (or a steal) scores 1 point for easy,
  2 for medium and 3 for hard questions.
- Points: 10 × team score for everyone, +50 for the winning team (+25 each on a draw).

## Updating the footballer list

`data/players.json` is generated from Wikidata:

```bash
py scripts/build_players.py fetch
```

```bash
py scripts/build_players.py build
```

Appearance tags (hair, beard, skin tone), World Cup winners and missing positions are in
`scripts/appearance.txt`. Fix any mistakes there, then run `build` again.

**Academic Quiz / Akademik Bilgi Yarışması** (2 teams, at least 2 players each)
- 420 built-in university-level questions (Turkish and English, 4 options each), 60 per department:
  Business Administration, International Trade & Logistics, Tourism Management, Communication,
  Economics, Statistics and Econometrics (`data/academic/*.json`).
- Each team picks at least 3 departments. On a team's turn the question comes from its own
  departments; the other team can steal it.
- No captain: every member votes. More than half of the team's votes (or everyone voting) locks the
  answer; when time runs out the most-voted answer counts, and on a tie the one that got there first wins.
- Same timing, steals, difficulty points (1/2/3) and sudden death as Team Trivia.
- Question bank page (`#/academic/bank`): anyone can add questions; players can report a question
  during a game; admins listed in `js/admins.js` can hide reported questions or delete added ones.

**Team & Nation Guess / Takım & Milli Takım Tahmini** (2 players + 1 game admin)
- The host makes one person the game admin and two people players (others can watch).
- Each round both players pick a club or a nation from a list (at least one club; anything picked
  once can't be picked again). A coin flip decides who picks first; this alternates every round.
- Picks stay hidden until both players have chosen (the second player only sees whether the first
  pick is a club or a nation), then both are revealed together.
- Players say out loud a footballer who fits both picks. The game admin sees the matching players
  from a large pool of ~4,900 footballers (`data/pool.json`, built by `scripts/build_pool.py`) with a
  search box; correct players outside it also count. The admin clicks who said it first.
- 60 seconds per round; the admin can also end a round with "No valid player". First to 3 wins (+100 pts).

**Transfer Auction / Transfer Açık Artırması** (2 players, no points)
- Each player has €20. Positions come in order: goalkeeper, defender, midfielder, winger, striker.
- For each position one footballer is shown and one is hidden: one is a top player, the other a
  moderate one (by fame), in random order.
- Open auction on the shown player: it opens at €1 (the opener alternates), bids are whole euros,
  and the 10-second timer restarts after each bid. The highest bidder pays and gets the shown player;
  the other player gets the hidden one for free. If only one player has money left, they get the
  shown player for €1. Both teams always end with 5 players.

## Publishing changes
Run `py scripts/release.py` before each commit. It stamps a new version in `version.json` and
`js/app.js`; browsers that still have the old files cached notice it, re-download and reload once.

## Known limits
- No passwords, so anyone could log in with someone else's username. Fine among friends.
- Scores are computed in the browser, so a tech-savvy friend could cheat.
- League history comes from Wikidata and may miss some seasons.
