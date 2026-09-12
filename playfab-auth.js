// playfab-auth.js
const PLAYFAB_TITLE_ID = "1E90D8";
const DISCORD_CLIENT_ID = "1547808053078925332";
const GUEST_ID_KEY = "vbr_guest_custom_id";
const DISCORD_SESSION_KEY = "vbr_discord_session_user";

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
 * Queries the Bot API to check if a Discord account is linked to PlayFab.
 * @param {string} discordId 
 * @returns {Promise<Object>} API response payload
 */
async function checkDiscordLinkStatus(discordId) {
    try {
        const response = await fetch(`/api/user-info?discordId=${discordId}`);
        const data = await response.json();
        return data;
    } catch (err) {
        console.error("[PlayFab Auth] Error checking Bot API link status:", err);
        return { success: false, linked: false };
    }
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
 * Helper to log into PlayFab using a Discord User Object and verify via Bot API.
 */
function executePlayFabDiscordLogin(user, onSuccess, onError) {
    const discordCustomId = "WEB_LINK_SESSION_" + user.id;
    const loginRequest = {
        TitleId: PLAYFAB_TITLE_ID,
        CreateAccount: false,
        CustomId: discordCustomId
    };

    PlayFabClientSDK.LoginWithCustomID(loginRequest, async (result, error) => {
        if (error) {
            console.warn("[PlayFab Auth] Discord PlayFab login failed. Removing saved session & using Guest.", error);
            localStorage.removeItem(DISCORD_SESSION_KEY);
            loginAsGuest(onSuccess, onError);
        } else {
            // Check link status with backend bot service
            const botInfo = await checkDiscordLinkStatus(user.id);
            user.isLinked = !!(botInfo.success || botInfo.linked);
            user.botData = botInfo;

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
        // Clean URL fragment
        history.replaceState(null, "", window.location.pathname + window.location.search);

        // Fetch user from Discord API
        fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        })
        .then(res => res.json())
        .then(user => {
            if (!user || !user.id) throw new Error("Invalid Discord user payload.");

            // Save session to localStorage for persistence across reloads
            localStorage.setItem(DISCORD_SESSION_KEY, JSON.stringify(user));

            // Execute PlayFab login
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
