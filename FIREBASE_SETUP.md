# Firebase multiplayer setup

The game uses Firebase Realtime Database for one shared room, anonymous
authentication, player position/appearance updates, and shared camp chat.
Without Firebase configuration, the existing local-only game still works.

## Create and configure the Firebase project

1. Create a project at https://console.firebase.google.com/ and add a Web app.
2. Copy the Web app configuration into `firebase-config.js`, replacing each
   `PASTE_...` value. Copy the Realtime Database URL shown for your database.
   The Firebase web configuration is meant to be used by browser apps; database
   access is protected by the rules below, not by hiding the config.
3. In **Authentication → Sign-in method**, enable **Anonymous**.
   In **Authentication → Settings → Authorized domains**, ensure the hosting
   domain is listed (for example `nguyendanhngoc18-stack.github.io`, or the
   `netlify.app`/`pages.dev` hostname you actually use).
4. In **Realtime Database**, create a database, open its **Rules** tab, paste
   the contents of `database.rules.json`, and publish the rules.
5. Commit and push `firebase-config.js`, `firebase-multiplayer.js`,
   `database.rules.json`, and the game changes to the branch used for hosting.
6. Open the hosted game in two browser windows, choose characters, and enter
   the map. The online indicator and shared chat should show the connection.

All visitors enter the same `rung-nho` room. Player presence is removed by
Realtime Database when a browser disconnects. The game sends position updates
only when the player state changes. Player appearance settings and chat are
shared; uploaded custom models, discovery progress, weather, time of day, and
music remain local to each browser. The backpack's tent, wood, fish, meat,
cooked food, placed tents/campfires, hunger, forage inventory, daily quest
progress, reward leaves, and campsite decorations are saved in that browser's
local storage; daily quests refresh using the player's local date. Other
visitors are shown with the built-in avatar using their selected appearance.

This is a client-authoritative prototype: users can change their own reported
position and send chat. Firebase rules prevent unauthenticated access and
editing another player's record, but do not provide moderation or anti-cheat.
Before sharing broadly, consider adding server-side validation/rate limits and
moderation, and monitor Firebase usage and quotas.
