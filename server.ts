import express from "express";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Proxy Kucoin API to avoid CORS issues
  app.get("/api/kucoin/klines", async (req, res) => {
    try {
      const { symbol, type } = req.query;
      const response = await fetch(
        `https://api.kucoin.com/api/v1/market/candles?type=${type}&symbol=${symbol}`
      );
      
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch from Kucoin" });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
