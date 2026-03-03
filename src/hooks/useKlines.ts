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

async function fetchWithFallback(symbol: string, interval: string, limit: number) {
  let lastError;
  for (const baseUrl of BINANCE_URLS) {
    try {
      const response = await fetch(`${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
      if (response.ok) {
        return await response.json();
      }
    } catch (e) {
      lastError = e;
      console.warn(`Failed to fetch from ${baseUrl}, trying next...`);
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
          const response = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(kucoinUrl)}`);
          
          if (!response.ok) {
            throw new Error('KuCoin failed');
          }
          const json = await response.json();
          if (json.code !== '200000') {
            throw new Error(json.msg || 'Failed to fetch data from KuCoin');
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
