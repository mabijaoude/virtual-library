import type { WorldId } from "./worlds/types";

type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };
let activeAudio: { context: AudioContext; master: GainNode; level: number; lastPose: number } | undefined;

export function setAmbienceVolume(volume: number) {
  if (!activeAudio) return;
  activeAudio.master.gain.setTargetAtTime(activeAudio.level * Math.max(0, Math.min(1, volume)), activeAudio.context.currentTime, 0.12);
}

export function updateAmbienceListener(x: number, y: number, z: number, yaw: number, pitch: number) {
  if (!activeAudio) return;
  const { context } = activeAudio;
  const now = context.currentTime;
  if (now - activeAudio.lastPose < 0.08) return;
  activeAudio.lastPose = now;
  const listener = context.listener;
  const forward = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  if (listener.positionX) {
    [listener.positionX, listener.positionY, listener.positionZ, listener.forwardX, listener.forwardY, listener.forwardZ, listener.upX, listener.upY, listener.upZ]
      .forEach((parameter, index) => parameter.setTargetAtTime([x, y, z, ...forward, 0, 1, 0][index], now, 0.04));
  } else {
    listener.setPosition(x, y, z);
    listener.setOrientation(forward[0], forward[1], forward[2], 0, 1, 0);
  }
}

export function startWorldAmbience(world: WorldId, volume = 0.5) {
  const AudioContextType = window.AudioContext || (window as AudioWindow).webkitAudioContext;
  if (!AudioContextType) return () => undefined;
  const context = new AudioContextType();
  const master = context.createGain();
  const now = context.currentTime;
  master.gain.setValueAtTime(0, now);
  const level = world === "lunar" ? 0.028 : world === "modern" ? 0.036 : world === "arkship" ? 0.044 : 0.052;
  master.gain.linearRampToValueAtTime(level * volume, now + 1.2);
  master.connect(context.destination);
  const currentAudio = { context, master, level, lastPose: -1 };
  activeAudio = currentAudio;
  const positions: Record<WorldId, [number, number, number]> = {
    heritage: [0, 1.2, -9.5], gothic: [0, 6, -13], modern: [0, 3, -9],
    renaissance: [0, 1, 0], deco: [0, 4, -9], foundry: [0, 2, 3.3],
    lunar: [0, 4, 0], arkship: [-8, 3, 0], alexandria: [0, 2, -11]
  };
  const sourcePosition = positions[world];
  const panner = context.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 5;
  panner.maxDistance = 40;
  panner.rolloffFactor = 0.65;
  panner.positionX.value = sourcePosition[0];
  panner.positionY.value = sourcePosition[1];
  panner.positionZ.value = sourcePosition[2];
  panner.connect(master);

  const noise = context.createBufferSource();
  const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;
  for (let index = 0; index < data.length; index += 1) {
    const white = Math.random() * 2 - 1;
    brown = (brown + 0.018 * white) / 1.018;
    data[index] = brown * 3.2;
  }
  // Join the loop at the same sample value to avoid a periodic click.
  const seam = Math.min(2048, data.length / 2);
  for (let index = 0; index < seam; index++) {
    const mix = index / (seam - 1);
    data[data.length - seam + index] = data[data.length - seam + index] * (1 - mix) + data[0] * mix;
  }
  noise.buffer = buffer;
  noise.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = world === "heritage" || world === "renaissance" ? "bandpass" : "lowpass";
  filter.frequency.value = world === "foundry" ? 620 : world === "modern" ? 240 : world === "lunar" ? 310 : world === "arkship" ? 170 : world === "gothic" ? 380 : 880;
  filter.Q.value = world === "renaissance" ? 0.45 : 0.75;
  const noiseGain = context.createGain();
  noiseGain.gain.value = world === "modern" ? 0.22 : world === "lunar" ? 0.18 : world === "arkship" ? 0.28 : 0.38;
  noise.connect(filter).connect(noiseGain).connect(panner);
  noise.start();

  const oscillators: OscillatorNode[] = [];
  if (world === "foundry" || world === "gothic" || world === "modern" || world === "lunar" || world === "arkship") {
    const oscillator = context.createOscillator();
    const oscillatorGain = context.createGain();
    oscillator.type = world === "foundry" ? "sawtooth" : "sine";
    oscillator.frequency.value = world === "foundry" ? 46 : world === "arkship" ? 38 : world === "lunar" ? 51 : world === "modern" ? 58 : 72;
    oscillator.detune.value = world === "gothic" ? -9 : 3;
    oscillatorGain.gain.value = world === "foundry" ? 0.06 : world === "arkship" ? 0.045 : world === "lunar" ? 0.012 : 0.025;
    oscillator.connect(oscillatorGain).connect(master);
    oscillator.start();
    oscillators.push(oscillator);
  }

  void context.resume();
  return () => {
    if (activeAudio === currentAudio) activeAudio = undefined;
    const stopAt = context.currentTime + 0.35;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(master.gain.value, context.currentTime);
    master.gain.linearRampToValueAtTime(0, stopAt);
    window.setTimeout(() => {
      try { noise.stop(); } catch { /* already stopped */ }
      oscillators.forEach((oscillator) => { try { oscillator.stop(); } catch { /* already stopped */ } });
      void context.close();
    }, 380);
  };
}
