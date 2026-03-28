function parseHostname(value) {
    try {
        return new URL(String(value || "").trim()).hostname.toLowerCase();
    } catch (error) {
        return "";
    }
}

function isPrivateHostname(hostname) {
    if (!hostname) {
        return false;
    }

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return true;
    }

    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) {
        return true;
    }

    const match = hostname.match(/^172\.(\d+)\./);
    if (match) {
        const secondOctet = Number(match[1]);
        return secondOctet >= 16 && secondOctet <= 31;
    }

    return false;
}

function getOxaPayDiagnostics() {
    const callbackUrl = String(process.env.OXAPAY_CALLBACK_URL || "").trim();
    const returnUrl = String(process.env.OXAPAY_RETURN_URL || "").trim();
    const publicIp = String(process.env.SERVER_PUBLIC_IP || "").trim();
    const issues = [];
    const hints = [];

    if (!process.env.OXAPAY_PAYOUT_API_KEY) {
        issues.push("OXAPAY_PAYOUT_API_KEY est manquante.");
    }

    const callbackHostname = parseHostname(callbackUrl);
    const returnHostname = parseHostname(returnUrl);

    if (callbackHostname && isPrivateHostname(callbackHostname)) {
        issues.push("OXAPAY_CALLBACK_URL pointe vers localhost ou une IP privee. OxaPay ne pourra pas joindre votre serveur depuis Internet.");
    }

    if (returnHostname && isPrivateHostname(returnHostname)) {
        issues.push("OXAPAY_RETURN_URL pointe vers localhost ou une IP privee. Le retour utilisateur ne fonctionnera que sur votre machine.");
    }

    if (!publicIp) {
        hints.push("Definissez SERVER_PUBLIC_IP avec l'IP publique de la machine qui envoie les retraits.");
    } else {
        hints.push(`Autorisez ${publicIp} dans la whitelist IP OxaPay. 127.0.0.1 ne fonctionnera jamais pour les retraits.`);
    }

    hints.push("Verifiez aussi la 2FA OxaPay, les limites de payout et l'activation des retraits sur le compte.");

    return {
        callbackUrl,
        returnUrl,
        publicIp,
        issues,
        hints
    };
}

module.exports = {
    getOxaPayDiagnostics
};
