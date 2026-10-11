# PSICLOCK

Poker tournament clock and management for the Icelandic Poker Federation, built as a
replacement for Tournament Director. It runs as a small web server on the venue laptop;
every other device (floor phones, desk tablet, the big-screen TV) just opens it in a browser
on the same network.

## Requirements

- Node.js 22.13 or newer (Node 24 LTS recommended). The database uses Node's built-in SQLite,
  so there is nothing native to compile.

## Running at a venue

```
npm install
npm run build
npm start
```

The server prints the addresses to open, for example `http://192.168.1.20:3000`.
Open that on the big screen and on phones or tablets. Data is kept in `data/psiclock.db`
(change with `PSICLOCK_DB=path`; change the port with `PORT=8080`). Back up that one file.

The first time it starts, open `http://localhost:3000/login` on the laptop itself and create
the first login; it becomes the admin. Add logins for the desk and floor staff under Logins.
Anyone on the network can open the big screens without a login; everything else needs one.

On Windows the first start may ask to allow Node.js through the firewall; allow it on
private networks so other devices can connect.

## Developing

```
npm install
npm run dev        # server on :3000, web app with hot reload on :5173
npm test           # unit tests
npm run typecheck
```

## Pages

| Path | Who | What |
| --- | --- | --- |
| `/` | Anyone | List tournaments; staff see their links, directors can create tournaments |
| `/login` | Staff | Sign in; on a fresh install, create the first (admin) login from the laptop |
| `/director/:id` | Director | Run the clock; buy-in, rebuy, add-on, late registration and guarantee settings; payout table (automatic about 15% paid, or edit the percentages by hand) |
| `/desk/:id` | Desk | Register and seat players, take rebuys and add-ons (shows the amount to collect), prize pool summary, mark prizes paid, results as CSV |
| `/floor/:id` | Floor staff | Phone or tablet view: bust players (with undo), move players, balance and break tables, redraw seats, hand-for-hand |
| `/display/:id` | Big screen (no login) | Whatever the director puts on the screens: the clock layout, seating, player moves, payouts or a message. Click once for full screen and sound. `?scene=payouts` pins a TV to one scene, `?theme=midnight` overrides the theme |
| `/payouts/:id` | Second screen (no login) | The big screen pinned to the payout table |
| `/layouts` | Director | Build and save big-screen layouts: theme, colours, font, background, and widgets (sponsor logo, payouts, bustouts, countdowns, messages) placed around the clock, with a live preview |
| `/users` | Admin | Add staff logins, change roles, reset passwords, turn logins off |
| `/account` | Staff | Change your own password |
| `/players` | Desk | Player database: add with just a name, fill in details later |

## Layout

```
src/shared/        types, clock maths, seating rules and default blind structures (used by server and browser)
src/server/        Fastify server, REST API under /api, live updates on /ws
src/server/storage storage interface + SQLite adapter (a Postgres adapter can implement the same interface)
src/web/           React pages; big-screen themes are plain CSS files in src/web/themes
```

The clock is stored as "level N, X ms elapsed, running since T", and the current level is
always computed from the time. A restart or crash mid-level therefore loses nothing, and every
screen shows the same time because each corrects for its offset from the server clock.

Seating follows TDA practice: random seat draws, new players go to the shortest table, a
balance move is suggested when tables differ by two or more, and the highest-numbered table
is broken first once the others can seat everyone. The rules live in `src/shared/seating.ts`.

Money follows the same idea: buy-ins, rebuys and add-ons go into the prize pool and fees are
kept apart. Until the director saves their own percentages, about 15% of entries are paid on
a top-heavy curve, and prizes are rounded down to the rounding unit with the remainder added to
first place. Level limits for late registration and rebuys can be overridden at the desk. The
rules live in `src/shared/money.ts`.

Roles build on each other: Floor (bust, move, balance, break tables) < Desk (plus registration,
rebuys, add-ons, payouts, players) < Director (plus clock, settings, layouts, screens) < Admin
(plus logins). The rules for every API route are in one table in `src/server/auth.ts`; a route
missing from it is admin-only. Passwords are stored as scrypt hashes and sessions as hashed tokens.

Every change is also written to `action_log`, with the username of whoever made it.
