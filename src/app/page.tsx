// src/app/page.tsx
'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import { useAudioTuner } from '@/hooks/useAudioTuner';
import { 
  getNoteAt, 
  calculateSRSWeight, 
  updateMasteryEntry, 
  NoteInfo, 
  MasteryEntry 
} from '@/lib/audio/pitchMath';
import { Fretboard } from '@/components/Fretboard';

const SUCCESS_THRESHOLD = 5;
const ERROR_THRESHOLD = 10;

type MasteryData = Record<string, MasteryEntry>;

interface TrainerSettings {
  activeStrings: number[];
  fretRange: [number, number];
  questionsPerRound: number;
  naturalsOnly: boolean;
  showHeatmap: boolean;
  micGain: number;
  noiseGateThreshold: number;
  deviceId: string;
  autoNextRound: boolean;
  hasSeenGuide: boolean;
}

const DEFAULT_SETTINGS: TrainerSettings = {
  activeStrings: [6], // Start with Low E only
  fretRange: [0, 11], // Start with 0-11
  questionsPerRound: 20,
  naturalsOnly: true, // Start with naturals only
  showHeatmap: false,
  micGain: 8,
  noiseGateThreshold: 8,
  deviceId: 'default',
  autoNextRound: false,
  hasSeenGuide: false,
};

export default function Home() {
  const [settings, setSettings] = useState<TrainerSettings>(DEFAULT_SETTINGS);
  const [mastery, setMastery] = useState<MasteryData>({});
  const [isLoaded, setIsLoaded] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  
  // --- GUIDE STATE ---
  const [showGuide, setShowGuide] = useState(false);
  const [guideSlide, setGuideSlide] = useState(0);

  // --- PERSISTENCE & INIT ---
  useEffect(() => {
    const savedMastery = localStorage.getItem('guitar-trainer-mastery');
    const savedSettings = localStorage.getItem('guitar-trainer-settings');
    if (savedMastery) { try { setMastery(JSON.parse(savedMastery)); } catch (e) { console.error(e); } }
    
    let loadedSettings = { ...DEFAULT_SETTINGS };
    if (savedSettings) { 
      try { 
        const parsed = JSON.parse(savedSettings);
        loadedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        setSettings(loadedSettings); 
      } catch (e) { console.error(e); } 
    }
    
    if (!loadedSettings.hasSeenGuide) {
      setShowGuide(true);
    }
    
    // Fetch input devices
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
    }).catch(console.error);

    setIsLoaded(true);
  }, []);

  const updateSetting = <K extends keyof TrainerSettings>(key: K, value: TrainerSettings[K]) => {
    setSettings(prev => {
      const newSettings = { ...prev, [key]: value };
      localStorage.setItem('guitar-trainer-settings', JSON.stringify(newSettings));
      return newSettings;
    });
  };

  const closeGuide = () => {
    setShowGuide(false);
    updateSetting('hasSeenGuide', true);
  };

  const resetProgress = useCallback(() => {
    if (confirm("Are you sure you want to reset your memorization progress? Your audio settings and calibration will remain.")) {
      setMastery({});
      localStorage.removeItem('guitar-trainer-mastery');
    }
  }, []);

  // --- GAME ENGINE STATE ---
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const currentQuestionIndexRef = useRef(0);
  const [mistakesInRound, setMistakesInRound] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState<NoteInfo | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isTransitioningRef = useRef(false);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [hasGuessedWrongOnCurrent, setHasGuessedWrongOnCurrent] = useState(false);
  const hasGuessedWrongOnCurrentRef = useRef(false);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  const questionStartTimeRef = useRef(0);
  const lastPromptRef = useRef<NoteInfo | null>(null);
  const previousPromptRef = useRef<NoteInfo | null>(null);
  const [feedback, setFeedback] = useState<{message: string, type: 'success'|'error'|'warning'|null}>({message: '', type: null});

  // --- AUTO-CALIBRATION ---
  const [calibrationState, setCalibrationState] = useState<'idle' | 'silence' | 'low_e' | 'high_e' | 'processing' | 'done'>('idle');
  const calibrationData = useRef({ maxSilence: 0, minNote: 100, maxStrum: 0 });

  const startCalibration = async () => {
    if (!tuner.isRunning) await tuner.start();
    setIsTransitioning(true); // pause game logic
    
    calibrationData.current = { maxSilence: 0, minNote: 100, maxStrum: 0 };
    setCalibrationState('silence');
    setFeedback({ message: 'Measuring Noise Floor... (3s)', type: 'error' });
    
    setTimeout(() => {
      setCalibrationState('low_e');
      setFeedback({ message: 'Play Low E (6th String)', type: 'warning' });
    }, 3000);
  };

  const finishCalibration = useCallback(() => {
    setCalibrationState('processing');
    setFeedback({ message: 'Optimizing Pipeline', type: 'success' });
    
    setTimeout(() => {
      let finalGate = 8;
      let finalGain = 8;

      setSettings(prevSettings => {
        const currentGain = prevSettings.micGain;
        const { maxSilence, maxStrum } = calibrationData.current;
        
        const gainMultiplier = maxStrum > 5 ? (85 / maxStrum) : 1;
        const newGain = Math.max(1, Math.min(20, Math.round(currentGain * gainMultiplier)));
        const actualMultiplier = newGain / currentGain;
        
        const scaledSilence = maxSilence * actualMultiplier;
        
        // Gate is set 8% above the absolute peak fan noise detected
        let newGate = Math.round(scaledSilence + 8);
        newGate = Math.max(1, Math.min(40, newGate));
        
        finalGate = newGate;
        finalGain = newGain;

        const updated = { ...prevSettings, micGain: newGain, noiseGateThreshold: newGate };
        localStorage.setItem('guitar-trainer-settings', JSON.stringify(updated));
        
        return updated;
      });

      setCalibrationState('done');
      setFeedback({ message: `Gain: ${finalGain}x | Gate: ${finalGate}%`, type: 'success' });

      setTimeout(() => {
        setCalibrationState('idle');
        setFeedback({ message: '', type: null }); // explicitly clear to avoid color bleed
        setIsTransitioning(false); // resume game
      }, 2500);

    }, 1000);
  }, []);

  const masteryScores = useMemo(() => {
    const scores: Record<string, number> = {};
    Object.entries(mastery).forEach(([key, entry]) => { scores[key] = entry.stability; });
    return scores;
  }, [mastery]);

  // --- CORE NOTE SELECTION ---
  const selectNextNote = useCallback(() => {
    const nextIndex = currentQuestionIndexRef.current + 1;
    
    if (currentQuestionIndexRef.current >= settings.questionsPerRound) {
        setIsTransitioning(true);
        setIsRoundComplete(true);
        setCurrentPrompt(null);
        return;
    }

    let selected: NoteInfo;
    const pool: { info: NoteInfo; weight: number }[] = [];
    
    settings.activeStrings.forEach(str => {
        for (let f = settings.fretRange[0]; f <= settings.fretRange[1]; f++) {
            const info = getNoteAt(str, f);
            // Prevent back-to-back duplicate notes across any string/octave
            if (lastPromptRef.current && lastPromptRef.current.noteName === info.noteName) continue;
            if (settings.naturalsOnly && info.noteName.includes('#')) continue;
            pool.push({ info, weight: calculateSRSWeight(mastery[`${str}-${f}`]) });
        }
    });
    
    if (pool.length === 0 && lastPromptRef.current) {
        pool.push({ info: lastPromptRef.current, weight: 100 });
    }

    if (pool.length === 0) {
        alert("Training scope too narrow. Please select more strings or frets.");
        return;
    }

    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let randomNum = Math.random() * totalWeight;
    selected = pool[0].info;
    for (const item of pool) {
        if (randomNum < item.weight) { selected = item.info; break; }
        randomNum -= item.weight;
    }

    previousPromptRef.current = currentPrompt;
    lastPromptRef.current = selected;
    setCurrentPrompt(selected);
    setQuestionStartTime(Date.now());
    currentQuestionIndexRef.current = nextIndex;
    setQuestionStartTime(Date.now());
    questionStartTimeRef.current = Date.now();
    setIsTransitioning(false);
    isTransitioningRef.current = false;
    setHasGuessedWrongOnCurrent(false);
    hasGuessedWrongOnCurrentRef.current = false;
    setFeedback({message: '', type: null});
  }, [settings, mastery]);

  const recordResult = useCallback((success: boolean, prompt: NoteInfo) => {
    const key = `${prompt.string}-${prompt.fret}`;
    const timeTaken = (Date.now() - questionStartTime) / 1000;
    
    setMastery(prev => {
        const newEntry = updateMasteryEntry(prev[key], success, timeTaken);
        const newData = { ...prev, [key]: newEntry };
        localStorage.setItem('guitar-trainer-mastery', JSON.stringify(newData));
        return newData;
    });
  }, [questionStartTime]);

  const triggerSuccessState = useCallback(() => {
    if (calibrationState === 'low_e') {
      setCalibrationState('high_e');
      setFeedback({ message: 'Play High E (1st String)', type: 'success' });
      return;
    }
    if (calibrationState === 'high_e') {
      finishCalibration();
      return;
    }

    if (isTransitioningRef.current || !currentPrompt) return;
    setIsTransitioning(true); 
    isTransitioningRef.current = true;
    recordResult(true, currentPrompt);
    setFeedback({message: 'Correct!', type: 'success'});
    setTimeout(selectNextNote, 150);
  }, [calibrationState, currentPrompt, recordResult, selectNextNote, finishCalibration]);

  const triggerWrongState = useCallback((detectedNote: string) => {
    if (isTransitioningRef.current || !currentPrompt) return;
    if (!hasGuessedWrongOnCurrentRef.current) { 
        setMistakesInRound(m => m + 1); 
        recordResult(false, currentPrompt); 
        setHasGuessedWrongOnCurrent(true); 
        hasGuessedWrongOnCurrentRef.current = true;
    }
    setFeedback({message: `Heard: ${detectedNote}`, type: 'error'});
    setTimeout(() => { setFeedback(f => f.type === 'error' ? {message: '', type: null} : f); }, 500);
  }, [currentPrompt, recordResult]);

  const targetMidiForTuner = useMemo(() => {
    if (calibrationState === 'low_e') return 40; // E2
    if (calibrationState === 'high_e') return 64; // E4
    if (isTransitioning || isRoundComplete || !currentPrompt) return null;
    return currentPrompt.midi;
  }, [calibrationState, isTransitioning, isRoundComplete, currentPrompt]);

  const tuner = useAudioTuner({ 
    micGain: settings.micGain, 
    noiseGateThreshold: settings.noiseGateThreshold,
    targetMidi: targetMidiForTuner,
    previousMidi: isTransitioning ? null : (previousPromptRef.current?.midi || null),
    deviceId: settings.deviceId,
    onSuccess: triggerSuccessState,
    onMistake: triggerWrongState
  });

  useEffect(() => {
    if (calibrationState === 'silence') {
      if (tuner.currentVolumePercent > calibrationData.current.maxSilence) calibrationData.current.maxSilence = tuner.currentVolumePercent;
    } else if (calibrationState === 'low_e' || calibrationState === 'high_e') {
      if (tuner.currentVolumePercent > calibrationData.current.maxStrum) calibrationData.current.maxStrum = tuner.currentVolumePercent;
    }
  }, [tuner.currentVolumePercent, calibrationState]);

  const startNewRound = useCallback(() => {
    setCurrentQuestionIndex(0);
    currentQuestionIndexRef.current = 0;
    setMistakesInRound(0);
    setIsRoundComplete(false);
    setIsTransitioning(false);
    setCountdown(null);
  }, []);

  useEffect(() => {
    if (isLoaded && !isRoundComplete && currentQuestionIndex === 0 && tuner.isRunning) {
        selectNextNote();
    }
  }, [isLoaded, isRoundComplete, currentQuestionIndex, tuner.isRunning, selectNextNote]);

  // Auto-Start Next Round Countdown
  useEffect(() => {
    if (isRoundComplete && settings.autoNextRound) {
        setCountdown(3);
        const interval = setInterval(() => setCountdown(c => c && c > 1 ? c - 1 : null), 1000);
        const timeout = setTimeout(() => {
            startNewRound();
        }, 3000);
        return () => { clearInterval(interval); clearTimeout(timeout); };
    } else {
        setCountdown(null);
    }
  }, [isRoundComplete, settings.autoNextRound, startNewRound]);

  const toggleString = (num: number) => {
    const newStrings = settings.activeStrings.includes(num) 
      ? settings.activeStrings.filter(n => n !== num) 
      : [...settings.activeStrings, num];
    updateSetting('activeStrings', newStrings);
  };

  const confidenceScore = useMemo(() => {
     let sum = 0;
     let count = 0;
     settings.activeStrings.forEach(str => {
       for(let f=settings.fretRange[0]; f<=settings.fretRange[1]; f++) {
         const info = getNoteAt(str, f);
         if (settings.naturalsOnly && info.noteName.includes('#')) continue;
         sum += masteryScores[`${str}-${f}`] || 0;
         count++;
       }
     });
     if (count === 0) return 0;
     return Math.floor((sum / count) * 100);
  }, [masteryScores, settings]);

  const guideContent = [
    {
      title: "The GuitarLlama Method",
      content: "Most players try to learn the neck by counting up the frets (A... A#... B... C). This is too slow for real playing.\n\nThis trainer jumps you around the neck unpredictably. By forcing you to find notes out of order, you stop counting and start building instant muscle memory."
    },
    {
      title: "Isolate Strings",
      content: "Focus on one string at a time to build your foundational map.\n\n• Toggle Natural Only ON.\n• Set Fret Span to 0 — 11.\n• Start with String 6 (Low E) and reach 100% Mastery before moving to String 5 (A)."
    },
    {
      title: "Connect the Map",
      content: "Once individual strings are clear, start connecting them vertically.\n\n• Select 3 adjacent strings at a time.\n• Keep Fret Span at 0 — 11 (the neck repeats at fret 12).\n• Toggle Natural Only OFF to find and fix your blind spots.\n• Eventually, expand to all 6 strings at once."
    },
    {
      title: "Calibrate",
      content: "Before you start, click the CALIBRATE button below.\n\nThe neural engine needs to learn your room's noise floor and your guitar's peak output volume to accurately track your fretboard."
    }
  ];

  if (!isLoaded) return <div className="h-screen bg-pro-bg flex items-center justify-center font-sans"><div className="text-pro-muted font-black animate-pulse uppercase tracking-[0.3em]">Neural Engine Loading...</div></div>;

  return (
    <div className="min-h-screen bg-pro-bg text-pro-text flex flex-col p-4 font-sans">
      <header className="flex justify-between items-center mb-4 px-2">
        <div className="flex items-center gap-3 select-none pointer-events-none">
          <Image src="/logo.png" alt="Guitar Llama Logo" width={180} height={40} className="object-contain" />
          <h1 className="text-xl md:text-2xl font-black tracking-tighter uppercase cursor-default"><span className="text-gradient font-black">FRETBOARD MEMORIZER</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => { setGuideSlide(0); setShowGuide(true); }}
            className="px-4 py-1.5 rounded-full text-xs font-black tracking-widest border transition-all cursor-pointer bg-pro-card border-pro-border text-pro-muted hover:border-pro-text hover:text-pro-text"
          >
            GUIDE
          </button>
          
          <button 
            onClick={resetProgress} 
            className="px-3 py-1.5 rounded-full text-xs font-black tracking-widest border transition-all cursor-pointer bg-pro-card border-pro-border text-pro-muted hover:border-danger hover:text-danger"
            title="Reset Neural Engine memory without losing calibration"
          >
            RESET CACHE
          </button>
          
          <button 
            onClick={() => updateSetting('showHeatmap', !settings.showHeatmap)} 
            className={`px-4 py-1.5 rounded-full text-sm font-black tracking-widest border transition-all cursor-pointer ${settings.showHeatmap ? 'bg-success/10 border-success text-success shadow-[0_0_15px_rgba(16,185,129,0.2)]' : 'bg-pro-card border-pro-border text-pro-muted hover:border-pro-accent hover:text-pro-accent'}`}
            title="Toggle fretboard mastery heatmap overlay"
          >
            HEATMAP
          </button>
          
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-pro-card border border-pro-border text-xs font-bold uppercase tracking-wider cursor-default select-none shadow-sm">
            <div className={`w-1.5 h-1.5 rounded-full ${tuner.isRunning ? 'bg-success animate-pulse' : tuner.isInitializing ? 'bg-warning animate-bounce' : 'bg-danger'}`}></div>
            {tuner.isRunning ? 'Live Engine' : tuner.isInitializing ? 'Connecting...' : 'Engine Idle'}
          </div>
        </div>
      </header>

      {/* Visually Hidden SEO Content */}
      <div className="sr-only">
        <h2>Guitar Fretboard Memorization App</h2>
        <p>
          Welcome to the ultimate guitar fretboard memorization app. GuitarLlama Fretboard Memorizer is an interactive guitar fret note memorizer app that listens to your real guitar.
          Use our neural spaced-repetition engine to learn guitar notes, master the fretboard, and improve your neural stability without needing midi cables.
        </p>
      </div>

      <main className="flex-1 grid grid-cols-12 gap-4 min-h-0">
        <div className="col-span-3 flex flex-col gap-4 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
          <section className="bg-pro-card p-5 rounded-2xl border border-pro-border shadow-pro">
            <h2 className="text-sm font-black text-pro-muted uppercase tracking-widest mb-4 flex items-center gap-2"><span className="w-1 h-3 bg-pro-accent rounded-full"></span>Training Focus</h2>
            <div className="flex flex-col gap-5">
              <div className="space-y-2 group">
                <div className="flex justify-between text-sm font-bold uppercase transition-colors group-hover:text-pro-accent"><span>Fret Span</span><span>0 — {settings.fretRange[1]}</span></div>
                <input type="range" min="0" max="22" value={settings.fretRange[1]} onChange={(e) => updateSetting('fretRange', [0, parseInt(e.target.value)])} className="accent-pro-accent w-full h-1 bg-pro-bg rounded-full cursor-pointer hover:h-1.5 transition-all" />
              </div>
              <button onClick={() => updateSetting('naturalsOnly', !settings.naturalsOnly)} className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${settings.naturalsOnly ? 'bg-success/5 border-success text-success' : 'bg-pro-bg border-pro-border text-pro-muted hover:border-pro-muted'}`}>
                <span className="text-sm font-bold uppercase">Natural Only</span>
                <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.naturalsOnly ? 'bg-success' : 'bg-pro-muted/30'}`}><div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${settings.naturalsOnly ? 'left-4.5' : 'left-0.5'}`}></div></div>
              </button>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-sm font-bold uppercase transition-colors group-hover:text-pro-accent"><span>Strings</span></div>
                <div className="grid grid-cols-3 gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map(num => (
                    <button key={num} onClick={() => toggleString(num)} className={`py-2 rounded-lg text-xs font-black border transition-all cursor-pointer ${settings.activeStrings.includes(num) ? 'bg-pro-text border-pro-text text-pro-card shadow-md scale-[1.02]' : 'bg-pro-bg border-pro-border text-pro-muted hover:border-pro-muted hover:scale-[1.02]'}`}>{num}</button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="bg-pro-card p-5 rounded-2xl border border-pro-border shadow-pro">
            <h2 className="text-sm font-black text-pro-muted uppercase tracking-widest mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="w-1 h-3 bg-primary rounded-full"></span>Acoustics</div>
              <button onClick={startCalibration} disabled={calibrationState !== 'idle'} className="bg-primary/10 text-primary hover:bg-primary/20 px-2 py-1 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-wait">CALIBRATE</button>
            </h2>
            <div className="flex flex-col gap-4">
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-bold uppercase"><span>Input Device</span></div>
                <select 
                  value={settings.deviceId} 
                  onChange={e => updateSetting('deviceId', e.target.value)}
                  className="w-full bg-pro-bg border border-pro-border text-pro-text text-sm p-1.5 rounded-lg focus:border-primary outline-none"
                >
                  <option value="default">System Default</option>
                  {audioDevices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone ${device.deviceId.substring(0, 5)}...`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1"><div className="flex justify-between text-xs font-bold uppercase"><span>Gain</span><span className="text-primary">{settings.micGain}x</span></div><input type="range" min="1" max="20" value={settings.micGain} onChange={e => updateSetting('micGain', parseFloat(e.target.value))} className="accent-primary w-full h-1 bg-pro-bg rounded-full cursor-pointer transition-all" /></div>
              <div className="space-y-1"><div className="flex justify-between text-xs font-bold uppercase"><span>Gate</span><span className="text-primary">{settings.noiseGateThreshold}%</span></div><input type="range" min="1" max="40" value={settings.noiseGateThreshold} onChange={e => updateSetting('noiseGateThreshold', parseFloat(e.target.value))} className="accent-primary w-full h-1 bg-pro-bg rounded-full cursor-pointer transition-all" /></div>
              <div className="relative h-3 bg-pro-bg rounded-full overflow-hidden border border-pro-border p-0.5 mt-1">
                <div className="absolute top-0 bottom-0 w-[1.5px] bg-danger z-10 shadow-[0_0_5px_rgba(239,68,68,0.5)]" style={{ left: `${settings.noiseGateThreshold}%` }} />
                <div className={`h-full rounded-full transition-all duration-75 ${tuner.currentVolumePercent >= settings.noiseGateThreshold ? 'bg-success shadow-[0_0_10px_rgba(16,185,129,0.4)]' : 'bg-warning/40 opacity-50'}`} style={{ width: `${tuner.currentVolumePercent}%` }} />
              </div>
              <div className="flex justify-between items-center mt-2 px-1 py-1 rounded bg-pro-bg/50 border border-pro-border/50">
                 <span className="text-xs font-black text-pro-muted uppercase tracking-tighter">Detected Info:</span>
                 <span className="text-sm font-black text-pro-accent tracking-tight">
                   {tuner.isRunning 
                     ? (tuner.detectedNoteName ? `${tuner.detectedNoteName} (${tuner.detectedFrequency}Hz)` : '...')
                     : '--'
                   }
                 </span>
              </div>
            </div>
          </section>
        </div>

        <div className="col-span-9 flex flex-col gap-4 min-h-0">
          <div className={`flex-1 relative flex flex-col items-center justify-center p-6 rounded-[2.5rem] border border-pro-border shadow-pro transition-colors duration-75 overflow-hidden ${calibrationState !== 'idle' ? 'bg-primary/5 border-primary' : feedback.type === 'success' ? 'bg-success/[0.04]' : feedback.type === 'error' ? 'bg-danger/[0.04]' : 'bg-pro-card'}`}>
            
            {showGuide ? (
              <div className="flex flex-col justify-center items-center h-full w-full animate-in fade-in zoom-in duration-300 max-w-xl mx-auto z-10">
                <div className="flex justify-between w-full mb-3 px-2">
                  <div className="text-pro-accent font-black uppercase tracking-widest text-[10px]">HOW TO USE</div>
                  <div className="text-pro-muted font-bold text-[10px]">{guideSlide + 1} / {guideContent.length}</div>
                </div>
                
                <div className="w-full bg-pro-bg/40 p-6 md:p-8 rounded-3xl border border-pro-border/50 text-left flex flex-col gap-4 shadow-inner">
                  <h2 className="text-2xl md:text-3xl font-black text-pro-text">{guideContent[guideSlide].title}</h2>
                  <div className="text-sm md:text-base text-pro-muted leading-relaxed whitespace-pre-wrap">
                    {guideContent[guideSlide].content}
                  </div>
                </div>

                <div className="flex justify-between items-center w-full mt-6 gap-4">
                  <button 
                    onClick={() => guideSlide > 0 ? setGuideSlide(s => s - 1) : closeGuide()} 
                    className="flex-1 py-3 rounded-2xl bg-pro-bg border border-pro-border text-pro-muted font-black uppercase text-[10px] tracking-widest transition-all hover:border-pro-muted hover:bg-pro-card cursor-pointer"
                  >
                    {guideSlide > 0 ? 'Previous' : 'Skip Guide'}
                  </button>
                  <button 
                    onClick={() => {
                      if (guideSlide < guideContent.length - 1) {
                        setGuideSlide(s => s + 1);
                      } else {
                        closeGuide();
                        startCalibration();
                      }
                    }} 
                    className="flex-1 py-3 rounded-2xl bg-pro-accent text-white font-black uppercase text-[10px] tracking-widest shadow-lg shadow-pro-accent/20 transition-all hover:scale-[1.02] cursor-pointer"
                  >
                    {guideSlide < guideContent.length - 1 ? 'Next' : 'Calibrate'}
                  </button>
                </div>
              </div>
            ) : calibrationState !== 'idle' ? (
              <div className="flex flex-col items-center justify-center h-full w-full animate-in fade-in zoom-in duration-300">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[15rem] font-black opacity-[0.02] select-none pointer-events-none text-primary">MIC</div>
                
                <div className="mb-8 flex gap-3">
                  <div className={`w-3 h-3 rounded-full transition-all ${calibrationState === 'silence' ? 'bg-danger animate-pulse scale-125 shadow-[0_0_10px_rgba(239,68,68,0.5)]' : calibrationState === 'done' ? 'bg-success shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-pro-border'}`} />
                  <div className={`w-3 h-3 rounded-full transition-all ${calibrationState === 'low_e' ? 'bg-warning animate-pulse scale-125 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : calibrationState === 'done' ? 'bg-success shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-pro-border'}`} />
                  <div className={`w-3 h-3 rounded-full transition-all ${calibrationState === 'high_e' ? 'bg-success animate-pulse scale-125 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : calibrationState === 'done' ? 'bg-success shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-pro-border'}`} />
                </div>

                <div className="text-pro-accent text-sm font-black uppercase tracking-[0.3em] mb-4">
                  {calibrationState === 'silence' && 'Step 1: Noise Floor'}
                  {calibrationState === 'low_e' && 'Step 2: Low Register'}
                  {calibrationState === 'high_e' && 'Step 3: High Register'}
                  {calibrationState === 'processing' && 'Calculating...'}
                  {calibrationState === 'done' && 'Configuration Saved'}
                </div>
                
                <div className="text-4xl md:text-5xl font-black text-center max-w-lg leading-tight text-pro-text drop-shadow-md">
                  {calibrationState === 'silence' && 'Keep completely quiet.'}
                  {calibrationState === 'low_e' && 'Play Low E (quietly)'}
                  {calibrationState === 'high_e' && 'Play High E (loudly)'}
                  {calibrationState === 'processing' && 'Optimizing Pipeline'}
                  {calibrationState === 'done' && 'Ready to Train.'}
                </div>

                {calibrationState !== 'processing' && calibrationState !== 'done' && (
                  <div className="mt-12 w-full max-w-md bg-pro-bg/50 rounded-full h-4 overflow-hidden border border-pro-border shadow-inner">
                    <div 
                      className={`h-full transition-all duration-75 ${calibrationState === 'silence' ? 'bg-danger' : calibrationState === 'low_e' ? 'bg-warning' : 'bg-success'}`}
                      style={{ width: `${tuner.currentVolumePercent}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(10rem,25vw,20rem)] font-black opacity-[0.015] select-none pointer-events-none transition-all leading-none">{currentPrompt?.noteName || '??'}</div>
                <div className={`mb-4 px-5 py-1.5 rounded-full text-xs font-black uppercase tracking-[0.25em] transition-all border shadow-sm flex items-center gap-2 ${feedback.type === 'success' ? 'bg-success border-success text-white' : feedback.type === 'error' ? 'bg-danger border-danger text-white' : 'bg-pro-bg border-pro-border text-pro-muted'}`}>
                  {(!feedback.type && tuner.isRunning) && (
                    <svg className="w-3.5 h-3.5 opacity-70 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5 10v4a2 2 0 002 2h2.586l3.707 3.707A1 1 0 0015 19V5a1 1 0 00-1.707-.707L9.586 8H7a2 2 0 00-2 2z"></path>
                    </svg>
                  )}
                  {(!feedback.type && !tuner.isRunning && !tuner.isInitializing) && (
                    <svg className="w-3.5 h-3.5 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" clipRule="evenodd"></path>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"></path>
                    </svg>
                  )}
                  <span>{feedback.message || (tuner.isRunning ? 'Scanning Frequency' : tuner.isInitializing ? 'Waking Neural Core' : 'Standby')}</span>
                </div>
                <div className={`text-pro-muted text-sm font-black uppercase tracking-[0.3em] ${isRoundComplete ? 'mb-6' : 'mb-2'} opacity-50`}>{isRoundComplete ? "Round Complete" : currentPrompt ? `Location: String ${currentPrompt.string} — Fret ${currentPrompt.fret}` : "Ready to Begin"}</div>
                <div className={`text-[clamp(6rem,15vw,12rem)] font-black tracking-tighter leading-none transform drop-shadow-sm ${feedback.type === 'success' ? 'scale-105 text-success transition-transform duration-150' : feedback.type === 'error' ? 'shake text-danger' : 'text-pro-text'}`}>{isRoundComplete ? "🏆" : currentPrompt ? currentPrompt.noteName : "--"}</div>
                <div className="mt-8 w-full max-w-[280px]">
                  {tuner.isRunning && currentPrompt && !isRoundComplete ? (
                    <button onClick={() => { if (!isTransitioning) { recordResult(false, currentPrompt); selectNextNote(); }}} className="w-full py-3.5 rounded-xl bg-pro-bg border border-pro-border text-pro-muted font-black uppercase text-xs tracking-widest transition-all cursor-pointer hover:border-pro-muted hover:bg-pro-card active:scale-95 shadow-sm">Skip Iteration</button>
                  ) : !tuner.isRunning ? (
                    <button onClick={tuner.start} disabled={tuner.isInitializing} className={`w-full py-4 rounded-3xl font-black uppercase text-base tracking-[0.2em] shadow-2xl transition-all active:scale-95 flex items-center justify-center gap-3 ${tuner.isInitializing ? 'bg-pro-border text-pro-muted cursor-wait' : 'bg-pro-text text-pro-card cursor-pointer hover:scale-[1.02] shadow-pro-accent/10'}`}>
                      {tuner.isInitializing && <div className="w-3 h-3 border-2 border-pro-muted border-t-pro-accent rounded-full animate-spin"></div>}
                      {tuner.isInitializing ? 'Connecting...' : 'Start Microphone'}
                    </button>
                  ) : (
                    <div className="flex flex-col gap-3 w-full">
                      <button onClick={startNewRound} className="w-full py-4 rounded-3xl bg-pro-accent text-white font-black uppercase text-sm tracking-widest shadow-xl shadow-pro-accent/20 cursor-pointer hover:scale-[1.02] active:scale-95 transition-all px-2">
                        {countdown !== null ? `Auto-Starting in ${countdown}...` : 'Launch Round'}
                      </button>
                      {isRoundComplete && (
                        <label className="flex items-center justify-center gap-2 cursor-pointer opacity-70 hover:opacity-100 transition-opacity">
                          <input type="checkbox" checked={settings.autoNextRound} onChange={e => updateSetting('autoNextRound', e.target.checked)} className="accent-pro-accent w-3 h-3" />
                          <span className="text-xs font-bold uppercase tracking-widest text-pro-muted">Auto-Start Next Round</span>
                        </label>
                      )}
                    </div>
                  )}
                  </div>
                  </>
                  )}
                  </div>

                  <div className="bg-pro-card rounded-3xl border border-pro-border p-5 shadow-pro relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-pro-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <Fretboard highlightedFret={currentPrompt ? { string: currentPrompt.string, fret: currentPrompt.fret } : null} activeNote={(tuner.detectedNoteName && currentPrompt && tuner.detectedNoteName.replace(/-?\d+$/, '') === currentPrompt.noteName) ? { string: currentPrompt.string, fret: currentPrompt.fret } : null} masteryData={masteryScores} showHeatmap={settings.showHeatmap} fretRange={settings.fretRange} />
                  </div>

                  <div className="grid grid-cols-3 gap-6 mb-2 relative z-50">
                     <div className="group relative bg-pro-card py-4 px-6 rounded-2xl border border-pro-border flex justify-between items-center shadow-sm cursor-help">
                       <span className="text-xs font-black text-pro-muted uppercase tracking-[0.2em] opacity-60 group-hover:text-pro-text transition-colors">Iteration</span>
                       <span className="text-xl font-black tracking-tight">{currentQuestionIndex} <span className="text-pro-muted text-sm">/ {settings.questionsPerRound}</span></span>
                       <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-48 p-2 bg-pro-text text-pro-bg text-sm font-bold text-center rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none shadow-xl">
                         Current question out of total questions in this round
                         <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-pro-text"></div>
                       </div>
                     </div>
                     <div className="group relative bg-pro-card py-4 px-6 rounded-2xl border border-pro-border flex justify-between items-center shadow-sm cursor-help">
                       <span className="text-xs font-black text-pro-muted uppercase tracking-[0.2em] opacity-60 group-hover:text-pro-text transition-colors">Errors</span>
                       <span className={`text-xl font-black tracking-tight ${mistakesInRound > 0 ? 'text-danger' : 'text-success'}`}>{mistakesInRound}</span>
                       <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-48 p-2 bg-pro-text text-pro-bg text-sm font-bold text-center rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none shadow-xl">
                         Total mistakes made during the current round
                         <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-pro-text"></div>
                       </div>
                     </div>
                     <div className="group relative bg-pro-card py-4 px-6 rounded-2xl border border-pro-border flex justify-between items-center shadow-sm cursor-help">
                       <span className="text-xs font-black text-pro-muted uppercase tracking-[0.2em] opacity-60 group-hover:text-pro-accent transition-colors">Neck Mastery</span>
                       <span className="text-xl font-black tracking-tight text-pro-accent">{confidenceScore}%</span>
                       <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-64 p-3 bg-pro-text text-pro-bg text-xs font-bold rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 pointer-events-none shadow-2xl leading-relaxed">
                         <div className="mb-1 text-pro-accent uppercase tracking-tighter">Memorization Mastery</div>
                         <ul className="space-y-1 opacity-90">
                           <li><span className="text-success">85-100%</span>: Proficient (Recall under 4s)</li>
                           <li><span className="text-warning">60-84%</span>: Improving (Recall under 8s)</li>
                           <li><span className="text-danger">0-59%</span>: Learning (Looking down or guessing)</li>                         </ul>
                         <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-pro-text"></div>
                       </div>
                     </div>                  </div>        </div>
      </main>
      <style jsx global>{`
        @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } } 
        .shake { animation: shake 0.12s ease-in-out 0s 2; }
        .text-gradient { background: linear-gradient(135deg, #6366f1 0%, #06b6d4 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </div>
  );
}
