export default function requireVerifiedUser(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: "Unauthenticated" });
    }

    if (!req.user.is_verified) {
        return res.status(403).json({
            error: "Email not verified. Please check your email."
        });
    }

    next();
}
