const PLAYFAB_TITLE_ID = "1E90D8";
const DISCORD_CLIENT_ID = "1547808053078925332";
const GUEST_ID_KEY = "vbr_guest_custom_id";
const DISCORD_SESSION_KEY = "vbr_discord_session_user";
const BOT_SERVER_URL = "https://vbr-assistant-coach.onrender.com";


function getOrCreateGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
        id = `Guest_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
        localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
}

function redirectToDiscordLogin() {
    const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token&scope=identify`;
    window.location.href = discordAuthUrl;
}

function logoutDiscordUser() {
    localStorage.removeItem(DISCORD_SESSION_KEY);
    window.location.reload();
}

async function executePlayFabDiscordLogin(discordId) {
    const customId = `DISCORD_${discordId}`;

    return new Promise((resolve, reject) => {
        PlayFabClientSDK.LoginWithCustomID({
            TitleId: PlayFab.settings.titleId,
            CustomId: customId,
            CreateAccount: true,
            InfoRequestParameters: {
                GetUserAccountInfo: true
            }
        }, (error, result) => {
            if (error) {
                console.warn(`[PlayFab Auth] Failed to authenticate CustomID: ${customId}`, error);
                return executePlayFabGuestLogin()
                    .then(resolve)
                    .catch(reject);
            }

            console.log(`[PlayFab Auth] Successfully logged in as ${customId}`);
            resolve(result.data);
        });
    });
}

function executePlayFabGuestLogin() {
    return new Promise((resolve, reject) => {
        let guestId = localStorage.getItem('vbr_guest_id');
        if (!guestId) {
            guestId = 'GUEST_' + Math.random().toString(36).substring(2, 11);
            localStorage.setItem('vbr_guest_id', guestId);
        }

        PlayFabClientSDK.LoginWithCustomID({
            TitleId: PlayFab.settings.titleId,
            CustomId: guestId,
            CreateAccount: true
        }, (error, result) => {
            if (error) return reject(error);
            console.log('[PlayFab Auth] Logged in with Guest Account:', guestId);
            resolve(result.data);
        });
    });
}


function initPlayFabSession(onSuccess, onError) {
    if (typeof PlayFab === "undefined" || typeof PlayFabClientSDK === "undefined") {
        if (onError) onError(new Error("PlayFab SDK not loaded."));
        return;
    }

    PlayFab.settings.titleId = PLAYFAB_TITLE_ID;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');

    if (accessToken) {
        history.replaceState(null, "", window.location.pathname + window.location.search);

        fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        })
        .then(res => res.json())
        .then(user => {
            if (!user || !user.id) throw new Error("Invalid Discord user payload.");

            localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(user));
            executePlayFabDiscordLogin(user, onSuccess, onError);
        })
        .catch(err => {
            console.warn("[PlayFab Auth] Failed fetching Discord profile. Falling back to Guest.", err);
            loginAsGuest(onSuccess, onError);
        });
        return;
    }

    const savedSession = localStorage.getItem(DISCORD_SESSION_KEY);
    if (savedSession) {
        try {
            const user = JSON.parse(savedSession);
            if (user && user.id) {
                executePlayFabDiscordLogin(user, onSuccess, onError);
                return;
            }
        } catch (e) {
            console.error("[PlayFab Auth] Corrupted local session found. Clearing.");
            localStorage.removeItem(DISCORD_SESSION_KEY);
        }
    }

    loginAsGuest(onSuccess, onError);
}

function loginAsGuest(onSuccess, onError) {
    const loginRequest = {
        TitleId: PLAYFAB_TITLE_ID,
        CreateAccount: true,
        CustomId: getOrCreateGuestId()
    };

    PlayFabClientSDK.LoginWithCustomID(loginRequest, (result, error) => {
        if (error) {
            if (onError) onError(error);
        } else {
            if (onSuccess) onSuccess(result, "guest", null);
        }
    });
}
