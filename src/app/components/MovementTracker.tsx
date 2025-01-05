import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea } from 'recharts';

// Web Bluetooth API types
interface BluetoothRemoteGATTCharacteristic {
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  writeValue(value: BufferSource): Promise<void>;
  readValue(): Promise<DataView>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  value?: DataView;
}

interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>;
  connected: boolean;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice {
  gatt?: BluetoothRemoteGATTServer;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

declare global {
  interface Navigator {
    bluetooth: {
      requestDevice(options: {
        filters: Array<{ name?: string; services?: string[] }>;
        optionalServices?: string[];
      }): Promise<BluetoothDevice>;
    };
  }

  interface Window {
    AudioContext: typeof AudioContext;
  }
}

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
  const [mode, setMode] = useState<'idle' | 'connecting' | 'calibrating' | 'tracking'>('idle');
  const [device, setDevice] = useState<BluetoothDevice | null>(null);
  const [calibration, setCalibration] = useState<Calibration>({ x: 0, y: 0, z: 0 });
  const [calibrationSamples, setCalibrationSamples] = useState<Measurement[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [currentX, setCurrentX] = useState<number>(0);
  const [currentY, setCurrentY] = useState<number>(0);
  const [currentZ, setCurrentZ] = useState<number>(0);
  const [finalStats, setFinalStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<number>(0);
  const [calibrationProgress, setCalibrationProgress] = useState<number>(0);
  const [lastRawData, setLastRawData] = useState<string>('No data received');
  const [lastParsedData, setLastParsedData] = useState<{x: number, y: number, z: number} | null>(null);
  const [debugMessages, setDebugMessages] = useState<string[]>([]);

  const PERFECT_ZONE_RANGE = 2;
  const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  const REQUIRED_CALIBRATION_SAMPLES = 10;

  // Use refs to break circular dependencies
  const characteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);

  const addDebugMessage = useCallback((message: string) => {
    setDebugMessages(prev => {
      const newMessages = [...prev, `${new Date().toISOString().split('T')[1].split('.')[0]} - ${message}`];
      return newMessages.slice(-5);
    });
  }, []);

  const playBeep = useCallback((frequency: number) => {
    try {
      const AudioContext = window.AudioContext;
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      oscillator.connect(audioContext.destination);
      oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      addDebugMessage(`Audio error: ${error}`);
    }
  }, [addDebugMessage]);

  const calculateFinalStats = useCallback(() => {
    if (measurements.length === 0) return;

    let maxDeviation = 0;
    let totalDeviation = 0;

    measurements.forEach(measurement => {
      const horizontalDeviation = Math.sqrt(
        Math.pow(measurement.x, 2) + 
        Math.pow(measurement.z, 2)
      );
      maxDeviation = Math.max(maxDeviation, horizontalDeviation);
      totalDeviation += horizontalDeviation;
    });

    const stats = {
      maxDeviation: maxDeviation.toFixed(2),
      avgDeviation: (totalDeviation / measurements.length).toFixed(2),
      duration: ((Date.now() - startTime) / 1000).toFixed(2),
      samples: measurements.length
    };
    
    setFinalStats(stats);
    addDebugMessage(`Stats calculated: max=${stats.maxDeviation}°, avg=${stats.avgDeviation}°`);
  }, [measurements, startTime, addDebugMessage]);

  const handleDisconnect = useCallback(() => {
    addDebugMessage('Device disconnected');
    if (measurements.length > 0) {
      calculateFinalStats();
    }
    setMode('idle');
    setError('Device disconnected');
  }, [measurements.length, addDebugMessage, calculateFinalStats]);

  const handleCalibrationData = useCallback((data: {x: number, y: number, z: number}) => {
    const timestamp = Date.now();
    setCalibrationSamples(prev => {
      const newSamples = [...prev, { x: data.x, y: data.y, z: data.z, timestamp }];
      const progress = (newSamples.length / REQUIRED_CALIBRATION_SAMPLES) * 100;
      setCalibrationProgress(Math.min(progress, 100));
      addDebugMessage(`Calibration sample ${newSamples.length}/${REQUIRED_CALIBRATION_SAMPLES}`);

      if (newSamples.length >= REQUIRED_CALIBRATION_SAMPLES) {
        const avgX = newSamples.reduce((sum, sample) => sum + sample.x, 0) / newSamples.length;
        const avgY = newSamples.reduce((sum, sample) => sum + sample.y, 0) / newSamples.length;
        const avgZ = newSamples.reduce((sum, sample) => sum + sample.z, 0) / newSamples.length;
        
        setCalibration({ x: avgX, y: avgY, z: avgZ });
        setMode('tracking');
        setStartTime(Date.now());
        setMeasurements([]);
        addDebugMessage('Calibration complete! Starting tracking...');
      }
      return newSamples;
    });
  }, [REQUIRED_CALIBRATION_SAMPLES, addDebugMessage]);

  // Add a modeRef to avoid closure issues
  const modeRef = useRef<'idle' | 'connecting' | 'calibrating' | 'tracking'>('idle');

  // Update modeRef whenever mode changes
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const handleMotionData = useCallback((event: Event) => {
    const characteristic = event.target as unknown as BluetoothRemoteGATTCharacteristic;
    const dataView = characteristic.value;
    if (!dataView) {
      addDebugMessage('Received empty dataView');
      return;
    }
    
    const decoder = new TextDecoder();
    const rawValue = decoder.decode(dataView);
    setLastRawData(rawValue);
    
    try {
      const data = JSON.parse(rawValue);
      setLastParsedData(data);
      
      // Debug the current mode and data
      addDebugMessage(`Mode: ${modeRef.current}, Data: x=${data.x.toFixed(2)}, y=${data.y.toFixed(2)}, z=${data.z.toFixed(2)}`);
      
      // Explicitly check the current mode using ref
      if (modeRef.current === 'calibrating') {
        const timestamp = Date.now();
        setCalibrationSamples(prev => {
          const newSamples = [...prev, { x: data.x, y: data.y, z: data.z, timestamp }];
          const progress = (newSamples.length / REQUIRED_CALIBRATION_SAMPLES) * 100;
          
          // Debug calibration progress
          addDebugMessage(`Calibration progress: ${newSamples.length}/${REQUIRED_CALIBRATION_SAMPLES}`);
          setCalibrationProgress(Math.min(progress, 100));
          
          if (newSamples.length >= REQUIRED_CALIBRATION_SAMPLES) {
            const avgX = newSamples.reduce((sum, sample) => sum + sample.x, 0) / newSamples.length;
            const avgY = newSamples.reduce((sum, sample) => sum + sample.y, 0) / newSamples.length;
            const avgZ = newSamples.reduce((sum, sample) => sum + sample.z, 0) / newSamples.length;
            
            addDebugMessage('Calibration complete, setting averages');
            setCalibration({ x: avgX, y: avgY, z: avgZ });
            setMode('tracking');
            setStartTime(Date.now());
            setMeasurements([]);
            return [];
          }
          return newSamples;
        });
      } else if (modeRef.current === 'tracking') {
        const calibratedX = data.x - calibration.x;
        const calibratedY = data.y - calibration.y;
        const calibratedZ = data.z - calibration.z;
        
        setCurrentX(calibratedX);
        setCurrentY(calibratedY);
        setCurrentZ(calibratedZ);

        const timestamp = Date.now() - startTime;
        setMeasurements(prev => [...prev, {
          x: calibratedX,
          y: calibratedY,
          z: calibratedZ,
          timestamp
        }]);
      }
    } catch (error) {
      const errorMessage = `Error parsing data: ${error instanceof Error ? error.message : String(error)}`;
      addDebugMessage(errorMessage);
      setError(errorMessage);
    }
  }, [calibration, startTime, REQUIRED_CALIBRATION_SAMPLES, addDebugMessage]);

  const connectBLE = useCallback(async () => {
    try {
      setMode('connecting');
      setError(null);
      setCalibrationSamples([]); // Clear any existing samples
      setCalibrationProgress(0);
      addDebugMessage('Starting BLE connection...');

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: 'M5Motion' }],
        optionalServices: [SERVICE_UUID]
      });

      addDebugMessage('Device selected, connecting to GATT server...');
      const server = await device.gatt?.connect();
      if (!server) throw new Error('Failed to connect to GATT server');

      addDebugMessage('Connected to GATT server, getting service...');
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
      characteristicRef.current = characteristic;

      addDebugMessage('Starting notifications...');
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleMotionData);

      setDevice(device);
      device.addEventListener('gattserverdisconnected', handleDisconnect);
      
      // Set mode to calibrating after everything is set up
      setMode('calibrating');
      addDebugMessage('Starting calibration phase');
      playBeep(440);

    } catch (error) {
      const errorMessage = `Connection failed: ${error instanceof Error ? error.message : String(error)}`;
      setError(errorMessage);
      addDebugMessage(errorMessage);
      setMode('idle');
    }
  }, [SERVICE_UUID, CHARACTERISTIC_UUID, handleMotionData, handleDisconnect, addDebugMessage, playBeep]);

  const stopTracking = useCallback(async () => {
    addDebugMessage('Stopping tracking...');
    if (device?.gatt?.connected) {
      await device.gatt.disconnect();
    }
    
    if (measurements.length > 0) {
      calculateFinalStats();
    }
    
    setMode('idle');
    playBeep(880);
  }, [device, measurements.length, calculateFinalStats, addDebugMessage, playBeep]);

  const DebugPanel = () => (
    <div className="mt-4 p-4 bg-slate-800 rounded-lg border border-slate-700">
      <h3 className="text-white font-bold text-lg mb-2">Debug Information</h3>
      
      <div className="space-y-2">
        <div className="bg-slate-700 p-2 rounded">
          <div className="text-emerald-400 text-sm font-bold">Current Mode:</div>
          <div className="text-white text-sm">{mode}</div>
        </div>

        <div className="bg-slate-700 p-2 rounded">
          <div className="text-emerald-400 text-sm font-bold">Last Raw Data:</div>
          <div className="text-white text-sm break-all">{lastRawData}</div>
        </div>
        
        {lastParsedData && (
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-emerald-400 text-sm font-bold">Last Parsed Data:</div>
            <div className="text-white text-sm">
              x: {lastParsedData.x.toFixed(2)}, 
              y: {lastParsedData.y.toFixed(2)}, 
              z: {lastParsedData.z.toFixed(2)}
            </div>
          </div>
        )}
        
        <div className="bg-slate-700 p-2 rounded">
          <div className="text-emerald-400 text-sm font-bold">Debug Log:</div>
          {debugMessages.map((msg, i) => (
            <div key={i} className="text-white text-sm">{msg}</div>
          ))}
        </div>
        
        {mode === 'calibrating' && (
          <div className="bg-slate-700 p-2 rounded">
            <div className="text-emerald-400 text-sm font-bold">Calibration Status:</div>
            <div className="text-white text-sm">
              Samples: {calibrationSamples.length}/{REQUIRED_CALIBRATION_SAMPLES}
            </div>
          </div>
        )}
      </div>
    </div>
  );

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
        <h2 className="text-2xl font-bold mb-2 text-white">M5Stick Movement Tracker</h2>
        {mode === 'connecting' && (
          <div className="bg-blue-500 text-white px-4 py-2 rounded-lg mb-4">
            <div className="text-lg font-bold mb-2">Connecting...</div>
            <div className="text-sm">Looking for M5Stick device</div>
          </div>
        )}
        {mode === 'calibrating' && (
          <div className="bg-blue-500 text-white px-4 py-2 rounded-lg mb-4">
            <div className="text-lg font-bold mb-2">Calibrating...</div>
            <div className="w-full bg-blue-700 rounded-full h-2">
              <div 
                className="bg-white h-2 rounded-full transition-all duration-300"
                style={{ width: `${calibrationProgress}%` }}
              ></div>
            </div>
            <div className="text-sm mt-1">Hold device still</div>
          </div>
        )}
        {mode === 'tracking' && (
          <div className="animate-pulse bg-green-500 text-white px-2 py-1 rounded text-center">
            TRACKING ACTIVE
          </div>
        )}
      </div>

      {/* Debug Panel - Always visible */}
      <DebugPanel />

      {error && (
        <div className="bg-red-500/10 border border-red-500 text-red-500 px-4 py-2 rounded-lg mb-4">
          {error}
        </div>
      )}

      <div className="space-y-4">
        {mode === 'idle' && (
          <button
            onClick={connectBLE}
            className="w-full p-4 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-bold text-lg transition-colors"
          >
            Connect M5Stick
          </button>
        )}
        
        {mode === 'tracking' && (
          <button
            onClick={stopTracking}
            className="w-full p-4 bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold text-lg transition-colors"
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
    </div>
  );
};

export default MovementTracker;