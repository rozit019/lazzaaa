# Lazzaa

3D runners-vs-chasers game. Single player against bots, or multiplayer rooms (up to 12 people, bots fill the rest).

## Run on your computer
    npm install
    npm start
Then open http://localhost:3000

## Put it on Render
1. Push this folder to a GitHub repository.
2. On Render: New > Web Service > pick the repository.
3. Build command: `npm install`   Start command: `npm start`
4. Open the address Render gives you. Create a room and send the invite link to friends.

Optional environment variables:
- `ALLOWED_ORIGIN` - only needed if the page is hosted on another site (for example Vercel). Put that site's address here, and set `window.IC_SERVER` in `public/index.html` to the Render address.
- `MAX_ROOMS` - how many rooms may exist at once (default 40).

`/health` answers with a small status message; point an uptime pinger at it to keep a free server awake.

Nothing is saved: rooms live in the server's memory and vanish when closed or when the server restarts.

## Icons
All icons are files in `public/icons/` (Microsoft Fluent Emoji, flat style, MIT licence). `public/icons.js` lists which icon replaces which symbol. To change an icon, replace its `.svg` file with another one of the same name.
