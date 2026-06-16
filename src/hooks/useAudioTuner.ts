import { useState, useRef, useEffect, useCallback } from 'react';
import { autoCorrelateFrequency, NOTE_NAMES } from '../lib/audio/pitchMath';

interface AudioTunerProps {
  micGain: number;
  noiseGateThreshold: number;
  targetMidi: number | null;
  previousMidi?: number | null;
  deviceId?: string;
  onSuccess: () => void;
  onMistake: (note: string) => void;
}

export function useAudioTuner({ micGain, noiseGateThreshold, targetMidi, previousMidi, deviceId, onSuccess, onMistake }: AudioTunerProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [currentVolumePercent, setCurrentVolumePercent] = useState(0);
  const [detectedNoteName, setDetectedNoteName] = useState<string | null>(null);
  const [detectedFrequency, setDetectedFrequency] = useState<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const filterNodeRef = useRef<BiquadFilterNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const micGainRef = useRef(micGain);
  const thresholdRef = useRef(noiseGateThreshold);
  const targetMidiRef = useRef(targetMidi);
  const previousMidiRef = useRef(previousMidi);
  const deviceIdRef = useRef(deviceId);
  const onSuccessRef = useRef(onSuccess);
  const onMistakeRef = useRef(onMistake);

  // Stability counters
  const holdCountRef = useRef(0);
  const wrongCountRef = useRef(0);
  const lastWrongMidiRef = useRef(-1);
  const lockedMidiRef = useRef<number | null>(null);

  useEffect(() => { micGainRef.current = micGain; if (gainNodeRef.current) gainNodeRef.current.gain.value = micGain; }, [micGain]);
  useEffect(() => { thresholdRef.current = noiseGateThreshold; }, [noiseGateThreshold]);
  useEffect(() => { targetMidiRef.current = targetMidi; }, [targetMidi]);
  useEffect(() => { previousMidiRef.current = previousMidi; }, [previousMidi]);
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);
  useEffect(() => { onMistakeRef.current = onMistake; }, [onMistake]);

  const stop = useCallback(() => {
    if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { if (audioCtxRef.current.state !== 'closed') audioCtxRef.current.close(); audioCtxRef.current = null; }
    setIsRunning(false); setIsInitializing(false); setCurrentVolumePercent(0); setDetectedNoteName(null); setDetectedFrequency(null);
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

    if (volumePercent >= thresholdRef.current) {
      const frequency = autoCorrelateFrequency(buffer, audioCtxRef.current.sampleRate);
      if (frequency !== -1) {
        const exactMidi = 12 * Math.log2(frequency / 440) + 69;
        const roundedMidi = Math.round(exactMidi);
        const octave = Math.floor(roundedMidi / 12) - 1;
        const note = NOTE_NAMES[roundedMidi % 12];
        const fullNoteName = `${note}${octave}`;
        
        setDetectedFrequency(Math.round(frequency));
        setDetectedNoteName(fullNoteName);

        // Clear lock if user plays a completely different note
        if (lockedMidiRef.current !== null && roundedMidi !== lockedMidiRef.current) {
            lockedMidiRef.current = null;
        }

        // --- OCTAVE-AWARE STABILITY ENGINE ---
        if (targetMidiRef.current !== null && lockedMidiRef.current === null) {
          if (roundedMidi === targetMidiRef.current) {
            wrongCountRef.current = 0;
            holdCountRef.current += 1;
            if (holdCountRef.current >= 4) { // Slightly lower threshold for faster response
              lockedMidiRef.current = roundedMidi; // Lock this pitch
              onSuccessRef.current();
              holdCountRef.current = 0; // Reset after trigger
            }
          } else { 
            holdCountRef.current = 0;
            
            // ANTI-RINGING DEBOUNCE: Ignore the exact note we just finished playing 
            // to prevent the decaying string from triggering a mistake.
            if (previousMidiRef.current !== null && roundedMidi === previousMidiRef.current) {
                wrongCountRef.current = 0; // Prevent accumulation
            } else {
                if (roundedMidi === lastWrongMidiRef.current) {
                  wrongCountRef.current += 1;
                  if (wrongCountRef.current >= 15) { // Requires holding a wrong note slightly longer to prevent harmonic misfires
                    lockedMidiRef.current = roundedMidi; // Lock this pitch
                    onMistakeRef.current(fullNoteName);
                    wrongCountRef.current = 0;
                  }
                } else {
                  lastWrongMidiRef.current = roundedMidi;
                  wrongCountRef.current = 0;
                }
            }
          }
        }
      } else {
        setDetectedNoteName(null);
        setDetectedFrequency(null);
        holdCountRef.current = 0;
        wrongCountRef.current = 0;
      }
    } else {
      setDetectedNoteName(null);
      setDetectedFrequency(null);
      holdCountRef.current = 0;
      wrongCountRef.current = 0;
      lockedMidiRef.current = null; // UNLOCK on silence!
    }

    animationFrameRef.current = requestAnimationFrame(executePitchDetectionLoop);
  }, []);

  const start = useCallback(async () => {
    if (isRunning || isInitializing) return;
    setIsInitializing(true);
    
    try {
      const constraints: MediaStreamConstraints = {
        audio: { 
          echoCancellation: false, 
          noiseSuppression: false, 
          autoGainControl: false 
        }
      };

      if (deviceIdRef.current && deviceIdRef.current !== 'default' && constraints.audio && typeof constraints.audio === 'object') {
        constraints.audio.deviceId = { exact: deviceIdRef.current };
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const audioCtx = new AudioContextClass();
      
      // Resume context if suspended (common in some browsers)
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = micGainRef.current;

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
      setIsInitializing(false);
      animationFrameRef.current = requestAnimationFrame(executePitchDetectionLoop);
    } catch (err) {
      console.error("Mic error:", err);
      setIsInitializing(false);
      alert("Microphone access required. Please check your browser permissions.");
    }
  }, [isRunning, isInitializing, executePitchDetectionLoop]);

  useEffect(() => { return () => stop(); }, [stop]);

  return { isRunning, isInitializing, start, stop, currentVolumePercent, detectedNoteName, detectedFrequency };
}
