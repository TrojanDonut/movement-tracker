import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';
import { useState, useEffect } from 'react';

interface Measurement {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

interface Stats {
  maxDeviation: string;
  avgDeviation: string;
  duration: string;
  samples: number;
}

interface Calibration {
  x: number;
  y: number;
  z: number;
}

const MovementTracker: React.FC = () => {
  const [mode, setMode] = useState<'idle' | 'calibrating' | 'tracking'>('idle');
  const [calibration, setCalibration] = useState<Calibration>({ x: 0, y: 0, z: 0 });
  const [calibrationSamples, setCalibrationSamples] = useState<Measurement[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [currentX, setCurrentX] = useState<number>(0);
  const [currentY, setCurrentY] = useState<number>(0);
  const [currentZ, setCurrentZ] = useState<number>(0);
  const [finalStats, setFinalStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);
  const [startTime, setStartTime] = useState<number>(0);

  const CALIBRATION_DURATION = 3; // seconds
  const SAMPLES_PER_SECOND = 60;
  const TOTAL_CALIBRATION_SAMPLES = CALIBRATION_DURATION * SAMPLES_PER_SECOND;
  const PERFECT_ZONE_RANGE = 2; // ±2 degrees is considered "perfect"

  useEffect(() => {
    if (typeof window !== 'undefined' && !window.DeviceMotionEvent) {
      setError("Device motion not supported on this device");
      return;
    }

    // Initialize measurements array at the start of tracking
    if (mode === 'tracking') {
      setMeasurements([]);
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      if (mode === 'idle') return;

      const { x, y, z } = event.accelerationIncludingGravity || {};
      const rawX = x || 0;
      const rawY = y || 0;
      const rawZ = z || 0;

      if (mode === 'calibrating') {
        setCalibrationSamples(prev => {
          const newSamples = [...prev, { x: rawX, y: rawY, z: rawZ, timestamp: Date.now() }];
          setCalibrationProgress((newSamples.length / TOTAL_CALIBRATION_SAMPLES) * 100);
          
          if (newSamples.length >= TOTAL_CALIBRATION_SAMPLES) {
            const avgX = newSamples.reduce((sum, sample) => sum + sample.x, 0) / newSamples.length;
            const avgY = newSamples.reduce((sum, sample) => sum + sample.y, 0) / newSamples.length;
            const avgZ = newSamples.reduce((sum, sample) => sum + sample.z, 0) / newSamples.length;
            
            setCalibration({ x: avgX, y: avgY, z: avgZ });
            setMode('tracking');
            const currentTime = Date.now();
            setStartTime(currentTime);
            return [];
          }
          return newSamples;
        });
      } else if (mode === 'tracking') {
        const calibratedX = rawX - calibration.x;
        const calibratedY = rawY - calibration.y;
        const calibratedZ = rawZ - calibration.z;
        
        setCurrentX(calibratedX);
        setCurrentY(calibratedY);
        setCurrentZ(calibratedZ);

        const currentTimestamp = Date.now() - startTime;
        const newMeasurement = {
          x: calibratedX,
          y: calibratedY,
          z: calibratedZ,
          timestamp: currentTimestamp
        };
        
        setMeasurements(prev => [...prev, newMeasurement]);
      }
    };

    if (mode !== 'idle') {
      window.addEventListener('devicemotion', handleMotion);
    }

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [mode, calibration, startTime]);

  const playBeep = (frequency: number) => {
    const AudioContext = window.AudioContext || window.AudioContext;
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    oscillator.connect(audioContext.destination);
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.1);
  };

  const startCalibration = () => {
    setCalibrationSamples([]);
    setCalibrationProgress(0);
    setMeasurements([]);
    setStartTime(0);
    setMode('calibrating');
    playBeep(440);
  };

  const stopTracking = () => {
    setMode('idle');
    playBeep(880);

    if (measurements.length > 0) {
      const calculateStats = (): Stats => {
        let maxDeviation = 0;
        let totalDeviation = 0;
        
        for (let i = 0; i < measurements.length; i++) {
          const horizontalDeviation = Math.sqrt(
            Math.pow(measurements[i].x, 2) + 
            Math.pow(measurements[i].z, 2)
          );
          maxDeviation = Math.max(maxDeviation, horizontalDeviation);
          totalDeviation += horizontalDeviation;
        }

        const avgDeviation = totalDeviation / measurements.length;
        const duration = (Date.now() - startTime) / 1000;

        return {
          maxDeviation: maxDeviation.toFixed(2),
          avgDeviation: avgDeviation.toFixed(2),
          duration: duration.toFixed(2),
          samples: measurements.length
        };
      };

      setFinalStats(calculateStats());
    }
  };

  const DeviationChart = ({ data, dataKey, title, color }: { 
    data: Measurement[], 
    dataKey: 'x' | 'z', 
    title: string,
    color: string 
  }) => {
    const duration = data.length > 0 ? (data[data.length - 1].timestamp / 1000).toFixed(1) : "0.0";
    
    return (
      <div className="w-full bg-slate-800 p-4 rounded-lg">
        <h4 className="text-white font-bold mb-2">{title}</h4>
        <div className="aspect-[16/9] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              <ReferenceArea
                y1={-PERFECT_ZONE_RANGE}
                y2={PERFECT_ZONE_RANGE}
                fill="#22c55e"
                fillOpacity={0.1}
                stroke="#22c55e"
                strokeOpacity={0.3}
                strokeWidth={1}
              />
              <ReferenceLine
                y={0}
                stroke="#22c55e"
                strokeDasharray="3 3"
                strokeWidth={2}
              />
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(value) => `${(value / 1000).toFixed(1)}s`}
                stroke="#94a3b8"
                tick={({ x, y, payload }) => {
                  const seconds = payload.value / 1000;
                  const isFullSecond = Math.abs(seconds - Math.round(seconds)) < 0.05;
                  return (
                    <text 
                      x={x} 
                      y={y + 10} 
                      textAnchor="middle" 
                      fill="#94a3b8"
                      className={isFullSecond ? "font-bold" : ""}
                    >
                      {`${seconds.toFixed(1)}s`}
                    </text>
                  );
                }}
              />
              <YAxis 
                domain={[-10, 10]} 
                stroke="#94a3b8"
                tickFormatter={(value) => `${value}°`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none' }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: number) => [
                  `${value.toFixed(2)}°${Math.abs(value) <= PERFECT_ZONE_RANGE ? ' ✓' : ''}`, 
                  'Deviation'
                ]}
                labelFormatter={(label) => `Time: ${(Number(label) / 1000).toFixed(1)}s`}
              />
              <Line
                type="monotone"
                dataKey={dataKey}
                stroke={color}
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-between items-center mt-2 text-sm">
          <div>
            <span className="text-emerald-400">Perfect Zone: </span>
            <span className="text-white">±{PERFECT_ZONE_RANGE}°</span>
          </div>
          <div>
            <span className="text-emerald-400">Duration: </span>
            <span className="text-white">{duration}s</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-slate-900 rounded-lg shadow-xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2 text-white">Movement Tracker</h2>
        {mode === 'calibrating' && (
          <div className="bg-blue-500 text-white px-4 py-2 rounded-lg mb-4">
            <div className="text-lg font-bold mb-2">Calibrating...</div>
            <div className="w-full bg-blue-700 rounded-full h-2">
              <div 
                className="bg-white h-2 rounded-full transition-all duration-300"
                style={{ width: `${calibrationProgress}%` }}
              ></div>
            </div>
            <div className="text-sm mt-1">Hold phone still against bar</div>
          </div>
        )}
        {mode === 'tracking' && (
          <div className="animate-pulse bg-green-500 text-white px-2 py-1 rounded text-center">
            TRACKING ACTIVE
          </div>
        )}
      </div>

      <div className="space-y-4">
        {mode === 'idle' && (
          <button
            onClick={startCalibration}
            className="w-full p-4 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold text-lg"
          >
            Start Calibration
          </button>
        )}
        
        {mode === 'tracking' && (
          <button
            onClick={stopTracking}
            className="w-full p-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold text-lg"
          >
            Stop Tracking
          </button>
        )}
      </div>

      {mode === 'tracking' && (
        <div className="space-y-4 bg-slate-800 p-4 rounded-lg mt-6">
          <h3 className="text-white font-bold text-xl mb-4">LIVE DATA:</h3>
          
          <div className="bg-slate-700 p-3 rounded">
            <div className="text-emerald-400 font-bold">Side-to-side:</div>
            <div className="text-white text-2xl">{currentX.toFixed(2)}°</div>
          </div>
          
          <div className="bg-slate-700 p-3 rounded">
            <div className="text-emerald-400 font-bold">Up-down:</div>
            <div className="text-white text-2xl">{currentY.toFixed(2)}°</div>
          </div>
          
          <div className="bg-slate-700 p-3 rounded">
            <div className="text-emerald-400 font-bold">Forward-back:</div>
            <div className="text-white text-2xl">{currentZ.toFixed(2)}°</div>
          </div>
        </div>
      )}

      {mode === 'idle' && finalStats && (
        <div className="space-y-4 mt-6">
          <h3 className="text-white font-bold text-xl mb-4">FINAL RESULTS:</h3>
          
          <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
            <strong className="text-emerald-400">Max Deviation:</strong>
            <span className="text-white ml-2">{finalStats.maxDeviation}°</span>
          </div>
          <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
            <strong className="text-emerald-400">Avg Deviation:</strong>
            <span className="text-white ml-2">{finalStats.avgDeviation}°</span>
          </div>
          <div className="p-4 bg-slate-800 rounded-lg border border-slate-700">
            <strong className="text-emerald-400">Samples:</strong>
            <span className="text-white ml-2">{finalStats.samples}</span>
          </div>

          <div className="space-y-4 mt-6">
            <DeviationChart 
              data={measurements} 
              dataKey="x" 
              title="Final Side-to-side Deviation" 
              color="#22c55e"
            />
            <DeviationChart 
              data={measurements} 
              dataKey="z" 
              title="Final Forward-back Deviation" 
              color="#3b82f6"
            />
          </div>
        </div>
      )}

      {error && (
        <div className="text-red-400 mb-4 font-semibold">{error}</div>
      )}
    </div>
  );
};

export default MovementTracker;