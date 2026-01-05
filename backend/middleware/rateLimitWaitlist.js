import rateLimit from "express-rate-limit";

const waitlistLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                  // 5 requests per IP
  standardHeaders: true,   // Return rate limit info in headers
  legacyHeaders: false,
  message: {
    error: "Too many attempts. Please try again after 15 minutes."
  }
});

export default waitlistLimiter;
