# Guitar Trainer Pro Upgrade Plan

**Goal:** Transform the basic trainer into a professional-grade "Fret Pro" style application with a visual fretboard, mastery tracking, and interval training.

---

### Task 1: Update Math Utilities (`src/lib/audio/pitchMath.ts`)
- [ ] Add interval mapping logic.
- [ ] Add functions to calculate intervals from a root note.
- [ ] Add more comprehensive MIDI-to-note mapping for the entire neck.

### Task 2: Build Visual Fretboard Component (`src/components/Fretboard.tsx`)
- [ ] Create a responsive SVG-based guitar neck (12 or 22 frets).
- [ ] Implement string/fret highlighting.
- [ ] Implement "Live Note" feedback (showing what the user is playing in real-time).

### Task 3: Mastery & Persistence Logic
- [ ] Implement `MasteryMatrix` state in `page.tsx` or a new hook.
- [ ] Save/Load mastery data to `localStorage`.
- [ ] Implement "Smart Selection" algorithm: Weight notes based on error rate and response time.

### Task 4: Pro Features & UI Overhaul
- [ ] **Scopes**: Add "Fret Range" selection and "Natural Notes Only" toggle.
- [ ] **Interval Training**: Add mode to quiz Intervals instead of just Note Names.
- [ ] **UI**: Switch to a dark, high-contrast "Pro" theme with Tailwind.
- [ ] **Heatmap View**: Add a toggleable overlay on the fretboard showing mastery levels (Red to Green).
