import { useState, useRef, useEffect, useCallback } from 'react';
import { autoCorrelateFrequency, NOTE_NAMES } from '../lib/audio/pitchMath';

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
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
      audioCtxRef.current = null;
    }
    setIsRunning(false);
    setCurrentVolumePercent(0);
    setDetectedNoteName(null);
  }, []);

  const executePitchDetectionLoop = useCallback(() => {
    if (!analyserRef.current || !audioCtxRef.current) return;

    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    
    // Calculate Audio Energy (RMS)
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) {
        rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / buffer.length);
    
    // Scale RMS to a 0-100% value (matching original logic: rms * 400)
    const volumePercent = Math.min(100, rms * 400);
    setCurrentVolumePercent(volumePercent);

    if (volumePercent >= noiseGateThreshold) {
      const frequency = autoCorrelateFrequency(buffer, audioCtxRef.current.sampleRate);
      if (frequency !== -1) {
        const exactMidi = 12 * Math.log2(frequency / 440) + 69;
        const roundedMidi = Math.round(exactMidi);
        const noteName = NOTE_NAMES[roundedMidi % 12];
        setDetectedNoteName(noteName);
      } else {
        setDetectedNoteName(null);
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
      
      const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
      const audioCtx = new AudioContextClass();
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
      alert("Microphone access required. Ensure you are using localhost and giving permissions.");
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
