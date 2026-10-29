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
- **Drawing in the air.** Pinch (thumb tip to index tip) to put the pen down,
  open the hand to lift it; the line follows the pinch point, right at the
  fingertips, in the chosen instrument. A quick pinch drops a dot. Either
  hand draws, and two hands draw at once, each its own stroke. Hands are
  read about 12 times a second and the pen glides on a smooth curve between
  readings. The pinch has to hold for two readings, opens a little later
  than it closes (so it doesn't flicker), and doesn't count for a fist, two
  hands together, or a hand at the edge or below the drawing area. Each
  tracked hand shows a small glowing ring at its pinch point in the
  instrument's colour: hollow while open, filled while pinched.
- **Drawing by touch.** Drag with a finger or the mouse to draw a stroke; tap
  or click to drop a dot. Strokes are glossy neon tubes: a bright core,
  glassy edges with a highlight, rounded ends and a soft glow.
- **Notes.** Each row is a note of C major pentatonic from C4 to C6 (11 rows),
  so any scribble is in tune. A stroke plays when the playhead reaches it (on
  the nearest 16th) and again every 8th note while it stays under the
  playhead. Strokes under the playhead together play as a chord. Each note
  flares the stroke and bursts in its colour, brightened, where the playhead
  touches it.
- **Two ways to play** (one for all lines, chosen with two wordless chips in
  the control band: dots = Notes, a wave = Continuous; Notes by default):
  - **Notes** (above): notes on the steps.
  - **Continuous**: every point of a line sounds. While the playhead is over
    a line, one held tone follows its height, so a wave is heard as a wave
    and a slope as a slide. The pitch glides but settles onto the scale where
    the line is flat or slow (pulled toward the nearest note, less the
    steeper the line), with a short portamento. A tone fades in when the
    playhead reaches a line and out when it leaves; several lines make a
    chord (at most 6 tones). The tube glows along the stretch the playhead is
    crossing and a bright bead rides the line. Held versions of the four
    instruments: a smooth lead with gentle vibrato (lime), a soft pad (blue),
    a warm filtered synth (pink) and a deep bass, an octave down (amber).
  - Switching fades the held tones in or out, so nothing clicks.
- **Instruments.** Four, all made in code with Web Audio (no sample files):
  marimba (lime), soft keys (sky blue), synth pluck (pink) and round bass
  (amber, an octave down). A stroke keeps the instrument it was drawn with,
  so you can layer them. Pick one with the four wordless chips in the
  control band; the trash button clears the drawing.
- **Sound.** Browsers allow sound only after a tap: until then a speaker
  pulses low in the middle with "Tap to play". That first tap only turns the
  sound on; a drag that starts the session still draws. A pinch also turns
  the sound on where the browser allows it without a tap (not on iPhone). Notes are booked
  ahead on the audio clock, every note has short fades in and out, and
  everything runs through a light room reverb, a compressor and a limiter.
- **Hint.** Once the sound is on, a small see-through ghost hand low in the
  middle pinches and draws a short wave (a faint line in the chosen colour
  follows its fingertips), opens and glides back. It goes for good after
  your first stroke, by hand or by touch.
- **Demo.** On the first visit a short phrase is already drawn (a marimba
  line, a soft-keys arc and two pluck dots). It plays once the sound is on
  and goes with clear.
