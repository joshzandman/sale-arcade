const ArcadeAudio = (() => {
  let ctx;
  let muted = false;

  function ensure() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain) {
    if (muted) return;
    const ac = ensure();
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type || "square";
    osc.frequency.value = freq;
    g.gain.value = gain || 0.05;
    osc.connect(g);
    g.connect(ac.destination);
    osc.start();
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.stop(ac.currentTime + dur);
  }

  function noise(dur, gain) {
    if (muted) return;
    const ac = ensure();
    const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    const g = ac.createGain();
    src.buffer = buffer;
    g.gain.value = gain || 0.04;
    src.connect(g);
    g.connect(ac.destination);
    src.start();
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
  }

  return {
    setMuted(value) {
      muted = value;
    },
    door() {
      tone(180, 0.18, "square", 0.04);
      noise(0.12, 0.03);
    },
    elevator() {
      tone(523, 0.12, "square", 0.045);
      tone(392, 0.2, "square", 0.03);
    },
    ding() {
      tone(659, 0.16, "square", 0.05);
    },
    step() {
      tone(140, 0.04, "square", 0.02);
    },
    cart() {
      tone(220, 0.05, "square", 0.025);
      tone(90, 0.08, "square", 0.02);
    },
    boom() {
      noise(0.25, 0.07);
      tone(520, 0.35, "square", 0.06);
      tone(180, 0.5, "sawtooth", 0.04);
    },
  };
})();
