import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart, Bar, Cell } from 'recharts';
import { Activity, Settings, ChevronDown, Plus, Play, ShieldAlert, TrendingUp, Clock, BarChart2, LineChart as LineChartIcon, CandlestickChart } from 'lucide-react';
import { useKlines } from './hooks/useKlines';
import { calculateSMA, calculateRSI, calculateMACD } from './lib/indicators';

// Custom candlestick shape
const CandlestickShape = (props: any) => {
  const { x, y, width, height, payload } = props;
  
  if (!payload || payload.open === undefined || payload.close === undefined || payload.high === undefined || payload.low === undefined) {
    return null;
  }

  const { open, close, high, low } = payload;
  const isUp = close >= open;
  const color = isUp ? '#089981' : '#F23645'; // TradingView colors

  const range = high - low;
  if (range === 0) {
    return <line x1={x} y1={y} x2={x + width} y2={y} stroke={color} strokeWidth={1.5} />;
  }

  const pixelPerValue = height / range;

  const yHigh = y;
  const yLow = y + height;
  const yOpen = y + (high - open) * pixelPerValue;
  const yClose = y + (high - close) * pixelPerValue;

  const rectY = Math.min(yOpen, yClose);
  const rectHeight = Math.max(Math.abs(yOpen - yClose), 1);
  const centerX = x + width / 2;

  return (
    <g stroke={color} fill={color} strokeWidth={1.5}>
      <line x1={centerX} y1={yHigh} x2={centerX} y2={yLow} />
      <rect x={x} y={rectY} width={width} height={rectHeight} />
    </g>
  );
};

const SYMBOLS = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT'];
const INTERVALS = [
  { label: '5m', value: '5min' },
  { label: '15m', value: '15min' },
  { label: '1H', value: '1hour' },
  { label: '4H', value: '4hour' },
  { label: '1D', value: '1day' },
];

const STRATEGIES = [
  { id: 'macd_rsi', name: 'MACD + RSI Reversal' },
  { id: 'sma_crossover', name: 'SMA Crossover' },
];

export default function App() {
  const [symbol, setSymbol] = useState('BTC-USDT');
  const [interval, setInterval] = useState('15min');
  const [chartType, setChartType] = useState<'candles' | 'line'>('candles');
  const [showRSI, setShowRSI] = useState(false);
  const [showSMA, setShowSMA] = useState(true);
  const [showMACD, setShowMACD] = useState(false);
  const [strategy, setStrategy] = useState('macd_rsi');

  const { data: rawData, loading, error } = useKlines(symbol, interval, 150);

  // Process data and calculate indicators
  const chartData = useMemo(() => {
    if (!rawData || rawData.length === 0) return [];

    const closes = rawData.map(d => d.close);
    const sma20 = calculateSMA(closes, 20);
    const sma50 = calculateSMA(closes, 50);
    const rsi14 = calculateRSI(closes, 14);
    const { macdLine, signalLine, histogram } = calculateMACD(closes);

    return rawData.map((d, i) => ({
      ...d,
      timeStr: new Date(d.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }),
      sma20: sma20[i],
      sma50: sma50[i],
      rsi: rsi14[i],
      macd: macdLine[i],
      macdSignal: signalLine[i],
      macdHist: histogram[i],
      range: [d.low, d.high],
      closePrice: d.close
    }));
  }, [rawData]);

  // Calculate strategy signals
  const signal = useMemo(() => {
    if (chartData.length < 2) return null;
    
    const latest = chartData[chartData.length - 1];
    const prev = chartData[chartData.length - 2];
    
    let type = 'NEUTRAL';
    let entry = latest.close;
    let sl = null;
    let tp = null;
    let reason = 'Waiting for setup...';

    if (strategy === 'sma_crossover') {
      if (prev.sma20 && prev.sma50 && latest.sma20 && latest.sma50) {
        if (prev.sma20 <= prev.sma50 && latest.sma20 > latest.sma50) {
          type = 'BUY';
          reason = 'SMA 20 crossed above SMA 50';
          sl = entry * 0.98;
          tp = entry * 1.04;
        } else if (prev.sma20 >= prev.sma50 && latest.sma20 < latest.sma50) {
          type = 'SELL';
          reason = 'SMA 20 crossed below SMA 50';
          sl = entry * 1.02;
          tp = entry * 0.96;
        }
      }
    } else if (strategy === 'macd_rsi') {
      if (prev.macd !== null && prev.macdSignal !== null && latest.macd !== null && latest.macdSignal !== null) {
        if (prev.macd <= prev.macdSignal && latest.macd > latest.macdSignal) {
          if (latest.rsi && latest.rsi < 45) {
            type = 'BUY';
            reason = 'MACD Bullish Cross + RSI < 45';
            sl = entry * 0.99;
            tp = entry * 1.02;
          }
        } else if (prev.macd >= prev.macdSignal && latest.macd < latest.macdSignal) {
          if (latest.rsi && latest.rsi > 55) {
            type = 'SELL';
            reason = 'MACD Bearish Cross + RSI > 55';
            sl = entry * 1.01;
            tp = entry * 0.98;
          }
        }
      }
    }

    return { type, entry, sl, tp, reason, timestamp: latest.timeStr };
  }, [chartData, strategy]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return ['auto', 'auto'];
    const min = Math.min(...chartData.map(d => d.low));
    const max = Math.max(...chartData.map(d => d.high));
    if (isNaN(min) || isNaN(max)) return ['auto', 'auto'];
    const padding = (max - min) * 0.05;
    return [min - (padding || max * 0.01), max + (padding || max * 0.01)];
  }, [chartData]);

  const currentPrice = chartData.length > 0 ? chartData[chartData.length - 1].close : 0;
  const priceChange = chartData.length > 1 ? currentPrice - chartData[chartData.length - 2].close : 0;
  const priceChangePercent = chartData.length > 1 ? (priceChange / chartData[chartData.length - 2].close) * 100 : 0;

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#D1D4DC] font-sans flex flex-col selection:bg-[#2962FF]/30">
      {/* Top Navigation Bar */}
      <header className="border-b border-[#2A2E39] bg-[#131722] flex flex-col lg:flex-row lg:items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center justify-between h-16 px-4 sm:px-6 w-full lg:w-auto shrink-0">
          <div className="flex items-center gap-2 text-[#D1D4DC] font-bold text-xl tracking-tight">
            <div className="w-8 h-8 rounded-lg bg-[#2962FF] flex items-center justify-center shadow-lg shadow-[#2962FF]/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            QuantView
          </div>
          <div className="flex items-center gap-3 lg:hidden">
            <button className="p-2 text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#1E222D] rounded-lg transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex items-center gap-4 overflow-x-auto custom-scrollbar px-4 sm:px-6 pb-3 lg:pb-0 lg:px-0 lg:h-16 w-full lg:w-auto">
          {/* Symbol Selector */}
          <div className="relative group shrink-0">
            <select 
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-transparent text-[#D1D4DC] font-semibold text-lg outline-none cursor-pointer hover:text-white transition-colors appearance-none pr-6"
            >
              {SYMBOLS.map(s => <option key={s} value={s} className="bg-[#131722] text-sm">{s}</option>)}
            </select>
            <ChevronDown className="w-4 h-4 text-[#787B86] absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none group-hover:text-[#D1D4DC] transition-colors" />
          </div>

          <div className="h-6 w-px bg-[#2A2E39] shrink-0" />

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1 bg-[#1E222D] p-1 rounded-lg border border-[#2A2E39] shrink-0">
            {INTERVALS.map(int => (
              <button
                key={int.value}
                onClick={() => setInterval(int.value)}
                className={`px-3 py-1 text-sm rounded-md transition-all duration-200 font-medium ${
                  interval === int.value 
                    ? 'bg-[#2A2E39] text-white shadow-sm' 
                    : 'text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#2A2E39]/50'
                }`}
              >
                {int.label}
              </button>
            ))}
          </div>

          <div className="h-6 w-px bg-[#2A2E39] shrink-0" />

          {/* Chart Type Toggle */}
          <div className="flex items-center gap-1 bg-[#1E222D] p-1 rounded-lg border border-[#2A2E39] shrink-0">
            <button
              onClick={() => setChartType('candles')}
              className={`p-1.5 rounded-md transition-all duration-200 ${chartType === 'candles' ? 'bg-[#2A2E39] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}
              title="Candlesticks"
            >
              <CandlestickChart className="w-4 h-4" />
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`p-1.5 rounded-md transition-all duration-200 ${chartType === 'line' ? 'bg-[#2A2E39] text-white' : 'text-[#787B86] hover:text-[#D1D4DC]'}`}
              title="Line Chart"
            >
              <LineChartIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="h-6 w-px bg-[#2A2E39] shrink-0" />

          {/* Indicators Toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button 
              onClick={() => setShowSMA(!showSMA)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all duration-200 font-medium ${
                showSMA 
                  ? 'bg-[#2962FF]/10 border-[#2962FF]/30 text-[#2962FF]' 
                  : 'bg-transparent border-transparent text-[#787B86] hover:bg-[#1E222D] hover:text-[#D1D4DC]'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              SMA
            </button>
            <button 
              onClick={() => setShowRSI(!showRSI)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all duration-200 font-medium ${
                showRSI 
                  ? 'bg-[#9D2B6B]/10 border-[#9D2B6B]/30 text-[#E91E63]' 
                  : 'bg-transparent border-transparent text-[#787B86] hover:bg-[#1E222D] hover:text-[#D1D4DC]'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              RSI
            </button>
            <button 
              onClick={() => setShowMACD(!showMACD)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all duration-200 font-medium ${
                showMACD 
                  ? 'bg-[#F57C00]/10 border-[#F57C00]/30 text-[#FF9800]' 
                  : 'bg-transparent border-transparent text-[#787B86] hover:bg-[#1E222D] hover:text-[#D1D4DC]'
              }`}
            >
              <Activity className="w-4 h-4" />
              MACD
            </button>
          </div>
        </div>

        <div className="hidden lg:flex items-center gap-3 px-6 shrink-0">
          <button className="p-2 text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#1E222D] rounded-lg transition-colors">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        
        {/* Chart Area */}
        <div className="flex-1 flex flex-col min-w-0 border-b lg:border-b-0 lg:border-r border-[#2A2E39] bg-[#0B0E14] lg:overflow-y-auto custom-scrollbar">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#2962FF]"></div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-[#F23645] bg-[#F23645]/5 m-8 rounded-xl border border-[#F23645]/20">
              <ShieldAlert className="w-6 h-6 mr-3" />
              <span className="font-medium">{error}</span>
            </div>
          ) : (
            <div className="flex-1 flex flex-col p-4 gap-4">
              {/* Main Price Chart */}
              <div className="w-full h-[400px] lg:h-[500px] bg-[#131722] rounded-xl border border-[#2A2E39] p-4 relative shrink-0 shadow-sm">
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-1 pointer-events-none">
                  <div className="flex items-baseline gap-3">
                    <div className="text-2xl font-bold text-white">{symbol}</div>
                    <div className={`text-lg font-medium ${priceChange >= 0 ? 'text-[#089981]' : 'text-[#F23645]'}`}>
                      {currentPrice.toFixed(2)} 
                      <span className="text-sm ml-2">
                        {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
                      </span>
                    </div>
                  </div>
                  <div className="text-sm text-[#787B86] flex items-center gap-2 font-medium">
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {interval}</span>
                    <span>•</span>
                    <span>Kucoin</span>
                  </div>
                </div>
                
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 60, right: 20, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E222D" vertical={false} />
                    <XAxis 
                      dataKey="timeStr" 
                      stroke="#434651" 
                      tick={{ fill: '#787B86', fontSize: 11, fontWeight: 500 }} 
                      tickMargin={12}
                      minTickGap={40}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis 
                      domain={yDomain} 
                      stroke="#434651" 
                      tick={{ fill: '#787B86', fontSize: 11, fontWeight: 500 }} 
                      tickFormatter={(val) => val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      orientation="right"
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39', borderRadius: '8px', color: '#D1D4DC', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)' }}
                      itemStyle={{ color: '#D1D4DC', fontSize: '13px', fontWeight: 500 }}
                      labelStyle={{ color: '#787B86', marginBottom: '6px', fontSize: '12px', fontWeight: 600 }}
                      formatter={(value: any, name: string, props: any) => {
                        if (name === 'Price' || name === 'closePrice') {
                          const { open, high, low, close } = props.payload;
                          return [
                            `O: ${open.toFixed(2)}  H: ${high.toFixed(2)}  L: ${low.toFixed(2)}  C: ${close.toFixed(2)}`,
                            'OHLC'
                          ];
                        }
                        return [Number(value).toFixed(2), name];
                      }}
                    />
                    
                    {/* Price Rendering */}
                    {chartType === 'candles' ? (
                      <Bar dataKey="range" shape={<CandlestickShape />} isAnimationActive={false} name="Price" />
                    ) : (
                      <Line type="monotone" dataKey="closePrice" stroke="#2962FF" dot={false} strokeWidth={2} isAnimationActive={false} name="Price" />
                    )}
                    
                    {/* Indicators */}
                    {showSMA && <Line type="monotone" dataKey="sma20" stroke="#2962FF" dot={false} strokeWidth={1.5} isAnimationActive={false} name="SMA 20" />}
                    {showSMA && <Line type="monotone" dataKey="sma50" stroke="#FF9800" dot={false} strokeWidth={1.5} isAnimationActive={false} name="SMA 50" />}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* RSI Chart */}
              {showRSI && (
                <div className="h-40 lg:h-48 bg-[#131722] rounded-xl border border-[#2A2E39] p-4 shrink-0 shadow-sm relative">
                  <div className="absolute top-4 left-4 z-10 text-sm font-semibold text-[#E91E63]">RSI (14)</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E222D" vertical={false} />
                      <XAxis dataKey="timeStr" hide />
                      <YAxis domain={[0, 100]} stroke="#434651" tick={{ fill: '#787B86', fontSize: 11 }} orientation="right" ticks={[30, 50, 70]} axisLine={false} tickLine={false} tickMargin={12} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39', borderRadius: '8px' }}
                        itemStyle={{ fontSize: '13px', fontWeight: 500 }}
                        labelStyle={{ color: '#787B86', marginBottom: '6px', fontSize: '12px' }}
                      />
                      <Line type="monotone" dataKey={() => 70} stroke="#787B86" strokeDasharray="4 4" dot={false} strokeWidth={1} isAnimationActive={false} />
                      <Line type="monotone" dataKey={() => 30} stroke="#787B86" strokeDasharray="4 4" dot={false} strokeWidth={1} isAnimationActive={false} />
                      <Line type="monotone" dataKey="rsi" stroke="#E91E63" dot={false} strokeWidth={1.5} isAnimationActive={false} name="RSI" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* MACD Chart */}
              {showMACD && (
                <div className="h-40 lg:h-48 bg-[#131722] rounded-xl border border-[#2A2E39] p-4 shrink-0 shadow-sm relative">
                  <div className="absolute top-4 left-4 z-10 text-sm font-semibold text-[#FF9800]">MACD (12, 26, 9)</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 20, right: 20, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1E222D" vertical={false} />
                      <XAxis dataKey="timeStr" hide />
                      <YAxis stroke="#434651" tick={{ fill: '#787B86', fontSize: 11 }} orientation="right" axisLine={false} tickLine={false} tickMargin={12} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1E222D', borderColor: '#2A2E39', borderRadius: '8px' }}
                        itemStyle={{ fontSize: '13px', fontWeight: 500 }}
                        labelStyle={{ color: '#787B86', marginBottom: '6px', fontSize: '12px' }}
                      />
                      <Bar dataKey="macdHist" isAnimationActive={false} name="Histogram">
                        {
                          chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.macdHist > 0 ? '#089981' : '#F23645'} fillOpacity={0.7} />
                          ))
                        }
                      </Bar>
                      <Line type="monotone" dataKey="macd" stroke="#2962FF" dot={false} strokeWidth={1.5} isAnimationActive={false} name="MACD" />
                      <Line type="monotone" dataKey="macdSignal" stroke="#FF9800" dot={false} strokeWidth={1.5} isAnimationActive={false} name="Signal" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Strategy & Signals */}
        <div className="w-full lg:w-80 bg-[#131722] flex flex-col shrink-0 lg:overflow-y-auto lg:border-l border-[#2A2E39]">
          <div className="p-6 border-b border-[#2A2E39]">
            <h2 className="text-xs font-bold text-[#787B86] uppercase tracking-widest mb-4">Trading Strategy</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#D1D4DC] mb-2">Active Strategy</label>
                <div className="relative">
                  <select 
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value)}
                    className="w-full bg-[#1E222D] border border-[#2A2E39] text-[#D1D4DC] rounded-lg pl-4 pr-10 py-2.5 text-sm outline-none focus:border-[#2962FF] transition-colors appearance-none font-medium"
                  >
                    {STRATEGIES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#787B86] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>
              
              <button className="w-full flex items-center justify-center gap-2 bg-[#1E222D] hover:bg-[#2A2E39] border border-[#2A2E39] text-[#D1D4DC] py-2.5 rounded-lg text-sm font-semibold transition-colors">
                <Plus className="w-4 h-4" /> Add Custom Script
              </button>
            </div>
          </div>

          <div className="p-6 flex-1 bg-[#0B0E14]/30">
            <h2 className="text-xs font-bold text-[#787B86] uppercase tracking-widest mb-4 flex items-center justify-between">
              Live Signal
              {signal && signal.type !== 'NEUTRAL' && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2962FF] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2962FF]"></span>
                </span>
              )}
            </h2>

            {signal ? (
              <div className="space-y-4">
                {/* Signal Status Card */}
                <div className={`p-5 rounded-xl border ${
                  signal.type === 'BUY' ? 'bg-[#089981]/10 border-[#089981]/30' : 
                  signal.type === 'SELL' ? 'bg-[#F23645]/10 border-[#F23645]/30' : 
                  'bg-[#1E222D] border-[#2A2E39]'
                }`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-[#787B86]">{signal.timestamp}</span>
                    <span className={`text-sm font-bold px-2.5 py-1 rounded-md ${
                      signal.type === 'BUY' ? 'bg-[#089981]/20 text-[#089981]' : 
                      signal.type === 'SELL' ? 'bg-[#F23645]/20 text-[#F23645]' : 
                      'bg-[#2A2E39] text-[#D1D4DC]'
                    }`}>
                      {signal.type}
                    </span>
                  </div>
                  <div className="text-sm text-[#D1D4DC] font-medium leading-relaxed">
                    {signal.reason}
                  </div>
                </div>

                {/* Execution Details */}
                {signal.type !== 'NEUTRAL' && (
                  <div className="bg-[#1E222D] rounded-xl border border-[#2A2E39] p-5 space-y-4 shadow-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-[#787B86]">Entry Price</span>
                      <span className="text-sm font-mono font-bold text-[#D1D4DC]">{signal.entry.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-[#2A2E39]" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-[#787B86]">Take Profit</span>
                      <span className="text-sm font-mono font-bold text-[#089981]">{signal.tp?.toFixed(2)}</span>
                    </div>
                    <div className="h-px bg-[#2A2E39]" />
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium text-[#787B86]">Stop Loss</span>
                      <span className="text-sm font-mono font-bold text-[#F23645]">{signal.sl?.toFixed(2)}</span>
                    </div>
                    
                    <button className="w-full mt-6 flex items-center justify-center gap-2 bg-[#2962FF] hover:bg-[#1E53E5] text-white py-3 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-[#2962FF]/20">
                      <Play className="w-4 h-4" /> Execute Trade
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-[#787B86] text-center py-12 font-medium">
                Calculating signals...
              </div>
            )}
          </div>
        </div>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background-color: #2A2E39;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background-color: #434651;
        }
      `}} />
    </div>
  );
}
