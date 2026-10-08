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
| `/` | Director | List and create tournaments |
| `/director/:id` | Director | Run the clock; buy-in, rebuy, add-on, late registration and guarantee settings; payout table (automatic about 15% paid, or edit the percentages by hand) |
| `/desk/:id` | Desk | Register and seat players, take rebuys and add-ons (shows the amount to collect), prize pool summary, mark prizes paid, results as CSV |
| `/floor/:id` | Floor staff | Phone or tablet view: bust players (with undo), move players, balance and break tables, redraw seats, hand-for-hand |
| `/display/:id` | Big screen | Clock, blinds, next level; click once for full screen and sound. `?theme=midnight` overrides the theme |
| `/payouts/:id` | Second screen | Prize pool and payout table, filling in each place as players finish |
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

Every change is also written to `action_log`, which later steps use for the audit trail and undo.
