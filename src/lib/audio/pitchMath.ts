export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const STRING_BASE_MIDI: Record<number, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

/**
 * Ported directly from the original index.html.
 * Maintains the 0.2 clipping threshold and parabolic interpolation.
 */
export function autoCorrelateFrequency(buffer: Float32Array, sampleRate: number): number {
    const SIZE = buffer.length;
    let targetLeftIndex = 0, targetRightIndex = SIZE - 1;
    const clippingThreshold = 0.2;
    
    // Find first and last indices below clipping threshold
    for (let i = 0; i < SIZE / 2; i++) {
        if (Math.abs(buffer[i]) < clippingThreshold) {
            targetLeftIndex = i;
            break;
        }
    }
    for (let i = 1; i < SIZE / 2; i++) {
        if (Math.abs(buffer[SIZE - i]) < clippingThreshold) {
            targetRightIndex = SIZE - i;
            break;
        }
    }

    const truncatedBuffer = buffer.slice(targetLeftIndex, targetRightIndex);
    const truncatedSize = truncatedBuffer.length;
    if (truncatedSize === 0) return -1;

    const correlationArray = new Float32Array(truncatedSize);
    
    for (let i = 0; i < truncatedSize; i++) {
        for (let j = 0; j < truncatedSize - i; j++) {
            correlationArray[i] = correlationArray[i] + truncatedBuffer[j] * truncatedBuffer[j + i];
        }
    }

    // Find first dip in correlation
    let scanPointer = 0;
    while (scanPointer < truncatedSize - 1 && correlationArray[scanPointer] > correlationArray[scanPointer + 1]) {
        scanPointer++;
    }
    
    // If we scanned the whole thing without finding a peak, return -1
    if (scanPointer === truncatedSize - 1) return -1;

    // Find the max peak after the initial dip
    let maxval = -1, maxpos = -1;
    for (let i = scanPointer; i < truncatedSize; i++) {
        if (correlationArray[i] > maxval) {
            maxval = correlationArray[i];
            maxpos = i;
        }
    }
    
    let T0 = maxpos;

    // Parabolic Interpolation (Perfects the accuracy for high frequency notes)
    if (T0 > 0 && T0 < truncatedSize - 1) {
        let x1 = correlationArray[T0 - 1], x2 = correlationArray[T0], x3 = correlationArray[T0 + 1];
        let a = (x1 + x3 - 2 * x2) / 2;
        let b = (x3 - x1) / 2;
        if (a) T0 = T0 - b / (2 * a);
    }

    if (T0 > 0) return sampleRate / T0;
    return -1;
}
