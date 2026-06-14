# Guitar Trainer Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the vanilla JS guitar trainer into a Next.js application using React and Tailwind CSS while preserving the exact audio math.

**Architecture:** A custom React hook (`useAudioTuner`) will manage the Web Audio API graph and `requestAnimationFrame` loop, passing volume and pitch data up to a client-side `page.tsx` component which handles the Spaced Repetition game logic and UI. Pure audio math is decoupled into `pitchMath.ts`.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind CSS, Vitest (for unit testing the math).

---

### Task 1: Setup Testing Framework (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install Vitest**
```bash
npm install -D vitest @testing-library/react jsdom
```

- [ ] **Step 2: Create Vitest config**
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- [ ] **Step 3: Add test script to package.json**
```bash
npm pkg set scripts.test="vitest run"
```

- [ ] **Step 4: Run tests to verify setup**
```bash
npm run test
```
Expected: "No test files found" (which means Vitest successfully ran).

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: setup vitest for TDD"
```

---

### Task 2: Implement Pitch Math Utilities

**Files:**
- Create: `src/lib/audio/pitchMath.ts`
- Create: `src/lib/audio/pitchMath.test.ts`

- [ ] **Step 1: Write failing test for constants and basic autocorrelation**
```typescript
// src/lib/audio/pitchMath.test.ts
import { expect, test } from 'vitest';
import { NOTE_NAMES, STRING_BASE_MIDI, autoCorrelateFrequency } from './pitchMath';

test('exports correct constants', () => {
    expect(NOTE_NAMES[0]).toBe("C");
    expect(STRING_BASE_MIDI[1]).toBe(64);
});

test('autoCorrelateFrequency returns -1 for silence', () => {
    const buffer = new Float32Array(2048).fill(0);
    expect(autoCorrelateFrequency(buffer, 48000)).toBe(-1);
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
npm run test
```
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**
```typescript
// src/lib/audio/pitchMath.ts
export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const STRING_BASE_MIDI: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

export function autoCorrelateFrequency(buffer: Float32Array, sampleRate: number): number {
    const SIZE = buffer.length;
    let targetLeftIndex = 0, targetRightIndex = SIZE - 1;
    const clippingThreshold = 0.2;
    
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < clippingThreshold) { targetLeftIndex = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < clippingThreshold) { targetRightIndex = SIZE - i; break; }

    const truncatedBuffer = buffer.slice(targetLeftIndex, targetRightIndex);
    const truncatedSize = truncatedBuffer.length;
    if (truncatedSize === 0) return -1;

    const correlationArray = new Array(truncatedSize).fill(0);
    
    for (let i = 0; i < truncatedSize; i++) {
        for (let j = 0; j < truncatedSize - i; j++) {
            correlationArray[i] = correlationArray[i] + truncatedBuffer[j] * truncatedBuffer[j + i];
        }
    }

    let scanPointer = 0;
    while (scanPointer < truncatedSize - 1 && correlationArray[scanPointer] > correlationArray[scanPointer + 1]) scanPointer++;
    if (scanPointer === truncatedSize - 1) return -1;

    let maxval = -1, maxpos = -1;
    for (let i = scanPointer; i < truncatedSize; i++) {
        if (correlationArray[i] > maxval) {
            maxval = correlationArray[i];
            maxpos = i;
        }
    }
    
    let T0 = maxpos;

    if (T0 > 0 && T0 < truncatedSize - 1) {
        let x1 = correlationArray[T0 - 1], x2 = correlationArray[T0], x3 = correlationArray[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);
    }

    if (T0 > 0) return sampleRate / T0;
    return -1;
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
npm run test
```
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/audio/pitchMath.ts src/lib/audio/pitchMath.test.ts
git commit -m "feat: add pitch detection math utilities"
```

---

### Task 3: Implement Web Audio Hook

**Files:**
- Create: `src/hooks/useAudioTuner.ts`

- [ ] **Step 1: Write the hook implementation**

Web Audio API is difficult to mock fully in JSDOM, so we will implement the hook directly.

```typescript
// src/hooks/useAudioTuner.ts
import { useState, useRef, useEffect, useCallback } from 'react';
import { autoCorrelateFrequency, NOTE_NAMES } from '../lib/audio/pitchMath';

interface AudioTunerState {
  isRunning: boolean;
  currentVolumePercent: number;
  micGain: number;
  noiseGateThreshold: number;
  detectedNoteName: string | null;
}

export function useAudioTuner() {
  const [isRunning, setIsRunning] = useState(false);
  const [currentVolumePercent, setCurrentVolumePercent] = useState(0);
  const [micGain, setMicGain] = useState(8);
  const [noiseGateThreshold, setNoiseGateThreshold] = useState(8);
  const [detectedNoteName, setDetectedNoteName] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sync gain when it changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = micGain;
    }
  }, [micGain]);

  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
    }
    setIsRunning(false);
    setCurrentVolumePercent(0);
    setDetectedNoteName(null);
  }, []);

  const executePitchDetectionLoop = useCallback(() => {
    if (!analyserRef.current || !audioCtxRef.current) return;

    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    
    const volumePercent = Math.min(100, rms * 400);
    setCurrentVolumePercent(volumePercent);

    if (volumePercent >= noiseGateThreshold) {
      const frequency = autoCorrelateFrequency(buffer, audioCtxRef.current.sampleRate);
      if (frequency !== -1) {
        const exactMidi = 12 * Math.log2(frequency / 440) + 69;
        const roundedMidi = Math.round(exactMidi);
        const noteName = NOTE_NAMES[roundedMidi % 12];
        setDetectedNoteName(noteName);
      }
    } else {
      setDetectedNoteName(null);
    }

    animationFrameRef.current = requestAnimationFrame(executePitchDetectionLoop);
  }, [noiseGateThreshold]);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
      });
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = micGain;

      const filterNode = audioCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = 800;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(gainNode);
      gainNode.connect(filterNode);
      filterNode.connect(analyser);

      audioCtxRef.current = audioCtx;
      analyserRef.current = analyser;
      gainNodeRef.current = gainNode;
      filterNodeRef.current = filterNode;
      streamRef.current = stream;

      setIsRunning(true);
      animationFrameRef.current = requestAnimationFrame(executePitchDetectionLoop);
    } catch (err) {
      console.error("Microphone access failed", err);
      alert("Microphone access required.");
    }
  }, [executePitchDetectionLoop, micGain]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    isRunning,
    start,
    stop,
    currentVolumePercent,
    micGain,
    setMicGain,
    noiseGateThreshold,
    setNoiseGateThreshold,
    detectedNoteName
  };
}
```

- [ ] **Step 2: Ensure it compiles**
Run: `npm run build` (Wait for NextJS build output or just rely on TS checking via `npx tsc --noEmit`)
Expected: Completes without type errors.

- [ ] **Step 3: Commit**
```bash
git add src/hooks/useAudioTuner.ts
git commit -m "feat: implement useAudioTuner hook"
```

---

### Task 4: Implement UI and Game Engine (`page.tsx`)

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Write the component implementation**
Replace `src/app/page.tsx` completely:

```tsx
// src/app/page.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioTuner } from '@/hooks/useAudioTuner';
import { NOTE_NAMES, STRING_BASE_MIDI } from '@/lib/audio/pitchMath';

const SUCCESS_THRESHOLD = 5;
const ERROR_THRESHOLD = 10;

interface LearningItem {
  string: number;
  fret: number;
  noteName: string;
  weight: number;
}

export default function Home() {
  const tuner = useAudioTuner();
  
  // Settings
  const [activeStrings, setActiveStrings] = useState<number[]>([1, 2, 3, 4, 5, 6]);
  const [questionsPerRound, setQuestionsPerRound] = useState(20);
  
  // Game State
  const [learningPool, setLearningPool] = useState<LearningItem[]>([]);
  const [roundNumber, setRoundNumber] = useState(1);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [mistakesInRound, setMistakesInRound] = useState(0);
  const [currentPrompt, setCurrentPrompt] = useState<LearningItem | null>(null);
  
  // Round/Transition Flags
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isRoundComplete, setIsRoundComplete] = useState(false);
  const [hasGuessedWrongOnCurrent, setHasGuessedWrongOnCurrent] = useState(false);
  const [questionStartTime, setQuestionStartTime] = useState(0);
  
  // Stability Tracking
  const [targetNoteHoldCounter, setTargetNoteHoldCounter] = useState(0);
  const [wrongNoteHoldCounter, setWrongNoteHoldCounter] = useState(0);
  const [lastDetectedWrongNote, setLastDetectedWrongNote] = useState("");
  const [feedback, setFeedback] = useState<{message: string, type: 'success'|'error'|null}>({message: '', type: null});

  const buildLearningPool = useCallback(() => {
    const pool: LearningItem[] = [];
    activeStrings.forEach(stringNum => {
      for (let fret = 0; fret <= 11; fret++) {
        const midi = STRING_BASE_MIDI[stringNum] + fret;
        const noteName = NOTE_NAMES[midi % 12];
        if (noteName.length === 1) {
          pool.push({ string: stringNum, fret, noteName, weight: 100 });
        }
      }
    });
    setLearningPool(pool);
    return pool;
  }, [activeStrings]);

  const generateNextQuestion = useCallback((currentPool: LearningItem[]) => {
    if (currentPool.length === 0) return;
    
    setIsTransitioning(false);
    setHasGuessedWrongOnCurrent(false);
    setTargetNoteHoldCounter(0);
    setWrongNoteHoldCounter(0);
    setFeedback({message: '', type: null});

    if (currentQuestionIndex >= questionsPerRound) {
      setIsTransitioning(true);
      setIsRoundComplete(true);
      setRoundNumber(r => r + 1);
      setCurrentPrompt(null);
      return;
    }

    setCurrentQuestionIndex(prev => prev + 1);

    const totalWeight = currentPool.reduce((sum, item) => sum + item.weight, 0);
    let randomNum = Math.random() * totalWeight;
    let selected = currentPool[0];
    
    for (let item of currentPool) {
      if (randomNum < item.weight) { selected = item; break; }
      randomNum -= item.weight;
    }

    setCurrentPrompt(selected);
    setQuestionStartTime(Date.now());
  }, [currentQuestionIndex, questionsPerRound]);

  const startNewRound = useCallback(() => {
    if (activeStrings.length === 0) return alert("Select at least one string.");
    const pool = buildLearningPool();
    setCurrentQuestionIndex(0);
    setMistakesInRound(0);
    setIsRoundComplete(false);
    generateNextQuestion(pool);
  }, [activeStrings, buildLearningPool, generateNextQuestion]);

  const penalizeCurrentNote = useCallback((amount: number) => {
    if (currentPrompt) currentPrompt.weight += amount;
  }, [currentPrompt]);

  const triggerSuccessState = useCallback(() => {
    setIsTransitioning(true);
    const timeTaken = (Date.now() - questionStartTime) / 1000;
    
    if (!hasGuessedWrongOnCurrent && timeTaken < 3 && currentPrompt) {
      currentPrompt.weight = Math.max(10, currentPrompt.weight - 30);
    } else if (timeTaken > 6 && currentPrompt) {
      currentPrompt.weight += 20;
    }

    setFeedback({message: 'Correct!', type: 'success'});
    setTimeout(() => generateNextQuestion(learningPool), 1000);
  }, [currentPrompt, hasGuessedWrongOnCurrent, questionStartTime, learningPool, generateNextQuestion]);

  const triggerWrongState = useCallback((detectedNote: string) => {
    if (!hasGuessedWrongOnCurrent) {
      setMistakesInRound(m => m + 1);
      penalizeCurrentNote(40);
      setHasGuessedWrongOnCurrent(true);
    }
    setFeedback({message: `Heard: ${detectedNote}`, type: 'error'});
    setTimeout(() => {
      setFeedback(f => f.type === 'error' ? {message: '', type: null} : f);
    }, 800);
  }, [hasGuessedWrongOnCurrent, penalizeCurrentNote]);

  // Main Detection Loop reaction
  useEffect(() => {
    if (isTransitioning || !currentPrompt || !tuner.detectedNoteName) {
      if (!tuner.detectedNoteName && !isTransitioning) {
        setTargetNoteHoldCounter(0);
        setWrongNoteHoldCounter(0);
      }
      return;
    }

    const note = tuner.detectedNoteName;

    if (note === currentPrompt.noteName) {
      setWrongNoteHoldCounter(0);
      setTargetNoteHoldCounter(c => {
        const newCount = c + 1;
        if (newCount >= SUCCESS_THRESHOLD) {
          triggerSuccessState();
        }
        return newCount;
      });
    } else if (note.length === 1) {
      setTargetNoteHoldCounter(0);
      if (note === lastDetectedWrongNote) {
        setWrongNoteHoldCounter(c => {
          const newCount = c + 1;
          if (newCount >= ERROR_THRESHOLD) {
            triggerWrongState(note);
            return 0; // reset after trigger
          }
          return newCount;
        });
      } else {
        setLastDetectedWrongNote(note);
        setWrongNoteHoldCounter(0);
      }
    }
  }, [tuner.detectedNoteName, currentPrompt, isTransitioning, lastDetectedWrongNote, triggerSuccessState, triggerWrongState]);

  const toggleString = (stringNum: number) => {
    setActiveStrings(prev => 
      prev.includes(stringNum) ? prev.filter(n => n !== stringNum) : [...prev, stringNum]
    );
  };

  const getMeterColor = () => {
    if (tuner.currentVolumePercent < tuner.noiseGateThreshold) return 'bg-yellow-400';
    if (tuner.currentVolumePercent >= 95) return 'bg-red-500';
    return 'bg-green-500';
  };

  const getQuizBoxClass = () => {
    if (feedback.type === 'success') return 'bg-emerald-50 border-emerald-500';
    if (feedback.type === 'error') return 'bg-red-50 border-red-500';
    return 'bg-slate-50 border-transparent';
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 p-5 flex flex-col items-center">
      <div className="max-w-xl w-full bg-white p-8 rounded-xl shadow-sm">
        <h1 className="text-2xl font-bold text-center mb-6">Fretboard Trainer</h1>

        <div className="border border-slate-200 rounded-lg p-4 mb-5">
          <div className="flex justify-between items-center mb-3 text-sm font-bold text-slate-500 uppercase tracking-wide">
            <span>Select Strings</span>
            <label className="flex items-center gap-2">
              Round Size:
              <select 
                className="p-1 border rounded"
                value={questionsPerRound} 
                onChange={e => setQuestionsPerRound(parseInt(e.target.value))}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </label>
          </div>
          
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[1, 2, 3, 4, 5, 6].map(num => (
              <label key={num} className="flex items-center gap-2 text-sm cursor-pointer">
                <input 
                  type="checkbox" 
                  className="w-4 h-4"
                  checked={activeStrings.includes(num)} 
                  onChange={() => toggleString(num)} 
                /> 
                {num === 1 ? '1st (E)' : num === 2 ? '2nd (B)' : num === 3 ? '3rd (G)' : num === 4 ? '4th (D)' : num === 5 ? '5th (A)' : '6th (E)'}
              </label>
            ))}
          </div>

          <div className="bg-slate-50 p-4 rounded-md border-2 border-slate-200 flex flex-col gap-3 text-sm font-bold">
            <div className="flex items-center gap-3">
              <label className="w-24">Mic Boost:</label>
              <input 
                type="range" min="1" max="20" step="1" 
                className="flex-grow cursor-pointer"
                value={tuner.micGain} 
                onChange={e => tuner.setMicGain(parseFloat(e.target.value))} 
              />
              <span className="bg-white px-2 py-1 border border-slate-300 rounded text-center min-w-[48px]">{tuner.micGain}x</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="w-24">Noise Gate:</label>
              <input 
                type="range" min="1" max="40" step="1" 
                className="flex-grow cursor-pointer"
                value={tuner.noiseGateThreshold} 
                onChange={e => tuner.setNoiseGateThreshold(parseFloat(e.target.value))} 
              />
              <span className="bg-white px-2 py-1 border border-slate-300 rounded text-center min-w-[48px]">{tuner.noiseGateThreshold}%</span>
            </div>
            
            <div className="mt-2">
              <div className="text-[10px] text-slate-500 text-center uppercase tracking-[1px] mb-1">Input Volume</div>
              <div className="relative w-full h-3.5 bg-slate-200 rounded-full overflow-hidden shadow-inner">
                <div 
                  className="absolute top-0 bottom-0 w-[3px] bg-red-500 z-10 shadow-[0_0_3px_rgba(0,0,0,0.5)]" 
                  style={{ left: `${tuner.noiseGateThreshold}%` }} 
                />
                <div 
                  className={`h-full transition-all duration-75 ${getMeterColor()}`} 
                  style={{ width: `${tuner.currentVolumePercent}%` }} 
                />
              </div>
            </div>
          </div>
        </div>

        {!tuner.isRunning && (
          <button 
            onClick={tuner.start} 
            className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-md transition-colors my-4"
          >
            START SESSION (Enable Mic)
          </button>
        )}

        <div className={`text-center py-8 px-3 my-3 rounded-lg border-4 transition-colors duration-150 ${getQuizBoxClass()}`}>
          <div className={`font-bold text-xl h-6 mb-2 ${feedback.type === 'success' ? 'text-green-500' : feedback.type === 'error' ? 'text-red-500' : 'invisible'}`}>
            {feedback.message || 'Placeholder'}
          </div>
          <div className="text-xl text-slate-500 mb-1">
            {isRoundComplete ? "Round Complete!" : currentPrompt ? `String ${currentPrompt.string}` : "Awaiting Start..."}
          </div>
          <div className={`text-6xl font-black my-4 transition-colors duration-150 ${feedback.type === 'success' ? 'text-green-500' : feedback.type === 'error' ? 'text-red-500' : 'text-blue-500'}`}>
            {isRoundComplete ? "🎸" : currentPrompt ? currentPrompt.noteName : "--"}
          </div>
          
          {tuner.isRunning && currentPrompt && !isRoundComplete && (
            <button 
              onClick={() => {
                if (!isTransitioning) {
                  penalizeCurrentNote(50);
                  generateNextQuestion(learningPool);
                }
              }}
              className="mt-4 px-6 py-2 bg-slate-400 hover:bg-slate-500 text-white rounded font-bold transition-colors mx-auto block max-w-[150px]"
            >
              Skip Note
            </button>
          )}

          {tuner.isRunning && isRoundComplete && (
            <button 
              onClick={startNewRound}
              className="mt-4 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded font-bold transition-colors mx-auto block"
            >
              Start Next Round
            </button>
          )}
        </div>

        <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-4">
          <div>Round: <span>{roundNumber}</span></div>
          <div>Question: <span>{currentQuestionIndex}</span> / <span>{questionsPerRound}</span></div>
          <div className="text-red-500">Mistakes: <span>{mistakesInRound}</span></div>
        </div>

        <div className="text-center text-xs text-slate-500 font-bold mt-4 h-5">
          {tuner.isRunning ? (
            tuner.currentVolumePercent < tuner.noiseGateThreshold 
              ? "Quiet..." 
              : `Note: ${tuner.detectedNoteName || '--'}`
          ) : "Audio context is dormant."}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Clean up original `globals.css`**
Modify `src/app/globals.css` to only contain Tailwind directives (remove original next.js boilerplate):
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 3: Test Next.js build**
Run: `npm run build`
Expected: Successful build with no TS errors.

- [ ] **Step 4: Commit**
```bash
git add src/app/page.tsx src/app/globals.css
git commit -m "feat: implement game logic and UI in Next.js"
```

---

### Task 5: Clean Up

**Files:**
- Modify: `index.html` (Delete)

- [ ] **Step 1: Remove original file**
```bash
rm index.html
```

- [ ] **Step 2: Commit**
```bash
git add index.html
git commit -m "chore: remove original index.html after successful port"
```
