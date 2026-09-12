// playfab-auth.js
const PLAYFAB_TITLE_ID = "1E90D8";
const DISCORD_CLIENT_ID = "1547808053078925332";
const GUEST_ID_KEY = "vbr_guest_custom_id";

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
 * Initializes PlayFab and executes a callback upon successful login.
 * Automatically checks if returning from a Discord login.
 * Falls back to a guest account if no Discord session is present or if linking fails.
 * 
 * @param {Function} onSuccess - Callback invoked when login succeeds (returns result & authType).
 * @param {Function} onError - Callback invoked when login fails completely.
 */
function initPlayFabSession(onSuccess, onError) {
    if (typeof PlayFab === "undefined" || typeof PlayFabClientSDK === "undefined") {
        if (onError) onError(new Error("PlayFab SDK not loaded."));
        return;
    }

    PlayFab.settings.titleId = PLAYFAB_TITLE_ID;

    // Check URL fragment for a Discord OAuth access token
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');

    if (accessToken) {
        // Clear fragment from address bar for clean presentation
        history.replaceState(null, "", window.location.pathname + window.location.search);

        // Fetch Discord profile to retrieve user ID for PlayFab session mapping
        fetch('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        })
        .then(res => res.json())
        .then(user => {
            if (!user || !user.id) throw new Error("Invalid response from Discord API.");

            // Log into PlayFab using the Discord account link key
            const discordCustomId = "WEB_LINK_SESSION_" + user.id;
            const loginRequest = {
                TitleId: PLAYFAB_TITLE_ID,
                CreateAccount: false, // Must already be linked via link-discord.html
                CustomId: discordCustomId
            };

            PlayFabClientSDK.LoginWithCustomID(loginRequest, (result, error) => {
                if (error) {
                    console.warn("[PlayFab Auth] Discord-linked PlayFab login failed or account not linked. Falling back to Guest Account.", error);
                    loginAsGuest(onSuccess, onError);
                } else {
                    if (onSuccess) onSuccess(result, "discord", user);
                }
            });
        })
        .catch(err => {
            console.warn("[PlayFab Auth] Failed to fetch Discord user profile. Falling back to Guest Account.", err);
            loginAsGuest(onSuccess, onError);
        });
    } else {
        // No Discord token in URL -> Authenticate as Guest
        loginAsGuest(onSuccess, onError);
    }
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
