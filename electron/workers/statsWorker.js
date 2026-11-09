const { parentPort } = require('worker_threads');
const os = require('os');
const { execFile } = require('child_process');

let si;
try {
  si = require('systeminformation');
} catch (e) {
  console.error('StatsWorker: failed to require systeminformation', e.message);
}

let latestStats = {
  cpu: { usage: 0, cores: os.cpus().length },
  memory: { usage: 0, used: '0.0', total: '0.0' },
  gpu: { usage: 0, temp: 0, name: 'Detecting...', memUsed: 0, memTotal: 0 },
  disk: { usage: 0, used: '0', total: '0' },
  temperature: { gpu: 0 },
  network: { download: '0.0', upload: '0.0' },
  uptime: '0d 0h 0m'
};

let lastGpuFetch = 0;
let lastNetFetch = 0;
let lastDiskFetch = 0;

let prevCpuTimes = null;

function getCpuUsage() {
  const cpus = os.cpus();

  if (!prevCpuTimes) {
    prevCpuTimes = cpus.map(c => ({ ...c.times }));
    return { usage: 0, cores: cpus.length };
  }

  let totalIdle = 0;
  let totalTick = 0;

  for (let i = 0; i < cpus.length; i++) {
    const prev = prevCpuTimes[i];
    const curr = cpus[i].times;

    const idle = curr.idle - prev.idle;
    const total = (curr.user - prev.user) + (curr.nice - prev.nice) +
      (curr.sys - prev.sys) + (curr.irq - prev.irq) + idle;

    totalIdle += idle;
    totalTick += total;
  }

  prevCpuTimes = cpus.map(c => ({ ...c.times }));

  const usage = totalTick > 0 ? Math.round((1 - totalIdle / totalTick) * 100) : 0;
  return { usage, cores: cpus.length };
}

function getDarwinUsedMemory() {
  return new Promise((resolve) => {
    execFile('vm_stat', { timeout: 2000 }, (error, stdout) => {
      if (error) return resolve(null);
      const pageSize = Number((stdout.match(/page size of (\d+)/) || [])[1]) || 16384;
      const pages = (label) => Number((stdout.match(new RegExp(`${label}:\\s+(\\d+)`)) || [])[1]) || 0;
      const used = (pages('Anonymous pages') - pages('Pages purgeable'))
        + pages('Pages wired down')
        + pages('Pages occupied by compressor');
      resolve(used > 0 ? used * pageSize : null);
    });
  });
}

async function getMemoryStats() {
  const total = os.totalmem();
  // macOS keeps free memory near zero on purpose (file cache), so total - freemem always reads ~99%.
  const darwinUsed = process.platform === 'darwin' ? await getDarwinUsedMemory() : null;
  const used = darwinUsed ?? (total - os.freemem());
  return {
    usage: Math.round((used / total) * 100),
    used: (used / 1073741824).toFixed(1),
    total: (total / 1073741824).toFixed(1),
  };
}

let hasNvidiaSmi = process.platform !== 'darwin';

function getNvidiaStats() {
  if (!hasNvidiaSmi) {
    return Promise.resolve(latestStats.gpu);
  }

  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=utilization.gpu,temperature.gpu,name,memory.used,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 3000 },
      (error, stdout) => {
        if (error) {
          if (error.code === 'ENOENT') {
            hasNvidiaSmi = false;
          }
          return resolve(latestStats.gpu);
        }
        try {
          const p = stdout.trim().split(',').map(s => s.trim());
          const gpu = {
            usage: parseInt(p[0]) || 0,
            temp: parseInt(p[1]) || 0,
            name: p[2] || 'NVIDIA GPU',
            memUsed: parseInt(p[3]) || 0,
            memTotal: parseInt(p[4]) || 0,
          };
          resolve(gpu);
        } catch (e) {
          resolve(latestStats.gpu);
        }
      }
    );
  });
}

function getDarwinDiskStats() {
  return new Promise((resolve) => {
    execFile('df', ['-k', '/System/Volumes/Data'], { timeout: 2000 }, (error, stdout) => {
      if (error || !stdout) return resolve(null);
      try {
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const parts = lines[1].trim().split(/\s+/);
          const totalKB = parseInt(parts[1], 10);
          const availKB = parseInt(parts[3], 10);
          const usedKB = totalKB - availKB;
          const capacity = parseInt(parts[4], 10);
          if (totalKB > 0) {
            return resolve({
              usage: capacity || Math.round((usedKB / totalKB) * 100),
              used: (usedKB / 1048576).toFixed(0),
              total: (totalKB / 1048576).toFixed(0),
            });
          }
        }
      } catch (_) {}
      resolve(null);
    });
  });
}

async function getDiskStats() {
  if (process.platform === 'darwin') {
    const darwinStats = await getDarwinDiskStats();
    if (darwinStats) return darwinStats;
  }

  if (!si) return latestStats.disk;
  try {
    const fsSize = await si.fsSize();
    if (!Array.isArray(fsSize) || fsSize.length === 0) return latestStats.disk;

    const mainFs =
      fsSize.find((f) => f.mount === '/System/Volumes/Data') ||
      fsSize.find((f) => f.mount === '/') ||
      fsSize[0];

    if (mainFs && mainFs.size > 0) {
      return {
        usage: Math.round(mainFs.use || ((mainFs.used / mainFs.size) * 100)),
        used: (mainFs.used / 1073741824).toFixed(0),
        total: (mainFs.size / 1073741824).toFixed(0),
      };
    }
    return latestStats.disk;
  } catch (e) {
    return latestStats.disk;
  }
}

async function getNetworkStats() {
  if (!si) return latestStats.network;
  try {
    const stats = await si.networkStats();
    // Prefer real NICs — utun/awdl/llw (VPN/Continuity) inflate rx_sec wildly on macOS.
    const ignored = /^(lo|loopback|awdl|llw|utun|bridge|veth|docker|vethernet|anpi|ap\d)/i;
    const real = stats.filter((n) => n.iface && !ignored.test(n.iface));
    const preferred = real.filter((n) => /^(en|eth|wlan|wi-fi)/i.test(n.iface));
    const interfaces = preferred.length > 0 ? preferred : real.length > 0 ? real : stats;
    // systeminformation networkStats rx_sec / tx_sec are bytes per second.
    const rx = interfaces.reduce((a, n) => a + (n.rx_sec || 0), 0);
    const tx = interfaces.reduce((a, n) => a + (n.tx_sec || 0), 0);
    return {
      download: (rx / 1048576).toFixed(1),
      upload: (tx / 1048576).toFixed(1),
    };
  } catch (e) {
    return latestStats.network;
  }
}

async function pollStats() {
  const now = Date.now();

  const upSec = os.uptime();
  const d = Math.floor(upSec / 86400);
  const h = Math.floor((upSec % 86400) / 3600);
  const m = Math.floor((upSec % 3600) / 60);
  latestStats.uptime = `${d}d ${h}h ${m}m`;

  latestStats.cpu = getCpuUsage();
  latestStats.memory = await getMemoryStats();

  const promises = [];

  const shouldPollGpu = (now - lastGpuFetch >= 10000 || lastGpuFetch === 0);
  if (shouldPollGpu) {
    promises.push((async () => {
      latestStats.gpu = await getNvidiaStats();
      latestStats.temperature = { gpu: latestStats.gpu.temp };
      lastGpuFetch = now;
    })());
  }

  const shouldPollNet = (now - lastNetFetch >= 15000 || lastNetFetch === 0);
  if (shouldPollNet) {
    promises.push((async () => {
      latestStats.network = await getNetworkStats();
      lastNetFetch = now;
    })());
  }

  const shouldPollDisk = (now - lastDiskFetch >= 60000 || lastDiskFetch === 0);
  if (shouldPollDisk) {
    promises.push((async () => {
      latestStats.disk = await getDiskStats();
      lastDiskFetch = now;
    })());
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }

  parentPort.postMessage(latestStats);
}

pollStats();

setInterval(pollStats, 5000);
