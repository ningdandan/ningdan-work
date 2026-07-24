module.exports = function handler(_req, res) {
  res.status(200).json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
  });
};
