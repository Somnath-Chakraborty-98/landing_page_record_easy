module.exports = async (req, res) => {
  if (req.url === "/api/health" || req.url === "/health" || req.url === "/") {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({
      success: true,
      source: "vercel-api-wrapper"
    }));
  }

  const { default: app } = await import("../backend/index.js");
  return app(req, res);
};
