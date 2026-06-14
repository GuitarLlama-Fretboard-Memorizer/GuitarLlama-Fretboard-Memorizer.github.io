import { NOTE_NAMES, STRING_BASE_MIDI, autoCorrelateFrequency } from './pitchMath';

describe('pitchMath utilities', () => {
    test('exports correct constants', () => {
        expect(NOTE_NAMES[0]).toBe("C");
        expect(STRING_BASE_MIDI[1]).toBe(64);
        expect(STRING_BASE_MIDI[6]).toBe(40);
    });

    test('autoCorrelateFrequency returns -1 for silence', () => {
        const buffer = new Float32Array(2048).fill(0);
        expect(autoCorrelateFrequency(buffer, 48000)).toBe(-1);
    });
});
