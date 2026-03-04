import { useState, useEffect } from 'react';

export type Kline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const BINANCE_URLS = [
  'https://data-api.binance.vision',
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com'
];

// Helper to fetch with timeout
async function fetchWithTimeout(resource: string, options: RequestInit & { timeout?: number } = {}) {
  const { timeout = 5000 } = options;
  
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function fetchWithFallback(symbol: string, interval: string, limit: number) {
  let lastError;
  for (const baseUrl of BINANCE_URLS) {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { timeout: 3000 });
      if (response.ok) {
        return await response.json();
      } else {
        // If it's a 400 error (e.g. invalid symbol), don't keep trying other endpoints
        if (response.status === 400) {
          throw new Error(`Invalid symbol or interval on Binance: ${symbol}`);
        }
      }
    } catch (e: any) {
      lastError = e;
      // If it's an abort error or network error, continue to next URL
      if (e.name !== 'AbortError') {
        console.warn(`Failed to fetch from ${baseUrl}:`, e.message);
      }
    }
  }
  throw lastError || new Error('All Binance endpoints failed');
}

export function useKlines(symbol: string, interval: string, limit: number = 200) {
  const [data, setData] = useState<Kline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        let klines: Kline[] = [];
        
        try {
          // Try Binance API first
          const json = await fetchWithFallback(symbol, interval, limit);
          
          klines = json.map((d: any) => ({
            time: d[0], // Binance time is already in milliseconds
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4]),
            volume: parseFloat(d[5]),
          }));
        } catch (binanceErr) {
          console.warn('Binance fetch failed, falling back to KuCoin', binanceErr);
          
          // Fallback to KuCoin API (using a public CORS proxy since KuCoin blocks browser requests)
          const kucoinSymbol = symbol.replace('USDT', '-USDT');
          const kucoinInterval = interval === '1h' ? '1hour' : interval === '4h' ? '4hour' : interval === '1d' ? '1day' : interval.replace('m', 'min');
          
          const kucoinUrl = `https://api.kucoin.com/api/v1/market/candles?type=${kucoinInterval}&symbol=${kucoinSymbol}`;
          const response = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(kucoinUrl)}`, { timeout: 5000 });
          
          if (!response.ok) {
            throw new Error('KuCoin failed');
          }
          const json = await response.json();
          if (json.code !== '200000') {
            throw new Error(json.msg || 'Failed to fetch data from KuCoin');
          }
          
          if (!json.data || !Array.isArray(json.data) || json.data.length === 0) {
            throw new Error(`No data available for ${symbol}`);
          }
          
          klines = json.data
            .filter((d: any) => d && d.length >= 5)
            .map((d: any) => ({
              time: parseInt(d[0]) * 1000,
              open: parseFloat(d[1]),
              close: parseFloat(d[2]),
              high: parseFloat(d[3]),
              low: parseFloat(d[4]),
              volume: parseFloat(d[5] || 0),
            })).reverse().slice(-limit);
        }
        
        if (isMounted) {
          setData(klines);
        }
      } catch (err: any) {
        if (isMounted) setError(err.message);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [symbol, interval, limit]);

  return { data, loading, error };
}
