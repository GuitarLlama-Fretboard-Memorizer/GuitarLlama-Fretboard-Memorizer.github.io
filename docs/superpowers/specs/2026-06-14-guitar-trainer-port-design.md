# Guitar Fretboard Trainer Port Design

## Overview
This document outlines the architecture for porting the vanilla JavaScript "Guitar Fretboard Note Trainer" into a modern Next.js application using TypeScript and Tailwind CSS. The port will preserve the highly tuned Web Audio API graph and pitch detection mathematics of the original file, mapping them into React-friendly hooks and utilities.

## 1. Math and Constants (`src/lib/audio/pitchMath.ts`)
This file will hold pure functions and constants, completely decoupled from React or the Web Audio API nodes.

*   **Constants**:
    *   `NOTE_NAMES`: Array of 12 note names (C to B).
    *   `STRING_BASE_MIDI`: Map of string numbers to base MIDI values (e.g., `{ 1: 64, ... }`).
*   **Pitch Detection**:
    *   `autoCorrelateFrequency(buffer: Float32Array, sampleRate: number): number`: Ported exactly from the original implementation. It must maintain the `0.2` clipping threshold, the specific correlation loop, and the parabolic interpolation mathematics at the end.

## 2. Web Audio Integration (`src/hooks/useAudioTuner.ts`)
A custom React hook that manages the Web Audio API lifecycle and runs the continuous pitch detection loop.

*   **Node Management**: Uses `useRef` to store the `AudioContext`, `AnalyserNode`, `GainNode`, and `BiquadFilterNode` to prevent unnecessary re-renders and memory leaks.
*   **Audio Graph**: `Mic Stream -> GainNode -> BiquadFilterNode (800Hz Lowpass) -> AnalyserNode`.
*   **State Exposed**:
    *   `isRunning`: boolean
    *   `currentVolumePercent`: number (0-100)
    *   `micGain`: number
    *   `setMicGain`: function
    *   `noiseGateThreshold`: number
    *   `setNoiseGateThreshold`: function
    *   `detectedNoteName`: string | null
*   **The Loop (`requestAnimationFrame`)**:
    *   Calculates RMS energy from the analyser buffer.
    *   Scales RMS to `currentVolumePercent` (RMS * 400).
    *   If `currentVolumePercent >= noiseGateThreshold`, it executes `autoCorrelateFrequency` and updates `detectedNoteName`.
*   **Cleanup**: Provides a robust cleanup function that halts the animation frame and calls `track.stop()` on the active media stream to release the microphone.

## 3. UI and Game Logic (`src/app/page.tsx`)
A client-side page (`'use client'`) that consumes the audio hook and manages the game loop.

*   **Spaced Repetition Engine**:
    *   State: `learningPool`, `currentPrompt`, `roundNumber`, `mistakesInRound`, etc.
    *   Timing: Tracks how long a user takes to answer.
    *   `triggerSuccessState`: Adjusts prompt weights (reduces weight if answered in <3s, increases if >6s). Uses `SUCCESS_THRESHOLD` (5 consecutive hits).
    *   `triggerWrongState`: Increases prompt weight, registers a mistake. Uses `ERROR_THRESHOLD` (10 consecutive wrong hits).
*   **Visual Layout (Tailwind CSS)**:
    *   **Controls**: Sliders for Mic Boost and Noise Gate. Checkboxes for string selection.
    *   **Discord-Style Meter**: A horizontal volume bar whose width is tied to `currentVolumePercent`. The color is dynamic: Yellow if below `noiseGateThreshold`, Green if above, Red if clipping (>95%). An absolute positioned vertical marker indicates the current threshold.
    *   **Feedback Area**: Large target note display that flashes green/red on success/failure.
