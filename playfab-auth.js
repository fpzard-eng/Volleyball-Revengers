const PLAYFAB_TITLE_ID = "1E90D8";
const DISCORD_CLIENT_ID = "1547808053078925332";
const GUEST_ID_KEY = "vbr_guest_custom_id";
const DISCORD_SESSION_KEY = "vbr_discord_session_user";

// REPLACE THIS WITH YOUR HOSTED BOT SERVER URL (e.g., Render, Railway, Heroku)
// If running locally for testing, use "http://localhost:3000"
const BOT_SERVER_URL = "https://your-bot-server-url.com"; 

/**
 * Generates or retrieves a local guest identifier.
 */
function getOrCreateGuestId() {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
        id = `Guest_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
        localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
}

/**
 * Redirects the user to Discord OAuth authorization.
 */
function redirectToDiscordLogin() {
    const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=token&scope=identify`;
    window.location.href = discordAuthUrl;
}

/**
 * Clears saved Discord session and reloads page to log out.
 */
function logoutDiscordUser() {
    localStorage.removeItem(DISCORD_SESSION_KEY);
    window.location.reload();
}

/**
 * Helper to verify Discord link status via backend Bot service and log into PlayFab.
 */
function executePlayFabDiscordLogin(user, onSuccess, onError) {
    // Check if BOT_SERVER_URL is configured
    if (!BOT_SERVER_URL || BOT_SERVER_URL.includes("your-bot-server-url.com")) {
        console.warn("[PlayFab Auth] BOT_SERVER_URL not configured. Attempting direct PlayFab Discord session login.");
        loginWithPlayFabCustomId(user, onSuccess, onError);
        return;
    }

    // Query backend bot service on hosted server
    fetch(`${BOT_SERVER_URL}/api/user-info?discordId=${user.id}`)
        .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        })
        .then(data => {
            if (data && (data.success || data.linked || data.playFabId)) {
                user.playFabId = data.playFabId || (data.user ? data.user.PlayFabId : null);
                user.displayName = data.displayName || user.username;
                loginWithPlayFabCustomId(user, onSuccess, onError);
            } else {
                console.warn("[PlayFab Auth] Discord account is NOT linked via bot. Falling back to Guest.");
                localStorage.removeItem(DISCORD_SESSION_KEY);
                loginAsGuest(onSuccess, onError);
            }
        })
        .catch(err => {
            console.error("[PlayFab Auth] Failed to verify backend status. Falling back to Guest.", err);
            localStorage.removeItem(DISCORD_SESSION_KEY);
            loginAsGuest(onSuccess, onError);
        });
}

/**
 * Internal PlayFab Login helper for Discord Session
 */
function loginWithPlayFabCustomId(user, onSuccess, onError) {
    const discordCustomId = "WEB_LINK_SESSION_" + user.id;
    const loginRequest = {
        TitleId: PLAYFAB_TITLE_ID,
        CreateAccount: false,
        CustomId: discordCustomId
    };

    PlayFabClientSDK.LoginWithCustomID(loginRequest, (result, error) => {
        if (error) {
            console.warn("[PlayFab Auth] PlayFab login error for Discord user. Falling back to Guest.", error);
            localStorage.removeItem(DISCORD_SESSION_KEY);
            loginAsGuest(onSuccess, onError);
        } else {
            if (onSuccess) onSuccess(result, "discord", user);
        }
    });
}

/**
 * Initializes PlayFab session with full persistence checks.
 */
function initPlayFabSession(onSuccess, onError) {
    if (typeof PlayFab === "undefined" || typeof PlayFabClientSDK === "undefined") {
        if (onError) onError(new Error("PlayFab SDK not loaded."));
        return;
    }

    PlayFab.settings.titleId = PLAYFAB_TITLE_ID;

    // STEP 1: Check URL hash for new OAuth access token
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

    // STEP 2: Check localStorage for existing Discord session
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

    // STEP 3: Fall back to Guest Account
    loginAsGuest(onSuccess, onError);
}

/**
 * Logs in using a Local Custom Guest ID.
 */
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
