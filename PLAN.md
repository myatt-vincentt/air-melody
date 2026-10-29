# Plan

Air Melody: draw glowing lines over the camera and a looping playhead plays
them as music. Height is pitch, across is time.

## How it works

- **Full screen.** The camera fills the whole window (`src/App.tsx` swaps the
  9:16 frame for a full-window container).
- **The grid.** A faint line for every note and every beat, with small note
  names on a slim glass rail on the left edge and beat ticks along the bottom
  of the drawing area. Nothing covers the face.
- **The loop.** A magenta playhead with a soft glow sweeps left to right and
  loops forever: 2 bars of 4/4 at 96 BPM, about 5 s across the screen, 16
  ticks (8th notes).
- **Drawing.** Drag with a finger or the mouse to draw a stroke; tap or click
  to drop a dot. Strokes are glossy neon tubes: a bright core, glassy edges
  with a highlight, rounded ends and a soft glow.
- **Notes.** Each row is a note of C major pentatonic from C4 to C6 (11 rows),
  so any scribble is in tune. A stroke plays when the playhead reaches it (on
  the nearest 16th) and again every 8th note while it stays under the
  playhead. Strokes under the playhead together play as a chord. Each note
  flares the stroke and bursts in its colour, brightened, where the playhead
  touches it.
- **Instruments.** Four, all made in code with Web Audio (no sample files):
  marimba (lime), soft keys (sky blue), synth pluck (pink) and round bass
  (amber, an octave down). A stroke keeps the instrument it was drawn with,
  so you can layer them. Pick one with the four wordless chips in the
  control band; the trash button clears the drawing.
- **Sound.** Browsers allow sound only after a tap: until then a speaker
  pulses low in the middle with "Tap to play". That first tap only turns the
  sound on; a drag that starts the session still draws. Notes are booked
  ahead on the audio clock, every note has short fades in and out, and
  everything runs through a light room reverb, a compressor and a limiter.
- **Demo.** On the first visit a short phrase is already drawn (a marimba
  line, a soft-keys arc and two pluck dots). It plays once the sound is on
  and goes with clear.

## Next

- Step 2: draw in the air with a pinch (hand tracking), a ghost-hand hint,
  polish.
