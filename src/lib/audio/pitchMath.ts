export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const STRING_BASE_MIDI: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

export const INTERVAL_NAMES: Record<number, string> = {
    0: "R", 1: "m2", 2: "M2", 3: "m3", 4: "M3", 5: "P4",
    6: "b5", 7: "P5", 8: "m6", 9: "M6", 10: "m7", 11: "M7"
};

export interface NoteInfo {
    noteName: string;
    midi: number;
    fret: number;
    string: number;
}

export interface MasteryEntry {
    stability: number; // 0 to 1
    lastSeen: number; // timestamp
    attempts: number;
    successes: number;
    bestTime: number; // in seconds
}

export function getNoteAt(string: number, fret: number): NoteInfo {
    const baseMidi = STRING_BASE_MIDI[string] || 40;
    const midi = baseMidi + fret;
    return {
        noteName: NOTE_NAMES[midi % 12],
        midi,
        fret,
        string
    };
}

/**
 * SRS Logic: Calculate the probability weight for a note.
 * Higher weight = more likely to be picked.
 */
export function calculateSRSWeight(entry: any): number {
    if (!entry || typeof entry !== 'object' || typeof entry.stability !== 'number') return 100; // New notes or legacy data have high priority

    const now = Date.now();
    const lastSeen = typeof entry.lastSeen === 'number' ? entry.lastSeen : now;
    const hoursSinceSeen = (now - lastSeen) / (1000 * 60 * 60);
    
    // Decay: Stability drops over time. 
    // A mastered note (stability 1.0) decays slowly.
    // A learning note (stability 0.2) decays quickly.
    const decay = Math.min(0.5, hoursSinceSeen / 72); // max 0.5 decay over 3 days
    const currentStability = Math.max(0.05, entry.stability - decay);

    // Weight is inversely proportional to stability.
    // If stability is 0.1, weight is high (90).
    // If stability is 0.9, weight is low (10).
    const weight = Math.floor((1.0 - currentStability) * 100);
    return isNaN(weight) ? 100 : Math.max(1, weight);
}

/**
 * SRS Logic: Update entry based on performance.
 */
export function updateMasteryEntry(entry: any, success: boolean, timeSeconds: number): MasteryEntry {
    // Handle legacy data (if entry is a number from old localstorage) or missing data
    const isLegacy = typeof entry !== 'object' || entry === null;
    const current: MasteryEntry = isLegacy 
        ? { stability: 0.1, lastSeen: Date.now(), attempts: 0, successes: 0, bestTime: 999 }
        : entry;
    
    let newStability = typeof current.stability === 'number' ? current.stability : 0.1;
    
    if (success) {
        // Mastery is speed + accuracy
        // Relaxed thresholds to account for physical guitar travel time (v2: 4s/8s)
        if (timeSeconds < 4.0) {
            newStability = Math.min(1.0, current.stability + 0.3); // "Instant Recall"
        } else if (timeSeconds < 8.0) {
            newStability = Math.min(1.0, current.stability + 0.1); // "Confident but Paced"
        } else {
            newStability = Math.min(1.0, current.stability + 0.05); // "Learning/Struggled"
        }
    } else {
        // Mistake: Heavy penalty. Note enters "Re-learning" phase.
        newStability = 0.1;
    }

    return {
        stability: newStability,
        lastSeen: Date.now(),
        attempts: current.attempts + 1,
        successes: current.successes + (success ? 1 : 0),
        bestTime: success ? Math.min(current.bestTime, timeSeconds) : current.bestTime
    };
}

export function getIntervalBetween(rootMidi: number, targetMidi: number): string {
    const semitones = (targetMidi - rootMidi) % 12;
    const normalized = semitones < 0 ? semitones + 12 : semitones;
    return INTERVAL_NAMES[normalized];
}

/**
 * Ported directly from the original index.html.
 */
export function autoCorrelateFrequency(buffer: Float32Array, sampleRate: number): number {
    const SIZE = buffer.length;
    let targetLeftIndex = 0, targetRightIndex = SIZE - 1;
    const clippingThreshold = 0.2;
    
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buffer[i]) < clippingThreshold) { targetLeftIndex = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buffer[SIZE - i]) < clippingThreshold) { targetRightIndex = SIZE - i; break; }

    const truncatedBuffer = buffer.slice(targetLeftIndex, targetRightIndex);
    const truncatedSize = truncatedBuffer.length;
    if (truncatedSize === 0) return -1;

    const correlationArray = new Float32Array(truncatedSize);
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
        if (correlationArray[i] > maxval) { maxval = correlationArray[i]; maxpos = i; }
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
