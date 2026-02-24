import { useState, useEffect } from 'react';

export type Kline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

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
        // Use our backend proxy to bypass CORS
        const response = await fetch(
          `/api/kucoin/klines?type=${interval}&symbol=${symbol}`
        );
        if (!response.ok) {
          throw new Error('Failed to fetch data');
        }
        const json = await response.json();
        if (json.code !== '200000') {
          throw new Error(json.msg || 'Failed to fetch data');
        }
        
        if (isMounted) {
          const klines: Kline[] = json.data
            .filter((d: any) => d && d.length >= 5 && !isNaN(parseFloat(d[1])) && !isNaN(parseFloat(d[4])))
            .map((d: any) => ({
              time: parseInt(d[0]) * 1000,
              open: parseFloat(d[1]),
              close: parseFloat(d[2]),
              high: parseFloat(d[3]),
              low: parseFloat(d[4]),
              volume: parseFloat(d[5] || 0),
            })).reverse();
          
          setData(klines.slice(-limit));
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
