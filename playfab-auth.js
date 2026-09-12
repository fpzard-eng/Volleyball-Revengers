// playfab-auth.js
const PLAYFAB_TITLE_ID = "1E90D8";
const DISCORD_CLIENT_ID = "1547808053078925332";
const GUEST_ID_KEY = "vbr_guest_custom_id";
const DISCORD_USER_KEY = "vbr_discord_user";

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
 * Logs out the user by clearing stored Discord credentials and reloading.
 */
function logoutDiscordUser() {
    localStorage.removeItem(DISCORD_USER_KEY);
    window.location.reload();
}

/**
 * Authenticates with PlayFab using a Discord user object.
 */
function loginWithDiscordUser(user, onSuccess, onError) {
    const discordCustomId = "WEB_LINK_SESSION_" + user.id;
    const loginRequest = {
        TitleId: PLAYFAB_TITLE_ID,
        CreateAccount: false,
        CustomId: discordCustomId
    };

    PlayFabClientSDK.LoginWithCustomID(loginRequest, (result, error) => {
        if (error) {
            console.warn("[PlayFab Auth] Discord-linked PlayFab login failed. Clearing saved session and falling back to Guest Account.", error);
            localStorage.removeItem(DISCORD_USER_KEY);
            loginAsGuest(onSuccess, onError);
        } else {
            if (onSuccess) onSuccess(result, "discord", user);
        }
    });
}

/**
 * Initializes PlayFab session.
 * Checks URL for OAuth return, falls back to saved local session, then to Guest.
 */
function initPlayFabSession(onSuccess, onError) {
    if (typeof PlayFab === "undefined" || typeof PlayFabClientSDK === "undefined") {
        if (onError) onError(new Error("PlayFab SDK not loaded."));
        return;
    }

    PlayFab.settings.titleId = PLAYFAB_TITLE_ID;

    // 1. Check URL fragment for a new OAuth token redirect
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');

    if (accessToken) {
        // Clear fragment from address bar for clean presentation
        history.replaceState(null, "", window.location.pathname + window.location.search);

        fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        })
        .then(res => res.json())
        .then(user => {
            if (!user || !user.id) throw new Error("Invalid response from Discord API.");

            // Save user profile to keep session persistent across site visits
            localStorage.setItem(DISCORD_USER_KEY, JSON.stringify(user));
            loginWithDiscordUser(user, onSuccess, onError);
        })
        .catch(err => {
            console.warn("[PlayFab Auth] Failed to fetch Discord user profile. Falling back to Guest Account.", err);
            loginAsGuest(onSuccess, onError);
        });
        return;
    }

    // 2. Check for an existing saved Discord session
    const savedDiscordUser = localStorage.getItem(DISCORD_USER_KEY);
    if (savedDiscordUser) {
        try {
            const user = JSON.parse(savedDiscordUser);
            if (user && user.id) {
                loginWithDiscordUser(user, onSuccess, onError);
                return;
            }
        } catch (e) {
            localStorage.removeItem(DISCORD_USER_KEY);
        }
    }

    // 3. Fall back to Guest Account
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
