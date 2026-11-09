/** Normalize IPC stats so HUD and TTS use the same rounded figures. */
export function normalizeSystemStats(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const round = (v) => Math.round(Math.max(0, Math.min(100, Number(v) || 0)));
  return {
    cpu: { usage: round(raw.cpu?.usage) },
    memory: {
      usage: round(raw.memory?.usage),
      used: raw.memory?.used || '0.0',
      total: raw.memory?.total || '0.0',
    },
    disk: {
      usage: round(raw.disk?.usage),
      used: raw.disk?.used || '0',
      total: raw.disk?.total || '0',
    },
    network: {
      download: raw.network?.download ?? '0.0',
      upload: raw.network?.upload ?? '0.0',
    },
    uptime: raw.uptime || '0d 0h 0m',
  };
}

export function formatSystemPerformanceSpeech(stats) {
  if (!stats) {
    return 'I could not read live system stats just now, Sir.';
  }
  const cpu = stats.cpu?.usage ?? 0;
  const mem = stats.memory?.usage ?? 0;
  const disk = stats.disk?.usage ?? 0;
  return `Your system is running at ${cpu} percent CPU, ${mem} percent memory, and ${disk} percent storage, Sir.`;
}
