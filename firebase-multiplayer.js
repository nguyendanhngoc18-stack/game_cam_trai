import { firebaseConfig } from "./firebase-config.js";

const ROOM_ID = "rung-nho";
const FIREBASE_VERSION = "10.14.1";

export function createFirebaseMultiplayer({ onPlayersChanged, onChatMessage, onStatus }) {
    let database;
    let databaseSdk;
    let userId;
    let playerRef;
    let connected = false;
    let latestPlayer;
    let lastPublished;
    let startPromise;
    const players = new Map();

    function reportError(error) {
        console.error("Firebase multiplayer error:", error);
        onStatus("error", error.message || "Không thể kết nối Firebase.");
    }

    function publishPlayers() {
        onPlayersChanged(Object.fromEntries(players));
    }

    async function start() {
        if (startPromise) return startPromise;

        const requiredValues = [
            firebaseConfig.apiKey,
            firebaseConfig.authDomain,
            firebaseConfig.databaseURL,
            firebaseConfig.projectId,
            firebaseConfig.appId
        ];
        if (requiredValues.some(value => !value || value.startsWith("PASTE_"))) {
            onStatus("unconfigured");
            return;
        }

        onStatus("connecting");
        startPromise = (async () => {
            const [appSdk, authSdk, loadedDatabaseSdk] = await Promise.all([
                import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`),
                import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`),
                import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-database.js`)
            ]);

            const app = appSdk.initializeApp(firebaseConfig);
            const auth = authSdk.getAuth(app);
            const credential = await authSdk.signInAnonymously(auth);
            userId = credential.user.uid;
            databaseSdk = loadedDatabaseSdk;
            database = databaseSdk.getDatabase(app);
            playerRef = databaseSdk.ref(database, `rooms/${ROOM_ID}/players/${userId}`);

            const playersRef = databaseSdk.ref(database, `rooms/${ROOM_ID}/players`);
            databaseSdk.onChildAdded(playersRef, snapshot => {
                players.set(snapshot.key, snapshot.val());
                publishPlayers();
            }, reportError);
            databaseSdk.onChildChanged(playersRef, snapshot => {
                players.set(snapshot.key, snapshot.val());
                publishPlayers();
            }, reportError);
            databaseSdk.onChildRemoved(playersRef, snapshot => {
                players.delete(snapshot.key);
                publishPlayers();
            }, reportError);

            const chatQuery = databaseSdk.query(
                databaseSdk.ref(database, `rooms/${ROOM_ID}/chat`),
                databaseSdk.orderByChild("createdAt"),
                databaseSdk.limitToLast(25)
            );
            databaseSdk.onChildAdded(chatQuery, snapshot => {
                onChatMessage({ id: snapshot.key, ...snapshot.val() });
            }, reportError);

            const connectionRef = databaseSdk.ref(database, ".info/connected");
            databaseSdk.onValue(connectionRef, async snapshot => {
                connected = snapshot.val() === true;
                if (!connected) {
                    onStatus("disconnected");
                    return;
                }

                try {
                    await databaseSdk.onDisconnect(playerRef).remove();
                    if (latestPlayer) {
                        await databaseSdk.set(playerRef, latestPlayer);
                        lastPublished = JSON.stringify(latestPlayer);
                    }
                    onStatus("connected");
                } catch (error) {
                    reportError(error);
                }
            }, reportError);
        })().catch(error => {
            startPromise = undefined;
            reportError(error);
        });

        return startPromise;
    }

    function updatePlayer(player) {
        latestPlayer = {
            name: player.name,
            color: player.color,
            style: player.style,
            gender: player.gender,
            x: player.x,
            z: player.z,
            rotation: player.rotation,
            sitting: player.sitting
        };
        if (!connected || !playerRef) return;

        const serialized = JSON.stringify(latestPlayer);
        if (serialized === lastPublished) return;
        lastPublished = serialized;
        void databaseSdk.set(playerRef, latestPlayer).catch(error => {
            lastPublished = undefined;
            reportError(error);
        });
    }

    async function sendChat({ name, text }) {
        if (!connected || !database || !userId) {
            throw new Error("Chưa kết nối Firebase.");
        }

        const messageRef = databaseSdk.push(databaseSdk.ref(database, `rooms/${ROOM_ID}/chat`));
        await databaseSdk.set(messageRef, {
            uid: userId,
            name: name.slice(0, 18),
            text: text.slice(0, 180),
            createdAt: Date.now()
        });
    }

    return { start, updatePlayer, sendChat };
}
