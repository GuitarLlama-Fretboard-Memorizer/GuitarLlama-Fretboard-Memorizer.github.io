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

    // Check if round is complete
    // We increment index BEFORE checking, so if we just finished questionsPerRound, we stop.
    // Wait, let's look at the current index logic.
    // In original code: currentQuestionIndex++; if (currentQuestionIndex >= questionsPerRound) return endRound();
  }, [currentQuestionIndex, questionsPerRound]);

  // Redefining generateNextQuestion with proper logic
  const actualGenerateNextQuestion = useCallback((currentPool: LearningItem[], nextIndex: number) => {
    if (currentPool.length === 0) return;
    
    setIsTransitioning(false);
    setHasGuessedWrongOnCurrent(false);
    setTargetNoteHoldCounter(0);
    setWrongNoteHoldCounter(0);
    setFeedback({message: '', type: null});

    if (nextIndex > questionsPerRound) {
      setIsTransitioning(true);
      setIsRoundComplete(true);
      setRoundNumber(r => r + 1);
      setCurrentPrompt(null);
      return;
    }

    setCurrentQuestionIndex(nextIndex);

    const totalWeight = currentPool.reduce((sum, item) => sum + item.weight, 0);
    let randomNum = Math.random() * totalWeight;
    let selected = currentPool[0];
    
    for (let item of currentPool) {
      if (randomNum < item.weight) { 
        selected = item; 
        break; 
      }
      randomNum -= item.weight;
    }

    setCurrentPrompt(selected);
    setQuestionStartTime(Date.now());
  }, [questionsPerRound]);

  const startNewRound = useCallback(() => {
    if (activeStrings.length === 0) return alert("Select at least one string.");
    const pool = buildLearningPool();
    setMistakesInRound(0);
    setIsRoundComplete(false);
    actualGenerateNextQuestion(pool, 1);
  }, [activeStrings, buildLearningPool, actualGenerateNextQuestion]);

  const penalizeCurrentNote = useCallback((amount: number) => {
    if (currentPrompt) {
        currentPrompt.weight += amount;
    }
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
    setTimeout(() => actualGenerateNextQuestion(learningPool, currentQuestionIndex + 1), 1000);
  }, [currentPrompt, hasGuessedWrongOnCurrent, questionStartTime, learningPool, currentQuestionIndex, actualGenerateNextQuestion]);

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
            <div className="flex items-center gap-2">
              Round Size:
              <select 
                className="p-1 border rounded font-normal text-slate-800 normal-case tracking-normal"
                value={questionsPerRound} 
                onChange={e => setQuestionsPerRound(parseInt(e.target.value))}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
              </select>
            </div>
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
            className="w-full py-4 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-md transition-colors my-4 shadow-md"
          >
            START SESSION (Enable Mic)
          </button>
        )}

        <div className={`text-center py-8 px-3 my-3 rounded-lg border-4 transition-colors duration-150 ${getQuizBoxClass()}`}>
          <div className={`font-bold text-xl h-6 mb-2 ${feedback.type === 'success' ? 'text-emerald-600' : feedback.type === 'error' ? 'text-red-600' : 'invisible'}`}>
            {feedback.message || 'Placeholder'}
          </div>
          <div className="text-xl text-slate-500 mb-1">
            {isRoundComplete ? "Round Complete!" : currentPrompt ? `String ${currentPrompt.string}` : "Awaiting Start..."}
          </div>
          <div className={`text-6xl font-black my-4 transition-colors duration-150 ${feedback.type === 'success' ? 'text-emerald-600' : feedback.type === 'error' ? 'text-red-600' : 'text-blue-500'}`}>
            {isRoundComplete ? "🎸" : currentPrompt ? currentPrompt.noteName : "--"}
          </div>
          
          {tuner.isRunning && currentPrompt && !isRoundComplete && (
            <button 
              onClick={() => {
                if (!isTransitioning) {
                  penalizeCurrentNote(50);
                  actualGenerateNextQuestion(learningPool, currentQuestionIndex + 1);
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
              className="mt-4 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded font-bold transition-colors mx-auto block shadow-md"
            >
              Start Next Round
            </button>
          )}
        </div>

        <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-4 px-2">
          <div>Round: <span className="text-blue-600">{roundNumber}</span></div>
          <div>Question: <span className="text-blue-600">{currentQuestionIndex}</span> / <span className="text-blue-600">{questionsPerRound}</span></div>
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
